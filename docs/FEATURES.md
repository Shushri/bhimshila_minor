# BhimShila — Feature Tracker

One feature at a time. Status is honest: ✅ done and verified · 🟡 partial · ❌ not started.

**Deadline: 10 Aug 2026.** Submit 9 Aug.

---

## Legend

- **[C]** = required by a published submission criterion. Missing one of these costs the submission directly.
- **[B]** = in the brief the organizers sent (Disaster Response & Resilience, tracks DELIVERY + CAPABILITY).
- **[D]** = differentiator — what makes this win rather than merely qualify.

---

## F0 · Foundation ✅

| Item | Status |
|---|---|
| Next.js app, TypeScript, builds clean | ✅ |
| Public git repo, real commit history **[C]** | ✅ local — ❌ not pushed to GitHub yet |
| Dark operations UI, dense dashboard | ✅ |
| Free-tier LLM provider (OpenRouter, tool calling verified) | ✅ |

## F1 · Region intelligence ✅

| Item | Status |
|---|---|
| 36 states/UTs + 12 Himachal districts, Census 2011, sourced | ✅ |
| National monitoring — all 757 districts scored live, 4 bulk calls | ✅ |
| Ground-truth feeds: The Hindu / NDTV / PIB RSS + USGS | ✅ |
| 757 district polygons, bundled, offline | ✅ |
| Choropleth with hover, click-to-query, metric switch | ✅ |
| Ranked lists, hazard index | ✅ |

## F2 · Live risk engine ✅ **[D]**

| Item | Status |
|---|---|
| Open-Meteo forecast + archive, no API key | ✅ |
| OSM waterway distance, nearby shelters | ✅ |
| Deterministic scorer, explicit weights, no LLM | ✅ |
| Live exposure for all 757 districts, refreshed every 15 min | ✅ |
| Replay mode on real historical data | ✅ verified — 21 Jul 2025 Khaniyara scores 68/100 |

## F3 · Voice agent ✅ **[D]**

| Item | Status |
|---|---|
| Streaming STT, barge-in, Hinglish (hi-IN) | ✅ |
| Model picks a panel from a fixed enum; never generates UI | ✅ verified |
| Neural TTS (Gemini / ElevenLabs / Deepgram) | ✅ Gemini live, verified |
| Streaming answers — panels pop as tools land, text token by token | ✅ |
| 12 tools incl. situation_report, verify_signal, dispatch_team | ✅ |
| Typed fallback always visible | ✅ |

---

## F4 · Accounts & persistence ✅ **[C]**

Both hard criteria now met.

| Item | Status |
|---|---|
| libsql/SQLite backend, 8 tables (local file → Turso by env var) | ✅ |
| Real auth: scrypt passwords, server-side sessions, httpOnly cookies | ✅ |
| Three roles: citizen / volunteer / coordinator | ✅ |
| Persisted SOS, incidents, teams, assignments, alerts | ✅ |

Phone-OTP would need a paid SMS provider — credentials + server sessions is the honest free equivalent, and is genuinely real auth (not a mock-up).

## F5 · Needs reporting & SOS ✅ **[B][D]**

The organizers' DELIVERY track, and their design question — *"simple enough for stressed field volunteers"* — answered with voice: nothing to fill in, you just speak.

| Item | Status |
|---|---|
| Voice SOS → AI-structured report (category, severity, headcount, place) | ✅ |
| Keyword fallback so an SOS survives an API outage | ✅ |
| Geocoding across all 757 districts | ✅ |
| Clustering — same category within 12km / 12h merges | ✅ verified |
| Priority ranking, deterministic, shows its reasoning | ✅ |
| Offline queue, sync on reconnect **[B]** | ✅ localStorage-first, flushes on reconnect |

## F6 · Coordination ✅ **[B]**

| Item | Status |
|---|---|
| Live incident board, priority ranked | ✅ |
| Dispatch nearest team by voice — 18 real NDRF/SDRF/NGO units seeded | ✅ |
| Confirm-before-execute on every outward action; no replay (410) | ✅ |
| Deployment log — assignments, team status **[B]** | ✅ |
| Alerts to registered users in a region | ✅ per-channel delivery proof |
| Recovery — resolve incident, release team, log outcome | ✅ |
| Resource levels per team (boats, kits, food) | ✅ |

## F7 · Verification layer ✅ **[D] — the moat**

Cross-check a machine signal against ground reports before alarming anyone. Nobody else does this, and it is the direct answer to alert fatigue.

| Item | Status |
|---|---|
| Confidence from news RSS + USGS corroboration | ✅ verified on Kerala |
| Hold uncorroborated signals instead of broadcasting | ✅ |
| Every alert carries its evidence | ✅ |

## F8 · Multi-channel alerts ✅

Only channels that genuinely delivered are ever reported as sent.

| Item | Status |
|---|---|
| in-app inbox — always real, persisted per recipient | ✅ |
| **Telegram — free Bot API, no approval, works today** | ✅ needs TELEGRAM_BOT_TOKEN |
| WhatsApp Cloud API | ✅ code ready — needs a Meta Business token |
| SMS | ❌ needs a paid gateway; reported as unavailable, never faked |
| Evidence attached to every alert | ✅ |

## F9 · Protocol lookup ✅

| Item | Status |
|---|---|
| NDMA SOPs, SDRF relief norms, IMD colours, Sphere camp standards | ✅ 10 entries |
| Every answer carries its citation; figures never generated | ✅ |
| Indexed in Hinglish, not just English | ✅ |

## F9b · Orchestration that survives a rate limit ✅

Free tiers cap tokens per minute, not requests. Shipping 1,470 tokens of tool
schemas on every turn just to ask the model "which tool?" bought about five
turns a minute on Groq — a demo-killer. Most questions aren't ambiguous, so
that decision is now made in code.

| Item | Status |
|---|---|
| Deterministic intent router (`src/lib/agent/router.ts`) | ✅ 20/20 cases |
| Model kept as fallback router + narrator only | ✅ |
| Ambiguous input deferred, never guessed | ✅ 3 of the 20 cases assert this |
| Core flows work with **zero model keys** | ✅ sitrep, incidents, protocol |
| Tool schemas trimmed 1,751 → 1,470 tokens for the fallback path | ✅ |
| Failover chain OpenRouter → Groq → Cerebras → Gemini | ✅ all free-tier |

## F9c · Official alert feed — NDMA Sachet ✅

Everything else this system reports is inferred: we take rainfall and score it.
Sachet carries warnings an SDMA, the IMD or the CWC has actually *issued*. That
changes what the product can claim — "the Kerala SDMA has a red alert out" is
not a position we have to defend.

| Item | Status |
|---|---|
| All-India CAP feed, ~100 live alerts, ~1.8s | ✅ `src/lib/kb/sachet.ts` |
| Official text kept in the issuer's own language (hi/te/or/ml/mr/kn) | ✅ never machine-translated |
| Cross-check against our own score, disagreement reported not hidden | ✅ `crossCheck()` |
| `verify_signal` defers to a live official alert | ✅ |
| `situation_report` leads with issued alerts, scan fills the gaps | ✅ |
| `official_alerts` tool + router intent | ✅ |
| Map: severity by fill, hazard by glyph, IMD colour legend | ✅ never colour alone |
| **CAP 1.2 documents via NDMA's documented `FetchXMLFile` path** | ✅ |
| **Mandatory ETag / `If-None-Match` caching per their integration guide** | ✅ 304s served from cache |
| **`status` gate — an Exercise or Test can never be broadcast as real** | ✅ |
| **`msgType` gate — a cancelled alert stops showing as live** | ✅ |
| CAP `urgency` / `certainty` surfaced; issuer's `instruction` quoted | ✅ |
| **Outgoing alerts relay the issuer's own wording, in the local language** | ✅ never machine-translated |
| **Staging is refused outright when the cited alert is a drill or withdrawn** | ✅ |
| Every staged alert states where its wording came from | ✅ 9 provenance checks |
| Checked against the live feed | ✅ 33/33 `test/sachet.mjs` |

The honest case is the asymmetric one: where our signal is quiet and an
authority has warned, the authority is right — they have radar and river gauges
we do not. Where our signal is loud and no alert exists, that is stated as a
lead to verify, never as a warning. That second case is the only place this
product adds information rather than repeating it.

## F9d · Triage: the model may not talk us down ✅

Asked to structure *"paani ghar me ghus gaya, chhat pe phase hain"*, a live
model answered `shelter`, severity 4 — people trapped on a roof by rising
water, filed as a request for accommodation. In the priority queue that buries a
drowning beneath a supply run.

| Item | Status |
|---|---|
| Category & severity resolved deterministically | ✅ `src/lib/triage.ts` |
| Keyword parser is a floor — the model cannot downgrade a life-safety call | ✅ |
| Severity only ever moves up | ✅ |
| Model still leads on place, people count, summary | ✅ its actual strength |
| Pure module, no DB/network/model — testable in isolation | ✅ 19/19 `test/triage.mjs` |

## F9e · Continuous monitoring ✅

Caching the feed for five minutes was never monitoring — it only meant the
answer was fresh *when someone asked*. Between questions nothing was watching,
and a red alert going out over Kerala at 3am would have sat unseen until the
next person opened the app.

| Item | Status |
|---|---|
| Scheduled sweep every 10 min, free (GitHub Actions) | ✅ `.github/workflows/watch.yml` |
| Console sweeps too while open, so the schedule is a backstop | ✅ |
| Diffs against what was already seen — new *and* escalated | ✅ `seen_alerts` |
| Idempotent: a repeat sweep raises nothing | ✅ |
| Queue is orange+ only — 50 yellows would bury the reds | ✅ |
| **An unreachable feed is never reported as an all-clear** | ✅ stated in UI and CI |
| Watcher never broadcasts — it raises into the coordinator queue | ✅ human still confirms |
| Acknowledge is coordinator-only | ✅ 14/14 `test/watch.mjs` |

Vercel's free tier caps cron at once per day, which cannot monitor anything, so
the schedule lives in GitHub Actions instead — free on a public repo, and the
repo has to be public to submit anyway.

## F11 · The command centre ✅ **[D]** — added 6 Aug

The roadmap section of PLATFORM.md, built: the Jarvis half on top of the
Palantir half.

| Item | Status |
|---|---|
| Floating-window layer — drag, resize, pin, minimise, z-order, per-device arrangement memory; sheets + tab strip below 1024px | ✅ `lib/windows.ts`, `WindowLayer.tsx` |
| State drill-down — click a state → alerts / risk / forecast / 80-y anomaly / news / population / deployments / live weather map, one API call, per-layer degradation | ✅ `/api/state/[code]`, `StateDeck.tsx` |
| Command deck — typed or spoken ask → streamed panels as windows + spoken reply; `/` focuses; orb only in voice mode | ✅ `CommandDeck.tsx` wiring `/api/agent` |
| Silent-turn fix — a tool that answers in a sentence with no panel is spoken, not swallowed | ✅ agent route fallback |
| 80-year rainfall anomaly — percentile + rank vs every same-calendar fortnight since 1940, plain arithmetic, speakable evidence | ✅ 14/14 `test/anomaly.mjs` |
| Mission chat — thread per task, org-scoped, coordinator-visible | ✅ |
| Ground reports — photos compressed on-phone, access-controlled, offline queue with quota honesty | ✅ |
| Broadcast gate — volunteer request → coordinator one-tap approve sends the exact wording; decision lands back in the volunteer's notifications | ✅ |
| Subscriptions + notification centre — watch places at a severity floor; one merged per-person stream | ✅ |
| Staging previews — alert staging counts recipients, dispatch staging names and pins the team | ✅ |
| Heat-map resting state — every state glows by its worst district in our scan (labelled as ours); satellite & radar window opens with each state deck | ✅ |
| Command-centre shell — icon rail, top platform-search (one real input: the deck), KPI tiles with icons + 1-hour deltas from a device-local snapshot | ✅ |
| Alert tempo — 14-day area chart of alerts first seen per day, from `seen_alerts`, red-alert days marked | ✅ |
| Map, remade — 757 district hairlines under the state glow, 5° graticule, animated zoom-to-state (dropdown, map click and deck all drive one camera), district hover, "All India" reset, non-scaling strokes | ✅ |
| River discharge — GloFAS via Open-Meteo flood API (keyless): today vs 90-day median, week trend, 14-day forecast peak, at each state's most populous districts. Live catch on day one: Muzaffarpur at 6.2× normal | ✅ `lib/kb/rivers.ts` |
| News, widened — + Times of India, Hindustan Times, and Google News in English *and* Hindi scoped to disaster terms over 48h; deduped across feeds, newest first | ✅ |
| Tabbed workspace — Overview / **AI Intelligence** / Operations / Organisations, driven from the icon rail and a tab strip; navy theme; IBM Plex type | ✅ |
| AI Intelligence tab — the agent's streamed situation read with its chosen panels inline, top-risk states, live disaster press, seismic feed, suggested asks that feed the command deck | ✅ `IntelBrief.tsx` |
| Degradation, hardened — national scan serves its last good sweep (≤6h, age labelled) under rate limits; sitrep falls back to the official layer instead of "no districts matched undefined"; every failed deck window has ↻ Try again | ✅ |
| **Replay theatre** — four documented disasters (Khaniyara '25, Kedarnath '13, Wayanad '24, Shimla '23) replayed hour-by-hour on archive data with the live scorer; Khaniyara crosses HIGH **21 hours** before the flood. Caveats printed on the surface | ✅ `↺` on the rail |
| Alert-fatigue ledger — states with ≥5 warnings and zero SOS in 30 days, from our own records; measures attention risk, caveat stated | ✅ ops tab |
| Coverage gaps — live orange+ alerts with people under them and no available team within 150 km, ranked by exposure | ✅ ops tab |
| Shift handover — 12-hour digest where every number is a query; model writes the prose when reachable, deterministic assembly otherwise; one-tap copy | ✅ coordinator button |
| **Jarvis voice control** — "Kerala kholo", "operations kholo", "replay chalao", "sab band karo", spoken SOS: UI commands resolve in the client, zero model, zero network; questions still reach the agent. Verb-gated so "Kerala mein kya chal raha hai" stays a question | ✅ `lib/voice/commands.ts` |
| The orb, always on — the platform's presence bottom-right, breathing when idle, tap to talk | ✅ |
| Citizen quick actions — nearest shelter / abhi kya karun / mere alerts, one tap, no knowing-what-to-ask | ✅ overview tab |
| Volunteer directions — 🧭 on every mission card hands the incident coordinates to the phone's navigator | ✅ |
| NGO stock-take — leads and coordinators set boats/kits/food per org (PATCH /api/orgs, absolute counts, idempotent); the board's supplies figures finally move | ✅ |
| AI-powered Jarvis — `control_ui` tool: the model drives the interface through the same fixed action enum the deterministic router uses; patterns for speed and keyless operation, model for natural phrasing | ✅ |
| All of it checked | ✅ 44/44 `test/field.mjs` |

## F10 · Ship ❌ **[C]**

| Item | Status |
|---|---|
| GitHub repo public | ❌ |
| **Deployed live URL (Vercel)** | ❌ |
| README: problem, users, stack, screenshots, "what this is not" | ❌ |
| Screencast of the build process **[C]** | ❌ |
| Submit | ❌ |

---

## Recommended order

Criteria first, then the brief, then the moat.

| # | Feature | Why now | Est. |
|---|---|---|---|
| 1 | **F10 — deploy** | Only remaining hard criterion. A live URL is required to submit at all | ½ day |
| 2 | **README + screencast** | Also a stated criterion; the screencast must show *how you built it* | ½ day |
| 3 | **Telegram bot token** | 2 minutes from @BotFather — turns alerts from in-app into real messaging | — |

## Cut line

If the week collapses, this still submits as a complete product:

```
DONE ── F0 … F9   predict → detect → verify → alert → SOS →
                  prioritise → dispatch → recover
────────────────────────────────────────
LEFT ── F10 only: deploy, README, screencast, submit
```

Every feature is built and verified end to end. What remains is shipping.
