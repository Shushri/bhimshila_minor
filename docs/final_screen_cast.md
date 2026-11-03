# BhimShila — screencast coverage list

Not a script. Each section: what to open, and the points to hit. Words are
yours.

**Read from screen, never from memory:** live alert count, districts scanned,
districts elevated, people covered, coverage-gap row.

**Logins** — coordinator `9100000011` · volunteer `9100000012` · citizen
`9100000013` · password `bhim2026`

---

## 1 · The idea — 1:00

**Show** Overview, India map. Don't touch the mouse.

- Kedarnath, 16 June 2013 — the boulder that split the flood, Bhim Shila
- It didn't predict anything; it was in the right place before the water
- India doesn't lack warnings — IMD, CWC, NDMA, state SDMAs publish all day
- The gap is between the warning and the person who has to act

---

## 2 · Three people, three products — 1:15

**Show** Coordinator → Operations · Citizen → Overview · Volunteer → Missions

- Coordinator: 40 alerts, 8 teams — needs to know which one has people under it and nobody near it
- Citizen: standing in water, can't fill a form, one sentence before the network drops
- Volunteer: 11% battery, needs the job — not a dashboard
- One dashboard for all three fails all three → three logins, three surfaces
- **The line that matters:** AI does not decide who is in danger. It reads and writes language. Ranking is arithmetic you can read

---

## 3 · Where the data comes from — 1:15

**Show** KPI tiles → hover a glowing state → scroll the unified feed → one official row's evidence lines

- **Sachet (NDMA)** — the spine. Warnings an SDMA / IMD / CWC actually issued
- **Open-Meteo** — our own reading, every district centre scored
- **GloFAS** river discharge, **USGS** earthquakes, **OpenStreetMap** shelters
- **Six news feeds** incl. Hindi — corroboration; a weather model can't tell you anything happened
- **Census 2011** — how many people are underneath
- One feed, three kinds of row: official / our scan / citizen SOS
- Every official row states: who issued it, until when, how many people, whether our scan agrees
- **Asymmetry:** our signal quiet + authority warned → authority wins. Our signal loud + no alert → stated as a lead, never a warning

---

## 4 · How the data got in — 2:15

**Show** `sachet.ndma.gov.in` → `src/lib/kb/sachet.ts` → `scripts/build-district-profiles.mjs` → `src/lib/kb/national.ts`

**NDMA / CAP**
- No subscribe, no webhook — CAP over HTTP is poll-based
- RSS index + a documented endpoint for the full CAP document
- Their guide makes ETag / 304 caching mandatory; the host takes 19s on a bad day
- **Trap 1:** coordinates are longitude-first → read the other way, every Indian alert lands in the Arabian Sea
- **Trap 2:** timestamps are IST → read as UTC, a live warning looks expired
- **Gates:** only `status = Actual` goes out (a drill can never broadcast as real); a cancelled alert stops showing as live

**Census**
- 118 columns; the obvious ones are wrong — literacy tells you little about surviving a flood
- Kept five that change a responder's decision: fragile housing, phone reach, rural, elderly, low income
- **Checksum:** every build verifies district populations sum to 1,21,08,54,977 — an edited mirror fails immediately
- 2011 is the most recent *completed* census (2021 → 2027), so no invented growth rate: National Commission on Population's own table carries each state to 2026, labelled a projection

**Open-Meteo**
- No key, no signup; ~200 coordinates per request
- Whole country = 4 calls, cached 15 min — the only reason continuous national monitoring costs nothing

**Shelters**
- First version queried OSM live per district — 700 queries against volunteer infrastructure
- A disaster is exactly when that's unreachable, so "where do I go" ships inside the app

---

## 5 · Coordinator — 1:45

**Show** "Kerala kholo" → state deck → scroll every layer → Alert (stage, don't send) → Dispatch (confirm) → Operations log

- State deck in one call: alerts, risk, forecast, **86-year rainfall anomaly**, river discharge, news, population, deployments, satellite/radar
- The anomaly is plain arithmetic vs every same fortnight since 1940 — not a model guessing whether this is unusual
- Per-layer degradation: a dead layer says so and has ↻ Try again; it doesn't kill the deck
- **Alert staging:** counts real recipients, shows the *issuing authority's own wording in their language* — never machine-translated
- **Dispatch staging:** names the nearest team, distance, a backup team, pins it on the map
- Nothing leaves without Confirm. AI proposes, never sends
- Every decision lands in the log — coordination is also being able to show later what was decided and when

---

## 6 · Citizen — 1:15

**Show** Citizen tab → orb → *"paani ghar me ghus gaya, chhat pe do log phase hain"* → structured SOS → cut to coordinator board → ⌂ Nearest shelter → inbox / Telegram

- No form. One sentence, any language — comes back structured: category, severity, headcount, place
- That's what models are genuinely good at: sentence → fields
- **The safety floor:** a live model once filed people trapped on a roof as `shelter, severity 4`. Keywords set a floor; the model may raise severity, never lower it
- Clustering: same category within 12km / 12h merges instead of double-counting
- Offline: SOS queues on the phone, sends itself on reconnect
- Three quick actions for someone who doesn't know what to ask
- Delivery: in-app always real, **Telegram free and real today**, WhatsApp code-ready, SMS reported unavailable — never faked

---

## 7 · Volunteer — 1:15

**Show** `/missions` → advance a mission → thread → ground report with photo → 🧭 → request broadcast → coordinator approves → back to volunteer notifications

- Only their own organisation's missions
- Status advances queue offline too — the field is where connectivity actually fails
- Replaying the same transition is accepted, not an error
- Thread per mission — the conversation lives with the work, not in someone's WhatsApp
- Ground reports: photos compressed on-phone, access-controlled
- 🧭 hands the incident coordinates to the phone's navigator
- **The broadcast gate:** volunteer is first to know a bridge is out, but can't warn a district on his own authority → requests it with wording + evidence → coordinator one-tap approves → *his exact words* go out → decision lands back in his notifications
- That's the org chart encoded: knowledge up, authority down

---

## 8 · How the AI works — 3:00

**Show** `router.ts` → `tools.ts` → the `SYSTEM` prompt in `api/agent/route.ts` → `llm.ts` PROVIDERS → back to app, ask *"Assam mein abhi kya alerts hain"*

- **STT:** browser Web Speech API — free, on-device, streaming, handles Hindi
- **Layer 1 — client matcher:** "Kerala kholo" opens the deck with zero network. A regex already knows what a model would charge a round trip to learn
- The dividing line is the verb — *and* whether a subject is named. "Kerala kholo" = command; "Kerala mein kya chal raha hai" and "Assam ke alerts dikhao" = questions
- **Layer 2 — deterministic intent router, in code.** Why: free tiers cap *tokens per minute*; 1,400 tokens of tool schemas every turn bought ~5 turns a minute. Routine decisions moved to code; model is the fallback for genuinely ambiguous input, and defers instead of guessing
- **17 tools** — official alerts, risk, situation report, verify signal, replay, shelters, dispatch, prepare alert, NDMA protocol, drive the UI
- **The model never generates UI** — picks from a fixed set of 10 panels, fills a shape, can't invent one
- **Prompt rules to read out:** answer with data not prose · never invent a risk number, the engine owns it · never contradict a live official alert · two sentences max, 35 words, because it's read aloud · no markdown, asterisks get pronounced · **may propose a dispatch or an alert, may never claim either happened**
- **Providers:** OpenRouter (550B, widest catalogue, ~6s) → Groq (llama-3.3-70b, ~1.5s) → Cerebras → Gemini. Rate limit, bad key, retired model, dead host all fail down the chain. Gemini retired a pinned model mid-build — nothing is pinned now
- **Watch the arrival order:** tool chip → panel → *then* the sentence. The panel is the answer; the model narrates what's already there
- If the model says nothing, the app narrates the panel's own headline. **Degrades to silent, never to wrong**
- Models emit tool calls as *text* — angle brackets, and JSON. Both are stripped before a word reaches the synthesiser

---

## 9 · How it was built, and what went wrong — 2:45

**Show** `docs/` → `AGENTS.md` → `git log` (read one body) → `node test/run.mjs` → GitHub Actions → ↺ replay → Khaniyara

- Built with Claude Code — **design first**: PRD, system design, UI design, data audit, feature tracker existed before the features. Made the model argue the design before it typed
- `AGENTS.md` is four lines and the highest-leverage file: Next.js 16 changed enough that training data confidently writes last year's API
- Commit bodies explain *why*, not what — 60+ commits, ~15,000 words. The history is the build log

**Where the AI was wrong**
- `Dharamshala → Dhar, MP` — 1,200km off, on the town this project is named after, because a loose substring match beat the exact one
- Router regex meant for a capitalised place matched a Hindi particle — "Madhya Pradesh **ke Indore**". Tests now assert the *arguments*, not just the tool
- 757 districts was wrong — 34 rows were state centroids wearing a district's name. It's **724**

**How it's checked**
- 16 suites, 400+ assertions
- Live sources tested live on purpose — a frozen fixture keeps passing after the government changes the feed
- CI found three more on day one, including a monitoring cron that had **never once run** (unparseable YAML)

**Replay**
- Khaniyara flash flood, June 2025, replayed hour by hour on archive data through the live scorer
- Crosses HIGH **21 hours** before the flood
- Prints its own ceiling: archives keep what fell, not what was forecast. Evidence it detects this pattern — not a promise about the future

---

## 10 · What changes — 1:30

**Show** Operations → alert-fatigue ledger → coverage gaps (read a row) → handover (press it *before* you start talking — takes ~45s)

- **Alert-fatigue ledger:** states with 5+ warnings in 30 days and zero SOS behind any of them — how fast a population is learning to ignore us. Nobody publishes this because it's unflattering
- **Coverage gaps:** live orange+ alerts with people under them and no team within 150km. Read the row — *not a warning, a hole in the response*, visible before anyone calls for help
- **Handover:** 12-hour digest where every number is a database query and the model only writes the prose around them
- **The philosophy in one button:** facts computed, language generated — never the other way round
- Why AI is critical and not decorative: it doesn't predict floods, IMD does. The gap between a warning existing and a person understanding it is a *language* gap measured in hours

---

## 11 · What it is not — 0:45

**Show** live URL → GitHub repo, commits scrolling

- Not a forecast — reads what IMD and CWC publish, cites them on every row
- Not autonomous — nothing reaches a person without a coordinator's Confirm
- Doesn't pretend — NDMA unreachable says **unreachable**, never all-clear. SMS unavailable, never faked as sent
- Live, open source, full history — including the commits where I was wrong
- Close on the boulder: it didn't predict the flood, it was in the right place before the water

---

## Don't skip these five

They're what separate engineering from a feature tour:

1. The model never generates the UI
2. The panel is the source of truth; the model is the narrator
3. It can propose an action, it cannot execute one
4. Degrades to silent, never to wrong
5. Facts computed first, language second

---

## If something breaks on camera

Don't cut — degrading gracefully *is* the feature.

| | Say |
|---|---|
| NDMA slow/empty | "It says unreachable — it won't say all-clear, those are opposite things" |
| Model rate-limited | "Failover working. And the panel still answered — the words are the optional part" |
| Panel fails | "Every window has a retry, half these sources are government hosts" |
| Agent slow | Keep talking. Never watch a spinner in silence |
