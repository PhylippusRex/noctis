import asyncio
from mcp import ClientSession
try:
    from mcp.client.streamable_http import streamable_http_client as connect
except ImportError:
    from mcp.client.streamable_http import streamablehttp_client as connect

URL = "https://datahub.noxiaohao.com/mcp"

async def main():
    async with connect(URL) as (read, write, *_):
        async with ClientSession(read, write) as s:
            await s.initialize()
            tools = await s.list_tools()
            for t in tools.tools:
                print(t.name, "-", (t.description or "")[:110].replace("\n", " "))

asyncio.run(main())
