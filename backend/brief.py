import asyncio, json, os, time
from datetime import datetime, timezone
import openai
from openai import OpenAI
from mcp import ClientSession
try:
    from mcp.client.streamable_http import streamable_http_client as connect
except ImportError:
    from mcp.client.streamable_http import streamablehttp_client as connect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIGNAL_URL = "https://datahub.noxiaohao.com/mcp"
CORE = {"TSLA","NVDA","AAPL","MSFT","GOOGL","AMZN","META","AMD","SPY","QQQ"}
COMPANY = {"TSLA":"Tesla","NVDA":"Nvidia","AAPL":"Apple","MSFT":"Microsoft",
           "GOOGL":"Google","AMZN":"Amazon","META":"Meta","AMD":"AMD",
           "SPY":"S&P 500","QQQ":"Nasdaq"}
CLIP = 900
FEEDS_BIZ = "cnbc,techcrunch,theverge,wired,arstechnica"
FEEDS_MACRO = "cnbc,fed"

# Primary: Qwen via the Bitget hackathon relay. It's a shared pool across
# many teams, so it can get congested -- a short timeout plus a fallback to
# Groq (fast, reliable) keeps the nightly job from hanging or failing outright.
PRIMARY_MODEL = os.environ.get("LLM_MODEL", "qwen3.8-max")
PRIMARY_CLIENT = OpenAI(
    api_key=os.environ.get("QWEN_API_KEY", ""),
    base_url=os.environ.get("QWEN_BASE_URL", "https://hackathon.bitgetops.com/v1"),
    timeout=60.0, max_retries=0,
)

FALLBACK_MODEL = os.environ.get("LLM_FALLBACK", "openai/gpt-oss-120b")
_groq_key = os.environ.get("GROQ_API_KEY", "")
FALLBACK_CLIENT = OpenAI(
    api_key=_groq_key, base_url="https://api.groq.com/openai/v1",
    timeout=60.0, max_retries=0,
) if _groq_key else None

SYSTEM = """You are Noctis, an executive night-shift analyst for traders of tokenized US stocks on Bitget.
Your reader is an active trader who wakes up to the US session, and who may watch different names than the ones listed here.

THE MOST IMPORTANT RULE: Never state a specific cause (a company action, a news event, an analyst call, a macro release,
anything) unless it is explicitly present in one of the RESEARCH sections you are given. If RESEARCH does not support a
specific cause for a ticker, do NOT guess or infer one -- instead describe that ticker's move using ONLY the numeric
context provided in "mover_stats" (its rank among tonight's movers, how far it is from the average move, its turnover
rank). It is normal and expected for most tickers, especially obscure ones, to have no news-based cause. Describing them
factually using only the provided numbers is the correct behavior, not a failure. A guess dressed up as an explanation
is worse than an honest "no catalyst found, but here is how this move compares to the rest of the tape."

Other rules:
- Use ONLY the provided numbers for percentage moves. Never invent numbers or news.
- In the summary, describe the SHAPE of the overnight move -- which groups moved together (mega-cap tech, indices via
  SPY/QQQ, semis, etc.) and the overall breadth -- rather than only naming one or two tickers.
- The "movers" array in your answer MUST contain exactly one entry for every ticker listed in "required_tickers" in the
  user message. Do not omit any, and do not add tickers that are not in that list.
- Never describe what an unfamiliar company or ticker does. For non-core tickers, only describe the numbers.
- You have no tools. Do not call any tools.
- Outside US market hours, rToken prices are indicative quotes; mention this in caveats when relevant.
- Write caveats in plain English a non-finance reader can understand. No unexplained jargon.
- Be concise and use plain English throughout.

Answer with ONLY one JSON object, no markdown, with these keys:
{"headline": str (must name at least one specific ticker with a concrete number, e.g. "SMMT surges 17% as..." -- never a purely generic headline like "small caps swing wildly" with no ticker), "mood": "risk-on"|"risk-off"|"mixed", "summary": str (3-4 sentences, sector/breadth level, not just 1-2 tickers),
 "macro_context": [{"title": str, "detail": str}] (max 4, plain English),
 "movers": [{"ticker": str, "pct_change": number, "why": str (evidence-based if RESEARCH supports it, otherwise a factual
   description built only from that ticker's mover_stats -- never a guessed cause), "confidence": "high"|"medium"|"low"
   ("low" whenever "why" is stats-only with no RESEARCH-backed cause), "watch_today": str}] (one entry per required_tickers, no fewer),
 "open_outlook": str (2 sentences on what to watch into the 9:30 ET open, based only on RESEARCH),
 "watchlist_today": [str] (max 5), "sources": [str] (RESEARCH section names you actually used), "caveats": [str, plain English]}"""

def chat(**kw):
    """Try Qwen first (fast timeout, one retry). If it's slow, errors, or the
    key is missing, fall back to Groq so the nightly job still completes."""
    kw.setdefault("max_tokens", 3200)
    used_model = None

    for attempt in range(2):
        try:
            print(f"  [llm] trying {PRIMARY_MODEL} (attempt {attempt + 1}/2, 60s timeout)")
            resp = PRIMARY_CLIENT.chat.completions.create(model=PRIMARY_MODEL, **kw)
            used_model = PRIMARY_MODEL
            print(f"  [llm] {PRIMARY_MODEL} responded")
            return resp, used_model
        except openai.RateLimitError:
            print("  [llm] Qwen rate limited, waiting 10s...")
            time.sleep(10)
        except (openai.APITimeoutError, openai.APIStatusError, openai.APIConnectionError) as e:
            print(f"  [llm] Qwen failed ({type(e).__name__}: {str(e)[:150]})")
            break

    if FALLBACK_CLIENT is None:
        raise RuntimeError("Qwen failed and no GROQ_API_KEY is set for fallback")

    print(f"  [llm] falling back to {FALLBACK_MODEL} via Groq")
    for attempt in range(3):
        try:
            resp = FALLBACK_CLIENT.chat.completions.create(model=FALLBACK_MODEL, **kw)
            print(f"  [llm] {FALLBACK_MODEL} (fallback) responded")
            return resp, FALLBACK_MODEL
        except openai.RateLimitError:
            print("  [llm] Groq rate limited, waiting 15s...")
            time.sleep(15)
        except openai.BadRequestError as e:
            print(f"  [llm] Groq hiccup: {str(e)[:150]}")
            break
    raise RuntimeError("Both Qwen and the Groq fallback failed")

def parse_json(text):
    text = (text or "").strip()
    a, b = text.find("{"), text.rfind("}")
    if a == -1 or b == -1:
        raise ValueError("no JSON found")
    return json.loads(text[a:b + 1])

def load_movers():
    with open(os.path.join(ROOT, "data", "overnight.json")) as f:
        data = json.load(f)
    core = [m for m in data["movers"] if m["ticker"] in CORE]
    others = [m for m in data["movers"] if m["ticker"] not in CORE and m["turnover_usdt"] >= 1_000_000][:10]
    return data, core, others

def has_signal(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "error":
                continue
            if isinstance(v, (dict, list)):
                if has_signal(v):
                    return True
            elif v not in (None, "", []):
                return True
        return False
    if isinstance(obj, list):
        return any(has_signal(x) for x in obj)
    return obj not in (None, "", [])

def looks_empty_or_broken(text):
    if not text or text.startswith("ERROR"):
        return True
    try:
        parsed = json.loads(text)
    except Exception:
        return len(text.strip()) < 5
    return not has_signal(parsed)

def build_mover_stats(core, others):
    all_rows = core + others
    core_avg = round(sum(m["pct_change"] for m in core) / len(core), 3) if core else 0
    by_pct = sorted(all_rows, key=lambda m: m["pct_change"], reverse=True)
    by_turn = sorted(all_rows, key=lambda m: m["turnover_usdt"], reverse=True)
    pct_rank = {m["ticker"]: i + 1 for i, m in enumerate(by_pct)}
    turn_rank = {m["ticker"]: i + 1 for i, m in enumerate(by_turn)}
    total = len(all_rows)
    stats = {}
    for m in all_rows:
        stats[m["ticker"]] = {
            "pct_change": m["pct_change"],
            "rank_by_move": pct_rank[m["ticker"]],
            "rank_by_move_of": total,
            "vs_core_avg": round(m["pct_change"] - core_avg, 3),
            "rank_by_turnover": turn_rank[m["ticker"]],
            "rank_by_turnover_of": total,
        }
    return stats

async def gather(core, others):
    ctx = {}
    async with connect(SIGNAL_URL) as (r, w, *_):
        async with ClientSession(r, w) as s:
            await s.initialize()

            async def call(label, name, **args):
                print(f"  [fetch] {label}")
                try:
                    res = await s.call_tool(name, args)
                    text = "\n".join(b.text for b in res.content if hasattr(b, "text"))
                except Exception as e:
                    text = f"ERROR: {type(e).__name__}: {e!r}"
                if looks_empty_or_broken(text):
                    print(f"    (no usable content)")
                    return
                ctx[label] = text[:CLIP]
                print(f"    -> got real content ({len(text)} chars)")
                await asyncio.sleep(0.3)

            top_core = sorted(core, key=lambda m: abs(m["pct_change"]), reverse=True)[:5]
            top_other = sorted(others, key=lambda m: abs(m["pct_change"]), reverse=True)[:3]
            for m in top_core:
                kw = COMPANY.get(m["ticker"], m["ticker"])
                await call(f"news:{m['ticker']}", "news_feed", action="latest", keyword=kw, limit=4, feeds=FEEDS_BIZ)
            for m in top_other:
                await call(f"news:{m['ticker']}", "news_feed", action="latest", keyword=m["ticker"], limit=3, feeds=FEEDS_BIZ)

            await call("news:Wall Street", "news_feed", action="latest", keyword="stocks", limit=4, feeds=FEEDS_MACRO)
            await call("news:Fed", "news_feed", action="latest", keyword="Federal Reserve", limit=4, feeds=FEEDS_MACRO)
            await call("rates", "rates_yields", action="rates_snapshot")
            await call("sentiment", "sentiment_index", action="current")
    return ctx

def main():
    data, core, others = load_movers()
    pcts = [m["pct_change"] for m in core]
    breadth = {"core_count": len(pcts),
               "core_avg_pct": round(sum(pcts) / len(pcts), 3) if pcts else 0,
               "advancers": sum(1 for x in pcts if x > 0),
               "decliners": sum(1 for x in pcts if x < 0)}
    mood = ("risk-on" if breadth["core_avg_pct"] > 0.5
            else "risk-off" if breadth["core_avg_pct"] < -0.5 else "mixed")

    mover_stats = build_mover_stats(core, others)
    required_tickers = [m["ticker"] for m in core] + [m["ticker"] for m in others]

    ctx = asyncio.run(gather(core, others))
    sections = "\n\n".join(f"### RESEARCH {k}\n{v}" for k, v in ctx.items()) or "(No research sources returned usable data tonight.)"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    user_msg = (f"Time now: {now}. Overnight window: last {data['window_hours']} hours.\n"
                f"required_tickers (movers array must cover exactly these, one each): {json.dumps(required_tickers)}\n"
                f"Core stock tokens: {json.dumps(core)}\n"
                f"Other notable movers: {json.dumps(others)}\n"
                f"Breadth stats (computed, authoritative): {json.dumps(breadth)}\n"
                f"mover_stats (computed, authoritative -- use for tickers with no RESEARCH-backed cause): {json.dumps(mover_stats)}\n\n"
                f"{sections}\n\nWrite the briefing JSON.")

    resp, used_model = chat(messages=[{"role": "system", "content": SYSTEM},
                                       {"role": "user", "content": user_msg}],
                             response_format={"type": "json_object"})
    briefing = parse_json(resp.choices[0].message.content)
    briefing["mood"] = mood
    briefing["breadth"] = breadth

    have = {m.get("ticker") for m in briefing.get("movers", [])}
    for t in required_tickers:
        if t not in have:
            st = mover_stats[t]
            briefing.setdefault("movers", []).append({
                "ticker": t, "pct_change": st["pct_change"],
                "why": (f"Ranked {st['rank_by_move']} of {st['rank_by_move_of']} tonight by size of move, "
                        f"{st['vs_core_avg']:+.2f} pts versus the core average."),
                "confidence": "low",
                "watch_today": "No specific catalyst on record; watch for continuation at the open.",
            })

    out = {"generated_at": data["generated_at"], "window_hours": data["window_hours"],
           "market_note": data["market_note"], "briefing": briefing,
           "core_movers": core, "other_movers": others,
           "llm_used": used_model,
           "evidence": {k: v[:600] for k, v in ctx.items()}}
    with open(os.path.join(ROOT, "data", "briefing.json"), "w") as f:
        json.dump(out, f, indent=2)
    print("\nModel used:", used_model)
    print("HEADLINE:", briefing.get("headline"))
    print("MOOD:", briefing.get("mood"))
    print(briefing.get("summary"))
    for m in briefing.get("movers", []):
        print(f'- {m.get("ticker")} {m.get("pct_change")}%: {m.get("why")} [{m.get("confidence")}]')

if __name__ == "__main__":
    main()
    
