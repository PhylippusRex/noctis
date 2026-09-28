import json, os, subprocess, time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from datetime import timedelta

def hours_since_us_close():
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("America/New_York")
    except Exception:
        tz = timezone(timedelta(hours=-4))
    now = datetime.now(tz)
    close = now.replace(hour=16, minute=0, second=0, microsecond=0)
    if close > now:
        close -= timedelta(days=1)
    while close.weekday() >= 5:
        close -= timedelta(days=1)
    return max(2, min(96, int((now - close).total_seconds() // 3600)))

OVERNIGHT_HOURS = hours_since_us_close()  # hours since the last US market close
DEEP_LIMIT = 40
MIN_TURNOVER_USDT = 50_000
CORE = ["TSLA","NVDA","AAPL","MSFT","GOOGL","AMZN","META","AMD","SPY","QQQ"]

def bgc(*args):
    last = None
    for attempt in range(3):
        p = subprocess.run(["bgc", *args], capture_output=True, text=True, timeout=120)
        try:
            if p.returncode != 0:
                raise RuntimeError(p.stderr.strip()[:300])
            return json.loads(p.stdout)["data"]
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"bgc {' '.join(args)} failed: {last}")

def stock_universe():
    rows = bgc("market", "--action", "instruments", "--category", "SPOT")
    return {r["symbol"]: r["baseCoin"] for r in rows
            if r.get("symbolType") == "stock" and r.get("status") == "online"}

def all_tickers():
    rows = bgc("market", "--action", "tickers", "--category", "SPOT")
    return {r["symbol"]: r for r in rows}

def candles(symbol, hours):
    rows = bgc("market", "--action", "candles", "--category", "SPOT",
               "--symbol", symbol, "--interval", "1H", "--limit", str(hours))
    rows = sorted(rows, key=lambda r: int(r[0]))
    return [{"ts": int(r[0]), "open": float(r[1]), "high": float(r[2]),
             "low": float(r[3]), "close": float(r[4]), "turnover": float(r[6])}
            for r in rows]

def overnight(symbol, ticker, hours):
    c = candles(symbol, hours)
    if len(c) < 2:
        return None
    start, end = c[0]["open"], c[-1]["close"]
    hi, lo = max(x["high"] for x in c), min(x["low"] for x in c)
    return {
        "symbol": symbol, "ticker": ticker,
        "start_price": start, "end_price": end,
        "pct_change": round((end - start) / start * 100, 3),
        "range_pct": round((hi - lo) / start * 100, 3),
        "turnover_usdt": round(sum(x["turnover"] for x in c), 2),
    }

def main():
    universe = stock_universe()
    tickers = all_tickers()
    print(f"Stock pairs online: {len(universe)}")

    scan = []
    for sym, base in universe.items():
        t = tickers.get(sym)
        if not t:
            continue
        ticker = base[1:] if base.startswith("r") else base
        scan.append({"symbol": sym, "ticker": ticker,
                     "pct_24h": float(t["price24hPcnt"]) * 100,
                     "turnover_24h": float(t["turnover24h"])})
    liquid = [s for s in scan if s["turnover_24h"] >= MIN_TURNOVER_USDT]

    core = [f"R{c}USDT" for c in CORE if f"R{c}USDT" in universe]
    by_move = [s["symbol"] for s in sorted(liquid, key=lambda s: abs(s["pct_24h"]), reverse=True)]
    by_vol = [s["symbol"] for s in sorted(liquid, key=lambda s: s["turnover_24h"], reverse=True)]
    deep, seen = [], set()
    for sym in core + by_move[:DEEP_LIMIT // 2] + by_vol[:DEEP_LIMIT // 2]:
        if sym not in seen:
            seen.add(sym)
            deep.append(sym)

    names = {s["symbol"]: s["ticker"] for s in scan}
    results = []
    for i, sym in enumerate(deep, 1):
        try:
            r = overnight(sym, names.get(sym, sym), OVERNIGHT_HOURS)
            if r:
                results.append(r)
        except Exception as e:
            print(f"  skip {sym}: {e}")
        print(f"  [{i}/{len(deep)}] {sym}", end="\r")
    results.sort(key=lambda r: abs(r["pct_change"]), reverse=True)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_hours": OVERNIGHT_HOURS,
        "universe_size": len(universe),
        "liquid_count": len(liquid),
        "market_note": "Outside Nasdaq/NYSE hours, rToken prices are indicative quotes, not live exchange prices.",
        "movers": results,
    }
    with open(os.path.join(ROOT, "data", "overnight.json"), "w") as f:
        json.dump(out, f, indent=2)

    print("\nTop overnight movers:")
    for r in results[:10]:
        print(f'  {r["ticker"]:6} {r["pct_change"]:+7.2f}%  range {r["range_pct"]:.2f}%  vol ${r["turnover_usdt"]:,.0f}')

if __name__ == "__main__":
    main()
