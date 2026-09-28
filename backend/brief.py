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
MODEL = os.environ.get("LLM_MODEL", "openai/gpt-oss-120b")
FALLBACK_MODEL = os.environ.get("LLM_FALLBACK", "qwen/qwen3.8-27b")
CORE = {"TSLA","NVDA","AAPL","MSFT","GOOGL","AMZN","META","AMD","SPY","QQQ"}
COMPANY = {"TSLA":"Tesla","NVDA":"Nvidia","AAPL":"Apple","MSFT":"Microsoft",
           "GOOGL":"Google","AMZN":"Amazon","META":"Meta","AMD":"AMD",
           "SPY":"S&P 500","QQQ":"Nasdaq"}
CLIP = 1200

client = OpenAI(api_key=os.environ["GROQ_API_KEY"],
                base_url="https://api.groq.com/openai/v1")

SYSTEM = """You are Noctis, an executive night-shift analyst for traders of tokenized stocks on Bitget.
You receive overnight mover numbers (computed from Bitget data) and RESEARCH sections fetched from news, rates, macro and price tools.
Rules:
- Use ONLY the provided numbers for percentage moves. Never invent numbers or news.
- Explain a move ONLY if a RESEARCH section supports it, in your own words. Otherwise write "No clear catalyst found" and set confidence to "low".
- Never describe what an unfamiliar company or ticker does. For non-core tickers, report the numbers only.
- You have no tools. Do not call any tools.
- Outside US market hours, rToken prices are indicative quotes; mention this in caveats when relevant.
- Be concise and use plain English.
Answer with ONLY one JSON object, no markdown, with these keys:
{"headline": str, "mood": "risk-on"|"risk-off"|"mixed", "summary": str (3-4 sentences),
 "macro_context": [{"title": str, "detail": str}] (max 4),
 "movers": [{"ticker": str, "pct_change": number, "why": str, "confidence": "high"|"medium"|"low", "watch_today": str}] (max 8, core tickers first),
 "other_movers_note": str (one sentence about the biggest non-core moves, numbers only),
 "watchlist_today": [str] (max 5), "sources": [str] (names of RESEARCH sections you used), "caveats": [str]}"""

def chat(**kw):
    for model in (MODEL, MODEL, FALLBACK_MODEL):
        for attempt in range(3):
            try:
                return client.chat.completions.create(model=model, **kw)
            except openai.RateLimitError:
                print("  rate limited, waiting 25s...")
                time.sleep(25)
            except openai.BadRequestError as e:
                print("  model hiccup, retrying:", str(e)[:100])
                break
    raise RuntimeError("all model attempts failed")

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

async def gather(core):
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
                    text = f"ERROR: {e}"
                ctx[label] = text[:CLIP]

            top = core[:5]
            for m in top:
                kw = COMPANY.get(m["ticker"], m["ticker"])
                await call(f"news:{m['ticker']}", "news_feed", action="latest", keyword=kw, limit=3)
            await call("news:Wall Street", "news_feed", action="latest", keyword="Wall Street", limit=3)
            await call("news:Fed", "news_feed", action="latest", keyword="Fed", limit=3)
            await call("rates", "rates_yields", action="rates_snapshot")
            await call("fed-news", "macro_indicators", action="fomc_news")
            for m in core[:3]:
                await call(f"underlying:{m['ticker']}", "global_assets", action="price", symbol=m["ticker"])
            await call("sentiment", "sentiment_index", action="current")
    return ctx

def main():
    data, core, others = load_movers()
    ctx = asyncio.run(gather(core))
    sections = "\n\n".join(f"### RESEARCH {k}\n{v}" for k, v in ctx.items())
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    user_msg = (f"Time now: {now}. Overnight window: last {data['window_hours']} hours.\n"
                f"Core stock tokens: {json.dumps(core)}\n"
                f"Other notable movers: {json.dumps(others)}\n\n{sections}\n\n"
                "Write the briefing JSON.")
    text = chat(messages=[{"role": "system", "content": SYSTEM},
                          {"role": "user", "content": user_msg}],
                response_format={"type": "json_object"}).choices[0].message.content
    briefing = parse_json(text)
    out = {"generated_at": data["generated_at"], "window_hours": data["window_hours"],
           "market_note": data["market_note"], "briefing": briefing,
           "core_movers": core, "other_movers": others,
           "evidence": {k: v[:600] for k, v in ctx.items()}}
    with open(os.path.join(ROOT, "data", "briefing.json"), "w") as f:
        json.dump(out, f, indent=2)
    print("\nHEADLINE:", briefing.get("headline"))
    print("MOOD:", briefing.get("mood"))
    print(briefing.get("summary"))
    for m in briefing.get("movers", [])[:5]:
        print(f'- {m.get("ticker")} {m.get("pct_change")}%: {m.get("why")} [{m.get("confidence")}]')

if __name__ == "__main__":
    main()
