<div align="center">

<br />

<!-- Logo block — swap the ⚡ for your real SVG any time -->
<img src="https://img.shields.io/badge/⚡-ChargeZone-F97316?style=for-the-badge&labelColor=0f172a&color=F97316" alt="ChargeZone" height="42" />

<h1>CZ&nbsp;Self‑Eval</h1>

<p>
  <b>Testing &amp; evaluation dashboard for the ChargeZone AI Agent.</b>
  <br />
  Mine real chats with AI · Score agent health · Catch regressions before they ship.
</p>

<p>
  <img alt="Node"        src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white" />
  <img alt="React"       src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=0f172a" />
  <img alt="Vite"        src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white" />
  <img alt="Tailwind"    src="https://img.shields.io/badge/Tailwind-4-06b6d4?logo=tailwindcss&logoColor=white" />
  <img alt="Express"     src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white" />
  <img alt="MongoDB"     src="https://img.shields.io/badge/MongoDB-optional-47A248?logo=mongodb&logoColor=white" />
  <img alt="LLMs"        src="https://img.shields.io/badge/LLMs-Anthropic%20%2F%20OpenAI%20%2F%20Gemini-8b5cf6" />
</p>

<p>
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-the-seven-screens">Screens</a> ·
  <a href="#-generate-evidence-with-ai">Generate Evidence</a> ·
  <a href="#-how-the-cz-score-is-computed">CZ Score</a> ·
  <a href="#-api-reference">API</a> ·
  <a href="#-troubleshooting">Troubleshooting</a>
</p>

<br />

</div>

---

## ✨ At a glance

<table>
<tr>
<td width="50%" valign="top">

**What it does**

- Drives the agent with synthetic conversations (single turns + multi-turn flows).
- **Mines real chat history with AI** to generate new regression evidence.
- Replays failing production traces as locked regressions.
- Scores agent health as **one 0–100 number** (the CZ Score).
- Surfaces per-agent pass rates and per-scenario detail.
- Persists every run to **disk + MongoDB** — queryable, exportable.
- Lets QA flag bad replies, and teams triage them in one queue.

</td>
<td width="50%" valign="top">

**Who it's for**

- **Engineers** shipping prompt or routing changes — use it as a release gate.
- **QA** stress-testing flows — flag bad replies straight to the review queue.
- **Product** watching health over time — glanceable score + trend chart.
- **Agent authors** adding regression evidence — single source of truth,
  plus AI help mining real chats.

</td>
</tr>
</table>

---

## 🧭 Table of contents

| # | Section |
|---|---------|
| 1 | [🤖 What is the CZ Agent?](#-what-is-the-cz-agent) |
| 2 | [💡 Why this exists](#-why-this-exists) |
| 3 | [🏗 Architecture](#-architecture) |
| 4 | [🚀 Quick start](#-quick-start) |
| 5 | [🖥 The seven screens](#-the-seven-screens) |
| 6 | [🪄 Generate Evidence with AI](#-generate-evidence-with-ai) |
| 7 | [🛡 Run reliability](#-run-reliability) |
| 8 | [🗂 Data layout](#-data-layout) |
| 9 | [📊 How the CZ Score is computed](#-how-the-cz-score-is-computed) |
| 10 | [🔌 API reference](#-api-reference) |
| 11 | [⚙️ Environment variables](#️-environment-variables) |
| 12 | [🔁 CI integration](#-ci-integration) |
| 13 | [🛠 Troubleshooting](#-troubleshooting) |
| 14 | [📁 Project layout](#-project-layout) |

---

## 🤖 What is the CZ Agent?

The **ChargeZone AI Agent** is the LLM-powered conversational assistant behind
ChargeZone's WhatsApp support and in-app chat. It's a **multi-agent system** —
six specialised sub-agents sit behind an orchestrator that routes each incoming
message to the right one:

<table>
<tr><th width="16%">Sub-agent</th><th>What it handles</th></tr>
<tr><td>🔍 <b>Discovery</b></td><td>Finding chargers, filtering by connector type, directions, station details.</td></tr>
<tr><td>💳 <b>Payment</b></td><td>Wallet balance, top-ups, invoices, transaction history, billing disputes.</td></tr>
<tr><td>⚡ <b>Session</b></td><td>Starting / stopping charging sessions, connector selection, booking flows.</td></tr>
<tr><td>🎧 <b>Support</b></td><td>Refunds, OTP failures, RFID issues, emergency / safety escalations.</td></tr>
<tr><td>👤 <b>New User</b></td><td>Registration flow, name capture, phone verification for first-time users.</td></tr>
<tr><td>🔁 <b>Session Flows</b></td><td>Real multi-turn booking flows extracted from production LangSmith traces.</td></tr>
</table>

---

## 💡 Why this exists

> **LLM agents silently regress.** A prompt tweak that makes Discovery better
> at Bangalore can quietly break Payment's Hindi flow.
> Manual QA can't catch that — too many paths, humans get bored.

CZ Self-Eval closes that gap with **four concrete promises**:

<table>
<tr>
<td align="center" width="25%">
<h4>🔒<br />Lock every regression</h4>
<sub>Each production bug becomes a named scenario with assertions that re-run forever.</sub>
</td>
<td align="center" width="25%">
<h4>📈<br />One number to watch</h4>
<sub>The CZ Score (0–100) is a weighted composite. Drops below threshold = CI blocks the release.</sub>
</td>
<td align="center" width="25%">
<h4>🔍<br />30-second root-cause</h4>
<sub>Per-agent pass rates, per-scenario rubric scores, raw response text side-by-side.</sub>
</td>
<td align="center" width="25%">
<h4>🤝<br />Grows itself with AI</h4>
<sub>Feed real chat sessions to the AI miner → it drafts new regression scenarios you review + save.</sub>
</td>
</tr>
</table>

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Self-Eval Dashboard                           │
│   React 19 + Vite 8 + Tailwind 4   •   http://localhost:5173         │
│                                                                       │
│   Arena · Live Chat · Chat History · Chat Review                     │
│   Eval Evidence · Eval Score · Questions Lab                         │
└────────────────────────────┬─────────────────────────────────────────┘
                             │   HTTP + SSE (proxied by Vite)
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Self-Eval Server                                │
│   Node 20+ · Express 4   •   http://localhost:4001                   │
│                                                                       │
│   ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐     │
│   │ Eval pipeline│  │ Judge ensemble│  │ Evidence generator    │     │
│   │  (N runs,    │  │  (3-model    │  │  mines chats with AI  │     │
│   │   scoring)   │  │   LLM vote)  │  └────────────────────────┘     │
│   └──────┬───────┘  └──────┬───────┘                                 │
└──────────┼─────────────────┼──────────────────────────────────────────┘
           │                 │
           ▼                 ▼
    ┌──────────────┐  ┌──────────────────────────────┐     ┌──────────┐
    │  CZ Agent    │  │  LLM APIs                    │     │ MongoDB  │
    │  (WhatsApp   │  │  Anthropic / OpenAI / Gemini │     │ (sessions│
    │   simulate)  │  │                              │     │ + runs)  │
    └──────────────┘  └──────────────────────────────┘     └──────────┘
```

**Tech stack:**

- **Dashboard:** React 19, Vite 8, Tailwind 4, Framer Motion, lucide-react.
- **Server:** Node 20+, Express, Mongoose. MongoDB optional (primary
  persistence for runs + sessions; everything falls back to file-backed JSON
  when Mongo is offline).
- **LLM ladder:** Anthropic → OpenAI → Gemini → deterministic heuristic.
- **Evidence source:** TypeScript datasets in the companion agent repo,
  synced into `data/eval-evidence.json` by `scripts/sync-eval-evidence.js`.
  User-generated evidence lives in `data/eval-evidence-user.json`.

---

## 🚀 Quick start

### Prerequisites

| Tool        | Why you need it                                                |
| ----------- | -------------------------------------------------------------- |
| **Node 20+** | Runs both the server and the Vite dev server.                  |
| **MongoDB** *(optional)* | Chat sessions + eval run persistence. Everything works without it via disk fallback. |
| **CZ agent endpoint** | Eval Score needs a real agent to hit. Default: dev cluster.  |
| **Anthropic / OpenAI / Gemini key** *(optional)* | Enables the 3-model LLM judge AND the Generate-Evidence AI miner. |

### First-time setup

```bash
git clone https://github.com/HimanshuMDev/CZ-Self-Eval.git
cd CZ-Self-Eval
npm run install:all                      # root + server + dashboard deps
cp server/.env.example server/.env       # edit with your values
```

### Run locally

```bash
npm run dev
```

| Service    | URL                        |
| ---------- | -------------------------- |
| Dashboard  | http://localhost:5173      |
| API server | http://localhost:4001      |

### Production build

```bash
npm run build                    # typechecks and bundles the dashboard
npm --prefix server start        # serves built dashboard + API on PORT
```

### Refresh evidence from the agent repo

When the agent team adds or edits dataset cases:

```bash
node scripts/sync-eval-evidence.js
```

---

## 🖥 The seven screens

Navigation is grouped into **Testing**, **Evaluation**, and **Tools**.

```
┌─────────────── TESTING ──────────────┐   ┌──── EVALUATION ────┐   ┌── TOOLS ──┐
│  Arena · Live Chat · Chat History ·  │   │  Eval Evidence ·   │   │  Questions│
│  Chat Review                         │   │  Eval Score        │   │  Lab      │
└──────────────────────────────────────┘   └────────────────────┘   └───────────┘
```

<details open>
<summary><b>1. ⚔️  Arena — dual-agent simulation</b></summary>

Pick a sub-agent, a scenario, and a language — the backend spawns an LLM "user"
persona and streams a live back-and-forth against the real CZ agent. A judge
model rates the conversation and explains why.

Use for exploratory testing, not release gates.
</details>

<details open>
<summary><b>2. 💬 Live Chat — real-time manual testing</b></summary>

QA types messages as a WhatsApp user; every reply is flaggable (pass/fail/bug/slow)
with optional comment. **Persistent save badge** shows "Saved · Ns ago" so
you never lose work. Sessions auto-save after 1.5 s of inactivity. Export to
Markdown or JSON.
</details>

<details open>
<summary><b>3. 🗂 Chat History — past sessions + compare</b></summary>

Grid of saved sessions with health dots. **Compare** replays every user
message through the current agent and diffs against the old responses —
regressions highlighted per turn.
</details>

<details open>
<summary><b>4. 🚩 Chat Review — flagged replies across sessions</b></summary>

Aggregates every flagged agent message into one list. Sort by severity,
date, or session. **Mark reviewed** (persists in `localStorage`) turns the
list into a working queue; **hide reviewed** shows only open items.
**Auto-refresh on window focus** picks up new flags without manual reload.
**Copy-to-clipboard** on any response for pasting into Jira / Slack.
</details>

<details open>
<summary><b>5. 📚 Eval Evidence — source of truth for all agent datasets</b></summary>

All agent scenarios grouped by sub-agent, with filters (agent, kind, case type,
eval type). Click any row for a detail panel showing the full task payload.

**New features:**
- **✨ Generate Evidence button** — pick one or more chat sessions and the
  AI mines them into new regression scenarios (see [next section](#-generate-evidence-with-ai))
- **Copy-ID** on every row (one click → clipboard)
- **Collapse / expand** per agent, state persists across reloads
- **Sticky section headers** — always see which agent you're scrolling through

Bundled scenarios (synced from the agent repo) and user-generated scenarios
are merged at runtime. Regenerate scenarios with
`node scripts/sync-eval-evidence.js`.
</details>

<details open>
<summary><b>6. 📊 Eval Score — the agent's health number</b></summary>

The marquee screen. Streams live via Server-Sent Events.

- **Hero card** — CZ Score (0–100), confidence ± band, delta vs. rolling
  baseline, status band, pass / fail / flaky counts.
- **30-day trend chart** + **component radar** (5-axis visual health shape).
- **5 component cards** with info-tooltip popovers explaining exactly what
  each metric measures.
- **Per-agent rollup** — pass rate, median score, top failure per sub-agent.
- **Scenario report cards** — rubric dimension bars, per-run text, latency
  histogram, judge agreement, "Only failing" filter.
- **Judges-disagreed panel** — scenarios split between the 3 judges.
- **Recent runs sidebar** — click to load any past run.

**Run Eval Score** opens a configurator:

| Option          | Values                                 | Notes |
| --------------- | -------------------------------------- | ----- |
| Scope           | `mustPass` / `all` / **one agent**     | Pick a specific sub-agent for a faster targeted run |
| Target agent    | 6 buttons (Discovery / Payment / …)    | Appears when scope = "one agent" |
| N (repeats)     | 1 / 3 / 5 / 7                          | Higher N = more stable median; use 5 for CI gate |
| Use LLM judge   | on / off                               | Needs `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` |

**Runs never hang silently** — see [Run reliability](#-run-reliability).
</details>

<details open>
<summary><b>7. 🧪 Questions Lab — test question bank</b></summary>

Generate questions from real chat history via LLM (or template fallback),
add custom ones, filter, sort, search, delete. **Filter and sort state
persists in `localStorage`** so you don't lose your place.
</details>

---

## 🪄 Generate Evidence with AI

The **Generate Evidence** button on Eval Evidence turns real chat data into
locked regression tests — in under a minute.

### Three-step flow

1. **Pick chats** — checkbox list of your saved Live Chat sessions, with
   flag-count chips. Search, pick how many candidates (3 / 5 / 10), toggle
   "Use LLM".
2. **Review candidates** — AI returns N scenarios matching your exact schema.
   Each card is accept-by-default; uncheck to skip. Click **Edit** to inline-
   edit name, agent, case type, eval type, description, user message, and
   the `responseMustContainOneOf` / `responseMustNotContain` chip lists.
3. **Save** — picks land in `data/eval-evidence-user.json` and immediately
   merge into the Eval Evidence list. Future Eval Score runs include them
   automatically.

### LLM backend ladder

Tries in order, whichever key is set:

1. **Anthropic** (`ANTHROPIC_API_KEY`) — Claude Sonnet
2. **OpenAI** (`OPENAI_API_KEY`) — gpt-4o-mini
3. **Gemini** (`GEMINI_API_KEY`) — gemini-2.5-flash
4. **Heuristic fallback** — no API key needed; deterministic but less nuanced

The heuristic isn't dumb — it walks structured turn pairs, uses `agentType`
metadata from each reply for correct routing, extracts real phrases from
agent replies as assertions (including currency amounts, place names,
distances), flags safety questions, and detects wrong-routing bugs from QA
flags. Scenarios have distinctive names like `payment: mis-routed to discovery —
"mera kitna paisa hai wallet mein?"`.

### What each generated scenario looks like

```json
{
  "id": "user-mob...",
  "name": "payment: mis-routed to discovery — \"mera kitna paisa hai wallet mein?\"",
  "agent": "payment",
  "caseType": "negative",
  "evalType": "regression",
  "tags": ["chat-mined", "regression-candidate", "routing-bug", "hinglish", "flag-fail"],
  "description": "Locks in correct routing to payment (was wrongly routed to discovery at turn 3 of session chat_abc).",
  "input": {
    "userMessage": "mera kitna paisa hai wallet mein?",
    "userId": "eval-mined-...",
    "channel": "whatsapp"
  },
  "codeGradedCriteria": {
    "expectedAgentType": "payment",
    "responseMustBeNonEmpty": true,
    "responseMustContainOneOf": ["₹", "wallet", "balance", "paisa"],
    "responseMustNotContain": ["charging station", "find a charger", "I encountered an issue"]
  }
}
```

---

## 🛡 Run reliability

Eval runs are long (sometimes 30+ minutes) and make hundreds of network
calls. Four layers keep them honest:

| Layer | What it does | Tunable env var |
| ----- | ------------ | --------------- |
| **Agent call timeout** | 45s per call; 1 automatic retry on transient network errors (ECONNRESET, 5xx, timeout) | via `opts.timeoutMs` |
| **LLM judge timeout** | 30s per judge call; falls back to heuristic on timeout, run continues | `CZ_JUDGE_TIMEOUT_MS` |
| **Per-scenario wall-clock** | 3 minutes per scenario — a misbehaving scenario can't freeze the queue | `CZ_SCENARIO_TIMEOUT_MS` |
| **Whole-run wall-clock** | 20 minutes total — emits error event if exceeded | `CZ_EVAL_RUN_TIMEOUT_MS` |

Plus:

- **SSE keep-alive heartbeats** every 15 s so corporate proxies can't close
  the progress stream mid-run.
- **Scenario-level heartbeat** emits a `progress` event every 10 s while any
  scenario is working, so the dashboard's "No progress for 60 s" stuck
  indicator never fires during normal long calls.
- **Fast-fail on unreachable agent** — 3 consecutive network failures aborts
  the run with `Fix CZ_AGENT_URL in self-eval/.env and run again.`
- **Stuck-run UI indicator** — the running progress strip turns red after
  60 s of silence from the SSE stream with a one-click Cancel button.

---

## 🗂 Data layout

```
data/
├── eval-evidence.json          ← canonical scenario store (synced from agent repo)
├── eval-evidence-user.json     ← user-authored + AI-generated scenarios
├── golden.json                 ← user-authored Golden Set (legacy)
├── eval-runs/
│   ├── index.json              ← one-line summary per past run
│   └── <runId>.json            ← full Eval Score report for each run
├── chat-sessions.json          ← legacy; real storage is in Mongo
└── sandbox.json                ← custom Questions Lab items
```

Every run is also **mirrored into MongoDB** (`evalruns` collection) when
Mongo is connected — so you can browse / query / export full history via
MongoDB Compass, another app, or the bulk-export endpoint.

> 💡 **Why plain JSON?** Git-friendly diffs between runs, zero-dependency
> startup (works without any external service), trivially portable — zip
> `data/` and you have a perfect replica of any run.

---

## 📊 How the CZ Score is computed

Each run produces scores on **five weighted components**:

| Component           | Weight  | What it measures                                                                           |
| ------------------- | ------- | ------------------------------------------------------------------------------------------ |
| 🛡 Golden Pass Rate    | **40%** | % of scenarios that pass code-graded assertions AND the rubric floor. This is the gate.    |
| 🎯 Rubric Average      | **30%** | Weighted median across 5 rubric dimensions (goal, routing, efficiency, accuracy, quality). |
| ✨ Hallucination-free  | **15%** | % of replies with no fabricated bookings, balances, or facts.                              |
| 🔀 Routing Accuracy    | **10%** | % of messages handled by the correct sub-agent.                                            |
| ⏱ Latency SLA         | **5%**  | % of replies within the 10 s budget.                                                       |

```
czScore = 0.40·golden + 0.30·rubric + 0.15·hallucFree + 0.10·routing + 0.05·latency
```

**Status bands**

| Band           | czScore  | Meaning                         |
| -------------- | -------- | ------------------------------- |
| 🟢 Excellent    | ≥ 90     | Ship it.                        |
| 🟡 Good         | 75 – 89  | Healthy, watch for regressions. |
| 🟠 Degraded     | 50 – 74  | Investigate before release.     |
| 🔴 Critical     | < 50     | Do not ship — blocks CI.        |

### Matching & scoring — is AI used?

| Layer                   | Uses AI? | Details |
| ----------------------- | -------- | ------- |
| Code-graded pass/fail   | ❌ No    | Pure substring matching + routing check |
| Rubric (LLM judge)      | ✅ Yes *(if key)* | 3-judge ensemble, median score. Heuristic fallback if no key |
| Hallucination detection | ❌ No    | Regex on known fabrication patterns |
| Latency SLA             | ❌ No    | Numeric compare vs 10 s budget |

The LLM judge is the biggest quality lever — setting any of the three API
keys is strongly recommended for trustworthy scores.

---

## 🔌 API reference

All paths prefixed with `/api`. Dashboard calls go through the Vite dev
proxy to `localhost:4001`.

<details>
<summary><b>Eval Score</b></summary>

| Method | Path                              | Notes                                       |
| ------ | --------------------------------- | ------------------------------------------- |
| GET    | `/eval-score/latest`              | Most recent completed run.                  |
| GET    | `/eval-score/trend?days=30`       | Rolling trend for the chart.                |
| GET    | `/eval-score/runs`                | Last 50 runs (prefers Mongo, falls back to disk). |
| GET    | `/eval-score/runs/:id`            | Full report for one run.                    |
| DELETE | `/eval-score/runs/:id`            | Delete from disk + Mongo.                   |
| POST   | `/eval-score/run`                 | Start a run → `{runId, streamUrl}`.         |
| GET    | `/eval-score/run/:id/stream`      | SSE progress stream.                        |
| GET    | `/eval-score/runs/:id/download`   | **Download one run as JSON.**               |
| GET    | `/eval-score/export/all`          | **Bulk export every stored run.**           |
| POST   | `/eval-score/import`              | **Restore / merge runs from an export.**    |

</details>

<details>
<summary><b>Eval Evidence</b></summary>

| Method | Path                                 | Notes                                  |
| ------ | ------------------------------------ | -------------------------------------- |
| GET    | `/eval-evidence`                     | Full snapshot + stats.                 |
| GET    | `/eval-evidence/scenarios`           | Flat list of scenarios.                |
| GET    | `/eval-evidence/scenarios/:id`       | One scenario in full.                  |
| GET    | `/eval-evidence/user`                | List user-authored scenarios.          |
| POST   | `/eval-evidence/user`                | Append a single scenario.              |
| POST   | `/eval-evidence/user/batch`          | Append many at once (from Save Selected). |
| PUT    | `/eval-evidence/user/:id`            | Edit one.                              |
| DELETE | `/eval-evidence/user/:id`            | Remove one.                            |
| POST   | `/eval-evidence/generate`            | **AI-mine chat sessions into candidate scenarios.** |

</details>

<details>
<summary><b>Sessions / Chat History</b> <i>(requires Mongo)</i></summary>

| Method | Path                     | Notes                                    |
| ------ | ------------------------ | ---------------------------------------- |
| GET    | `/sessions`              | List saved sessions.                     |
| GET    | `/sessions/:id`          | One session with full message history.   |
| POST   | `/sessions`              | Upsert (used by Live Chat auto-save).    |
| POST   | `/sessions/import`       | Bulk import.                             |
| DELETE | `/sessions/:id`          | Delete.                                  |
| GET    | `/sessions/export/all`   | Dump every session (used by Chat Review).|

</details>

<details>
<summary><b>Questions Lab</b></summary>

| Method | Path                           | Notes                                       |
| ------ | ------------------------------ | ------------------------------------------- |
| GET    | `/questions-bank`              | List saved questions.                       |
| POST   | `/questions-bank/preview`      | LLM-generate N questions from chat history. |
| POST   | `/questions-bank/save-batch`   | Persist a batch from the preview.           |
| POST   | `/questions-bank`              | Add one custom question.                    |
| DELETE | `/questions-bank/:id`          | Delete one.                                 |
| DELETE | `/questions-bank`              | Clear the bank.                             |

</details>

<details>
<summary><b>Arena</b></summary>

| Method | Path               | Notes                                 |
| ------ | ------------------ | ------------------------------------- |
| GET    | `/arena/personas`  | Available personas for simulation.    |
| GET    | `/arena/evidence`  | Evidence-backed scenarios.            |
| POST   | `/arena/simulate`  | Kick off a dual-agent duel.           |

</details>

---

## ⚙️ Environment variables

Put these in `server/.env`:

```dotenv
# ── Required: CZ agent endpoint to evaluate ──────────────────────────────
CZ_AGENT_URL=https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate
CZ_AGENT_TEST_FROM=919000000001
CZ_AGENT_TEST_NAME=EvalBot

# ── LLM providers (any one enables AI for Generate Evidence + Judge) ─────
# Ladder tries in order: Anthropic → OpenAI → Gemini → heuristic.
# Copy whichever key you already have in your main CZ-AI agent repo's .env.
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TEMPERATURE=0.3
GEMINI_MAX_TOKENS=3000

# ── MongoDB (optional — Live Chat, Chat History, eval run persistence) ──
MONGODB_URI=mongodb+srv://...

# ── LangSmith trace ingestion (optional) ─────────────────────────────────
LANGSMITH_API_KEY=
LANGSMITH_SESSION_ID=

# ── Reliability timeouts (ms, optional) ──────────────────────────────────
CZ_JUDGE_TIMEOUT_MS=30000             # per LLM-judge call
CZ_SCENARIO_TIMEOUT_MS=180000         # per scenario (all repeats + judge)
CZ_EVAL_RUN_TIMEOUT_MS=1200000        # whole-run wall-clock (20 min)

# ── Server tuning ────────────────────────────────────────────────────────
PORT=4001
```

---

## 🔁 CI integration

Ships with a GitHub Actions workflow (`.github/workflows/eval-golden.yml`) that:

1. Installs deps.
2. Runs `node scripts/run-golden-ci.js --all --n 3` against the must-pass scope.
3. Fails the build if any must-pass scenario regresses, **or** if the CZ Score
   drops below the configured threshold.

For PR checks, `npm run eval:ci` runs the lighter must-pass-only variant.

---

## 🛠 Troubleshooting

<details>
<summary><b>❓ <code>POST /api/eval-score/run</code> returns 404</b></summary>

The server at `localhost:4001` isn't running or has crashed. Check the
terminal running `npm run dev`. If you see `MongoDB connection error`:

- Start Mongo locally: `docker run -d -p 27017:27017 mongo`, or
- Set a reachable `MONGODB_URI` in `server/.env`, or
- Leave `MONGODB_URI` empty to run without Mongo (most features still work).

</details>

<details>
<summary><b>❓ Generate Evidence says "Using heuristic fallback"</b></summary>

No LLM API key configured. Add one of these to `server/.env` (whichever you
already have in your main CZ-AI agent repo):

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=...
```

Restart the server. The heuristic still produces useful scenarios with real
assertions — but AI output is richer.

</details>

<details>
<summary><b>❓ Eval Score runs get stuck / never finish</b></summary>

After all the reliability fixes, a stuck run is almost always an unreachable
agent. Verify:

```bash
curl -s -X POST "$CZ_AGENT_URL" -H 'Content-Type: application/json' \
  -d '{"from":"919000000001","name":"Test","message":"hi"}'
```

If that fails, fix your network (VPN, firewall) or point `CZ_AGENT_URL` at
a reachable instance.

</details>

<details>
<summary><b>❓ Dashboard shows "Failed to load evidence"</b></summary>

`data/eval-evidence.json` is missing or corrupt. Regenerate:

```bash
node scripts/sync-eval-evidence.js
```

</details>

<details>
<summary><b>❓ "Generate failed (404)" on Generate Evidence</b></summary>

Vite proxy is missing the `/api/eval-evidence` entry. Check
`dashboard/vite.config.ts` has:

```ts
'/api/eval-evidence': { target: 'http://localhost:4001', changeOrigin: true },
```

Then restart `npm run dev`.

</details>

---

## 📁 Project layout

```
self-eval/
├── dashboard/                 ← React + Vite front-end
│   ├── src/
│   │   ├── views/             ← the 7 screens
│   │   │   ├── ArenaView.tsx
│   │   │   ├── ManualChatView.tsx
│   │   │   ├── ChatHistoryView.tsx
│   │   │   ├── EvalReviewView.tsx     (Chat Review)
│   │   │   ├── EvalEvidenceView.tsx
│   │   │   ├── EvalScoreView.tsx
│   │   │   ├── SandboxView.tsx        (Questions Lab)
│   │   │   └── GenerateEvidenceModal.tsx  ← NEW: AI mining modal
│   │   ├── components/        ← NavigationRail, ErrorBoundary, …
│   │   ├── data/              ← bundled snapshots
│   │   ├── store/             ← DashboardContext (global state)
│   │   ├── api.ts             ← all HTTP/SSE clients in one place
│   │   └── App.tsx            ← routing + layout
│   ├── vite.config.ts         ← dev proxy → localhost:4001
│   └── package.json
│
├── server/                    ← Node + Express back-end
│   ├── app.js                 ← Express app + schemas + route mounts
│   ├── index.js               ← entry point
│   ├── eval-runs.js           ← /api/eval-score/* — pipeline + SSE + export
│   ├── eval-evidence.js       ← /api/eval-evidence bundled loader
│   ├── eval-evidence-user.js  ← NEW: user-authored evidence CRUD
│   ├── eval-evidence-gen.js   ← NEW: AI chat-mining generator
│   ├── evidence-runner.js     ← evidence → scoring adapter + agent caller
│   ├── score.js               ← component scoring + czScore composite
│   ├── judge.js               ← 3-model LLM judge ensemble (+Gemini)
│   ├── rubric.js              ← rubric dimensions, weights, thresholds
│   ├── golden.js              ← legacy Golden Set store
│   └── package.json
│
├── scripts/
│   ├── sync-eval-evidence.js  ← pulls evidence from the agent repo
│   └── run-golden-ci.js       ← CI entry point
│
├── data/                      ← file-backed persistence
│
├── .github/workflows/
│   └── eval-golden.yml        ← CI regression gate
│
├── package.json               ← root (concurrently runs server + dashboard)
└── README.md                  ← this file
```

---

<div align="center">

### One-paragraph pitch

<br />

<i>
CZ&nbsp;Self‑Eval turns every regression into a locked test, scores agent health
as a single 0–100 number, and lets engineering, QA, and product agree on a
release gate without arguing about anecdotes. You run it when you change a
prompt, you watch it when you ship, and you add to it every time you find a
bug — now with AI that mines real chats to draft new regression evidence
for you.
</i>

<br /><br />

<a href="#-quick-start"><img src="https://img.shields.io/badge/→_Jump_to_Quick_Start-F97316?style=for-the-badge&labelColor=0f172a" alt="Jump to Quick Start" /></a>

<br /><br />

<sub>Built with ⚡ by the ChargeZone team</sub>

</div>
