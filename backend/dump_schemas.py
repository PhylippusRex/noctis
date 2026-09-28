import asyncio, json
from mcp import ClientSession
try:
    from mcp.client.streamable_http import streamable_http_client as connect
except ImportError:
    from mcp.client.streamable_http import streamablehttp_client as connect

WANT = ["news_feed","macro_indicators","rates_yields","cross_asset","sentiment_index","global_assets"]

async def main():
    async with connect("https://datahub.noxiaohao.com/mcp") as (r, w, *_):
        async with ClientSession(r, w) as s:
            await s.initialize()
            for t in (await s.list_tools()).tools:
                if t.name in WANT:
                    sch = getattr(t, "input_schema", None) or getattr(t, "inputSchema", None)
                    print("==", t.name)
                    print((t.description or "")[:250])
                    print(json.dumps(sch, separators=(",", ":"))[:1100])
                    print()
asyncio.run(main())
