import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["GROQ_API_KEY"],
    base_url="https://api.groq.com/openai/v1",
)
MODEL = os.environ.get("LLM_MODEL", "llama-3.3-70b-versatile")

print("Models available to your key:")
for m in sorted(x.id for x in client.models.list().data):
    print("  ", m)

r = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": "In one sentence: what is a morning market briefing?"}],
)
print("\nReply from", MODEL, ":\n", r.choices[0].message.content)
