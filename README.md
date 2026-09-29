<div align="center">

# Noctis

**The night-shift analyst that refuses to guess.**

An overnight research agent that scans every tokenized US stock on Bitget,
digs up the real evidence behind each move, and writes your morning briefing
— with one hard rule: no evidence, no explanation.

[![Python](https://img.shields.io/badge/Python-3.13-blue?style=flat&logo=python)](https://www.python.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?style=flat&logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Bitget Agent Hub](https://img.shields.io/badge/Bitget-Agent_Hub-00D4AA?style=flat)](https://www.bitget.com/activity-hub/hackathon)
[![Groq](https://img.shields.io/badge/LLM-Groq-F55036?style=flat)](https://groq.com/)
[![GitHub Actions](https://img.shields.io/badge/Automation-GitHub_Actions-2088FF?style=flat&logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### Start here

| | |
|--|--|
| **No-guessing test** | see [below](#the-no-guessing-test) — a real briefing line, proving the honesty rule in output, not just in prose |
| **Live briefing** | [noctis.xyz](https://noctis-one.vercel.app/) |
| **Proof it runs unattended** | see [below](#proof-the-automation-is-real) — check `data/archive/` and the Actions tab yourself |
| **Run it yourself** | `python3 backend/collect.py && python3 backend/brief.py` — no dashboard, no manual step |
| **Demo video** | *(added once recorded — see [Status](#status))* |

</div>

---

## What Noctis is

Human traders lose the first twenty minutes of every session sifting through
overnight charts and headlines. Noctis does that sifting itself, every
night, on a schedule — and hands back a briefing rather than a wall of raw
data.

- A **scan** is a full pass over every tokenized US stock pair on Bitget,
  computing the move since the last US market close via `bitget-agent-cli`.
- A **briefing** is that scan turned into plain-English analysis, but only
  after real research — news, rates, sentiment — has been pulled through
  `bitget-signal`.
- The one rule that shapes everything: **if the research doesn't support a
  specific cause, Noctis will not invent one.** It says so, and falls back
  to describing the move by the numbers instead.

No dashboard shows you *why* a number is trustworthy. Noctis is built so the
"why" is either backed by a real source, or explicitly labeled as unbacked —
never blurred together.

---

## The no-guessing test

> Ask most "AI market analyst" tools why an obscure ticker moved overnight,
> and they will confidently make something up. Noctis is built to fail that
> temptation on purpose.

Here's a real line from a live briefing run, unedited:

```
AAPL -0.109%: AAPL fell 0.109% overnight, the 4th biggest move out of 20
tickers and 12th in turnover. [confidence: low]
```

No research source that night mentioned Apple. Instead of inventing a
headline to sound authoritative, Noctis reported the only thing it could
verify — the move's rank and size relative to the rest of the tape — and
labeled its own confidence honestly as **low**. Compare that to a ticker
where real evidence *was* found, and the confidence and tone shift
accordingly. That contrast is the whole point.

Run it yourself and check any night's output:

```bash
python3 backend/brief.py
python3 -c "import json; d=json.load(open('data/briefing.json')); [print(f'{m[\"ticker\"]}: {m[\"why\"]} [{m[\"confidence\"]}]') for m in d['briefing']['movers']]"
```

---

## Proof the automation is real

`data/archive/` isn't a mockup folder — it's a running log. Every file in it
is a real, dated briefing, committed automatically by `.github/workflows/nightly.yml`
with no human touching it:

- Check the [Actions tab](https://github.com/PhylippusRex/noctis/actions) —
  every green run is a real end-to-end pass: scan → research → write →
  publish, unattended.
- Check `data/archive/` in this repo — each file is a full night's output,
  timestamped, not staged for a demo.

---

## Why Noctis

Most "AI trading assistant" tools optimize for sounding confident. Noctis
optimizes for being checkable.

- A move's explanation is either grounded in a specific, retrieved piece of
  evidence, or it's explicitly not — there is no middle state where a guess
  is dressed up as analysis.
- The numbers (percentage move, rank, turnover) are computed in Python,
  never by the language model — the model only narrates numbers it's handed,
  it never calculates them.
- Every displayed ticker gets a real entry. Nothing silently drops to a
  blank dash just because the model ran out of attention.

The result isn't a flashier analyst. It's one you can actually audit.

---

## How it works

1. **Scan** — `backend/collect.py` calls `bitget-agent-cli` to pull every
   tokenized US stock pair, filters to the liquid ones, and computes each
   one's move since the last US market close.
2. **Research** — `backend/brief.py` queries `bitget-signal` for real news
   (via non-crypto RSS feeds), Treasury rates, and market sentiment on the
   biggest movers.
3. **Write** — an LLM (Groq) receives only the computed numbers and the
   retrieved research, and is instructed to use RESEARCH-backed causes only,
   falling back to a stats-only, non-causal description for everything else.
4. **Publish** — `.github/workflows/nightly.yml` runs the whole pipeline on
   a cron schedule and commits the result, so the static site at
   [noctis.xyz](https://noctis.xyz) is always showing the latest run.

---

## Try it

```bash
# Scan tonight's overnight moves
python3 backend/collect.py

# Research + write the briefing
python3 backend/brief.py

# See what it produced
cat data/briefing.json
```

Each run is independent and reproducible — there's no hidden state between
scans beyond what's written to `data/`.

---

## Architecture

```
┌───────────────────┐        ┌──────────────────────┐        ┌─────────────────┐
│  bitget-agent-cli   │  scan  │  backend/collect.py   │ writes │  data/           │
│  Public market data │───────▶│  Computes overnight    │───────▶│  overnight.json  │
│  for every stock    │        │  moves per ticker      │        │                  │
│  token on Bitget    │        │                        │        │                  │
└───────────────────┘        └──────────────────────┘        └─────────────────┘

┌───────────────────┐        ┌──────────────────────┐        ┌─────────────────┐
│  bitget-signal       │ research│  backend/brief.py      │ writes │  data/           │
│  News, rates,        │───────▶│  + Groq LLM             │───────▶│  briefing.json   │
│  sentiment tools     │        │  No-guessing rule       │        │  archive/*.json  │
└───────────────────┘        └──────────────────────┘        └─────────────────┘
                                                                          │
                                              nightly cron ───────────────┘
                                          .github/workflows/nightly.yml
                                                                          │
                                                                          ▼
                                                            ┌─────────────────────┐
                                                            │  web/ (static site)  │
                                                            │  Reads briefing.json │
                                                            │  directly, no build  │
                                                            └─────────────────────┘
```

```
noctis/
├── backend/
│   ├── collect.py           # Scans Bitget stock tokens, computes overnight moves
│   └── brief.py              # Researches via bitget-signal, writes the briefing
├── data/
│   ├── overnight.json        # Latest scan output
│   ├── briefing.json         # Latest published briefing
│   └── archive/               # One dated file per night, plus index.json
├── web/
│   ├── index.html
│   ├── style.css
│   └── app.js                 # Renders briefing.json client-side, no framework
└── .github/workflows/
    └── nightly.yml             # Runs the full pipeline on a schedule
```

---

## Running locally

```bash
git clone https://github.com/PhylippusRex/noctis.git
cd noctis

python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
npm install -g @bitget-ai/bitget-agent-cli

export GROQ_API_KEY=your-key-here

python3 backend/collect.py
python3 backend/brief.py

python3 -m http.server 8080
# open http://127.0.0.1:8080/web/
```

### Running the nightly job on GitHub

Add `GROQ_API_KEY` as a repository secret under **Settings → Secrets and
variables → Actions**, then either wait for the scheduled cron in
`nightly.yml` or trigger it manually from the **Actions** tab.

---

## Status

Built for the **Bitget AI Hackathon S2** — Track 3: Personalized Research
Workstation.

- The overnight scan is real market data from Bitget's public API — not
  sample or seeded data.
- The research layer (news, rates, sentiment) is queried live from
  `bitget-signal` on every run; a couple of the tool's endpoints
  (`rates_yields`'s deeper fields, `fomc_news`, real-stock price lookups)
  currently return empty on the public instance and are skipped rather than
  faked — a known gap, not hidden.
- The no-guessing rule is enforced in the prompt and verified in real output
  (see [above](#the-no-guessing-test)), not just asserted in this README.
- The nightly pipeline has run and published automatically on GitHub Actions
  across multiple real nights — check the Actions tab for the history.
- Custom domain (`noctis.xyz`) and hosting are being finalized.
- Demo video: added once recorded.

---

## License

MIT — see [LICENSE](./LICENSE).

---

<div align="center">

**Built by [Philippus](https://github.com/PhylippusRex)** for the Bitget AI Hackathon S2

</div>
