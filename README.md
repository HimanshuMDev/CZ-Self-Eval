<div align="center">

<br />

<!-- Logo block — swap the ⚡ for your real SVG any time -->
<img src="https://img.shields.io/badge/⚡-ChargeZone-F97316?style=for-the-badge&labelColor=0f172a&color=F97316" alt="ChargeZone" height="42" />

<h1>CZ&nbsp;Self‑Eval</h1>

<p>
  <b>Testing &amp; evaluation dashboard for the ChargeZone AI Agent.</b>
  <br />
  Simulate conversations · Score agent quality · Catch regressions before they ship.
</p>

<p>
  <img alt="Node"        src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white" />
  <img alt="React"       src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=0f172a" />
  <img alt="Vite"        src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white" />
  <img alt="Tailwind"    src="https://img.shields.io/badge/Tailwind-4-06b6d4?logo=tailwindcss&logoColor=white" />
  <img alt="Express"     src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white" />
  <img alt="MongoDB"     src="https://img.shields.io/badge/MongoDB-optional-47A248?logo=mongodb&logoColor=white" />
  <img alt="LLM judges"  src="https://img.shields.io/badge/LLM%20Judges-Anthropic%20%2F%20OpenAI-8b5cf6" />
</p>

<p>
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-the-seven-screens">Screens</a> ·
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

- Drives the agent with synthetic conversations.
- Replays failing production traces as locked regressions.
- Scores agent health as **one 0–100 number** (the CZ Score).
- Surfaces per-agent pass rates and per-scenario detail.
- Lets QA flag bad replies, and teams triage them in one queue.

</td>
<td width="50%" valign="top">

**Who it's for**

- **Engineers** shipping prompt or routing changes — use it as a gate.
- **QA** stress-testing flows — flag bad replies straight to the review queue.
- **Product** watching health over time — glanceable score + trend chart.
- **Agent authors** adding regression evidence — single source of truth.

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
| 6 | [🗂 Data layout](#-data-layout) |
| 7 | [📊 How the CZ Score is computed](#-how-the-cz-score-is-computed) |
| 8 | [🔌 API reference](#-api-reference) |
| 9 | [⚙️ Environment variables](#️-environment-variables) |
| 10 | [🔁 CI integration](#-ci-integration) |
| 11 | [🛠 Troubleshooting](#-troubleshooting) |
| 12 | [📁 Project layout](#-project-layout) |

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

Sub-agents use tool calls (MCP servers) to hit real CZ APIs — Redis context,
booking service, wallet, and so on.

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
<sub>Per-agent pass rates, per-scenario rubric scores, and raw response text side-by-side.</sub>
</td>
<td align="center" width="25%">
<h4>🤝<br />Non-engineers can contribute</h4>
<sub>QA flags → Chat Review → promote to Evidence. No Git required.</sub>
</td>
</tr>
</table>

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Self-Eval Dashboard                           │
│                                                                       │
│   React 19 + Vite 8 + Tailwind 4   •   http://localhost:5173         │
│                                                                       │
│   Arena · Live Chat · Chat History · Chat Review                     │
│   Eval Evidence · Eval Score · Questions Lab                         │
└────────────────────────────┬─────────────────────────────────────────┘
                             │   HTTP + SSE (proxied by Vite)
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Self-Eval Server                                │
│                                                                       │
│   Node 20+ · Express 4   •   http://localhost:4001                   │
│                                                                       │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│   │ Eval pipeline│  │ Judge ensemble│  │ Session / history store │   │
│   │   (N runs,   │  │  (3-model    │  │   (MongoDB, optional)    │   │
│   │   scoring)   │  │   LLM vote)  │  └──────────────────────────┘   │
│   └──────┬───────┘  └──────┬───────┘                                 │
└──────────┼─────────────────┼──────────────────────────────────────────┘
           │                 │
           ▼                 ▼
    ┌──────────────┐  ┌──────────────────────┐
    │  CZ Agent    │  │  LLM APIs            │
    │  (WhatsApp   │  │  (Anthropic / OpenAI)│
    │   simulate)  │  │                      │
    └──────────────┘  └──────────────────────┘
```

**Key design notes**

- **Dashboard and server are isolated.** Dashboard is a pure SPA; the server is
  a plain Express app. Either can be swapped without touching the other.
- **MongoDB is optional.** The eval pipeline is entirely file-backed — the
  server boots and serves eval runs even if Mongo is down.
- **Evidence is authored elsewhere.** The agent repo owns the TypeScript
  dataset files. A sync script snapshots them into JSON for this project, so
  there's one source of truth and one review path (PRs on the agent repo).

---

## 🚀 Quick start

### Prerequisites

| Tool        | Why you need it                                                |
| ----------- | -------------------------------------------------------------- |
| **Node 20+** | Runs both the server and the Vite dev server.                  |
| **MongoDB** *(optional)* | Live Chat + Chat History persistence. Everything else works without it. |
| **CZ agent endpoint** | Eval Score needs a real agent to hit. Default: dev cluster.  |
| **Anthropic / OpenAI key** *(optional)* | Enables the 3-model LLM judge ensemble. |

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

Each screen answers one precise question:

<details open>
<summary><b>1. ⚔️  Arena — dual-agent simulation</b></summary>

> *"How does the agent handle a specific persona on a specific scenario,
> end-to-end?"*

Pick a sub-agent, a scenario (evidence-backed or custom), and a language
(English / Hindi / Hinglish). The backend spawns an LLM "user" persona and
streams a live back-and-forth against the real CZ agent. A judge model rates
the conversation at the end and explains why.

**Use it for:** exploratory testing — see what the agent *could* do, not to
gate a release.

</details>

<details open>
<summary><b>2. 💬 Live Chat — real-time manual testing</b></summary>

> *"Does this specific message get the right reply right now?"*

QA types messages as a WhatsApp user would. Every turn logs response time,
agent type, and suggested-reply buttons. Any reply can be **flagged**
(`pass` / `fail` / `bug` / `slow`) with a comment — flags roll up into
**Chat Review**.

Sessions auto-save after 1.5 s of inactivity. Test-user profiles are
switchable so you can simulate registered users, new users, or low-balance
users. Transcripts export to Markdown or JSON.

</details>

<details open>
<summary><b>3. 🗂 Chat History — past sessions + compare</b></summary>

> *"Did we break anything since this session was recorded?"*

Grid of saved Live Chat sessions with health dots (red / violet / amber for
fails / bugs / slow). Click to see the full transcript.

**The killer feature:** **Compare.** Replay every user message from the
selected session through the current agent, diff responses via bigram
similarity, and get a per-turn "same / changed / regressed" verdict. Saved
as reports so you can trend regression count across builds.

</details>

<details open>
<summary><b>4. 🚩 Chat Review — flagged replies across sessions</b></summary>

> *"What does QA think is broken right now?"*

Aggregates every flagged agent message across every session into one list.
Filter by flag type, sort by severity / date / session, search, export.

- **Mark reviewed** — persisted in `localStorage`, turns the list into a
  working queue.
- **Hide reviewed** — shows only open items.
- **Auto-refresh on focus** — flags from Live Chat show up here without a
  manual reload.
- **Copy response** — one click, paste into Jira or Slack.

</details>

<details open>
<summary><b>5. 📚 Eval Evidence — source of truth for all agent datasets</b></summary>

> *"Every test we have ever written — what are they?"*

230 scenarios across six sub-agents, grouped by agent, with filters (agent,
kind, case type, eval type) and a detail side panel exposing the raw task
payload.

- **Read-only by design.** Authoring happens in the agent repo's TypeScript
  dataset files. `sync-eval-evidence.js` snapshots them here.
- **Copy-ID** per case — paste into Jira or run logs to jump back.
- **Collapse / expand per agent**, state persisted across reloads.

</details>

<details open>
<summary><b>6. 📊 Eval Score — the agent's health number</b></summary>

> *"Is the agent healthy enough to ship?"*

**The marquee screen.** Start a multi-judge evaluation run, watch the score
come back live via Server-Sent Events.

- **Hero card** — CZ Score (0–100), confidence band, delta vs. baseline,
  status band, passed / failed / flaky counts.
- **30-day trend chart** — one dot per completed run, colour-coded.
- **Component radar** of the five sub-scores (visual health shape).
- **Five component cards** with info-tooltips on every metric.
- **Per-agent rollup** — pass rate, median score, flaky count, top failure
  per sub-agent.
- **Scenario report cards** — rubric dimension bars, per-run text, latency
  histogram, judge agreement, "Only failing" filter.
- **Judges-disagreed panel** — scenarios where the 3-judge ensemble split.
- **Recent runs sidebar** — load any past run, delete old ones.

The **Run Eval Score** button opens a configurator:

| Option          | Values                                 | Notes                                           |
| --------------- | -------------------------------------- | ----------------------------------------------- |
| Scope           | `mustPass` / `all` / `tag` / `agent`   | `mustPass` is the CI gate. `all` = full check.  |
| N (repeats)     | 1 / 3 / 5 / 7                          | Higher N = more stable median. Use 5 for gate.  |
| Use LLM judge   | on / off                               | Needs `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.  |

</details>

<details open>
<summary><b>7. 🧪 Questions Lab — test question bank</b></summary>

> *"What are the hardest questions our agent has seen — and have we covered them?"*

Generate questions from real chat history via LLM (falls back to templates
if no history), add custom ones, filter, sort, search, delete. Filter and
sort preferences persist in `localStorage`.

Questions are categorised (`charging`, `payment`, `registration`, `fault`,
`support`, `account`, `general`) and tagged by source (`ai` / `history` /
`custom`).

</details>

---

## 🗂 Data layout

Everything not in Mongo lives under `data/`:

```
data/
├── eval-evidence.json          ← canonical scenario store (synced from agent repo)
├── golden.json                 ← user-authored Golden Set scenarios (legacy)
├── eval-runs/
│   ├── index.json              ← one-line summary per past run
│   └── <runId>.json            ← full Eval Score report for each run
├── chat-sessions.json          ← legacy; real storage is in Mongo
└── sandbox.json                ← custom Questions Lab items
```

> 💡 **Why plain JSON?**
> Git-friendly diffs between runs, zero-dependency startup (works without
> any external service), and trivially portable — zip `data/` and you have
> a perfect replica of any run.

---

## 📊 How the CZ Score is computed

Each run produces scores on **five weighted components**:

| Component           | Weight  | What it measures                                                                                  |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| 🛡 Golden Pass Rate    | **40%** | % of scenarios that pass code-graded assertions AND the rubric floor. This is the gate.           |
| 🎯 Rubric Average      | **30%** | Weighted median across 5 rubric dimensions (goal, routing, efficiency, accuracy, quality).         |
| ✨ Hallucination-free  | **15%** | % of replies with no fabricated bookings, balances, or facts.                                     |
| 🔀 Routing Accuracy    | **10%** | % of messages handled by the correct sub-agent.                                                   |
| ⏱ Latency SLA         | **5%**  | % of replies within the 10 s budget.                                                              |

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

**Confidence (± N)** captures how much the score might move if you reran
the same evaluation — a function of scenario flakiness and judge
disagreement. Low ± = trustworthy number.

Rubric config lives in `server/rubric.js`. Any change produces a new
`configHash`, stamped on every run — runs with different hashes are marked
non-comparable so you never compare apples to oranges.

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
| GET    | `/eval-score/runs`                | Last 50 runs (headers only).                |
| GET    | `/eval-score/runs/:id`            | Full report for one run.                    |
| DELETE | `/eval-score/runs/:id`            | Delete a stored run.                        |
| POST   | `/eval-score/run`                 | Start a run → returns `{runId, streamUrl}`. |
| GET    | `/eval-score/run/:id/stream`      | SSE progress stream.                        |

</details>

<details>
<summary><b>Eval Evidence</b></summary>

| Method | Path                           | Notes                     |
| ------ | ------------------------------ | ------------------------- |
| GET    | `/eval-evidence`               | Full snapshot + stats.    |
| GET    | `/eval-evidence/scenarios`     | Flat list of scenarios.   |
| GET    | `/eval-evidence/scenarios/:id` | One scenario in full.     |

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
# ── Required ──────────────────────────────────────────────────────────────
CZ_AGENT_URL=https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate
CZ_AGENT_TEST_FROM=919000000001        # test user phone
CZ_AGENT_TEST_NAME=EvalBot             # test user display name

# ── Optional: LLM judge ensemble (falls back to heuristic if absent) ─────
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# ── Optional: session persistence (Live Chat + Chat History) ─────────────
MONGODB_URI=mongodb+srv://...

# ── Optional: LangSmith trace ingestion ──────────────────────────────────
LANGSMITH_API_KEY=
LANGSMITH_SESSION_ID=

# ── Server tuning ────────────────────────────────────────────────────────
PORT=4001
MONGO_REQUIRED=false                   # set true in prod to exit on Mongo fail
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
terminal running `npm run dev`. If you see `MongoDB connection error`, either:

- Start Mongo locally: `docker run -d -p 27017:27017 mongo`, or
- Remove `MONGODB_URI` from `server/.env` to run without it.

</details>

<details>
<summary><b>❓ Eval Score run starts but hangs or all scenarios fail</b></summary>

Your machine probably can't reach the CZ agent URL. Verify:

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
<summary><b>❓ LLM judge always returns heuristic fallback</b></summary>

No `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set, or the key is invalid.
Check `server/.env`.

</details>

---

## 📁 Project layout

```
self-eval/
├── dashboard/                 ← React + Vite front-end
│   ├── src/
│   │   ├── views/             ← the 7 screens
│   │   ├── components/        ← NavigationRail, ErrorBoundary, …
│   │   ├── data/              ← bundled snapshots (agentEvalEvidence.json)
│   │   ├── store/             ← DashboardContext (global state)
│   │   ├── api.ts             ← all HTTP/SSE clients in one place
│   │   └── App.tsx            ← routing + layout
│   ├── vite.config.ts         ← dev proxy → localhost:4001
│   └── package.json
│
├── server/                    ← Node + Express back-end
│   ├── app.js                 ← Express app + all route mounts
│   ├── index.js               ← entry point (mongoose + app.listen)
│   ├── eval-runs.js           ← /api/eval-score/* router + SSE + execution
│   ├── eval-evidence.js       ← /api/eval-evidence/* router + JSON loader
│   ├── evidence-runner.js     ← evidence → scoring adapter + agent caller
│   ├── score.js               ← component scoring + czScore composite
│   ├── judge.js               ← 3-model LLM judge ensemble
│   ├── rubric.js              ← rubric dimensions, weights, thresholds
│   ├── golden.js              ← legacy Golden Set store
│   └── package.json
│
├── scripts/
│   ├── sync-eval-evidence.js  ← pulls evidence from the agent repo
│   └── run-golden-ci.js       ← CI entry point
│
├── data/                      ← file-backed persistence (see Data layout)
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
bug.
</i>

<br /><br />

<a href="#-quick-start"><img src="https://img.shields.io/badge/→_Jump_to_Quick_Start-F97316?style=for-the-badge&labelColor=0f172a" alt="Jump to Quick Start" /></a>

<br /><br />

<sub>Built with ⚡ by the ChargeZone team</sub>

</div>
