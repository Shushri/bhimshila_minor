# BhimShila — platform design

> Named for the boulder that lodged behind the Kedarnath temple on 16 June 2013
> and split the debris flow, so the temple and everyone sheltering inside it
> survived. That was luck. Nobody should need a boulder.

This is the full product design: roles, screens, flows, the AI surface, data
model, API contracts, security posture and deployment. Status against each
section is marked at the end — **shipped**, **by 10 Aug**, or **roadmap** — so
nothing here reads as a claim about what exists today.

---

## 0 · The thesis

India's disaster machinery is not missing. The IMD and CWC forecast well. NDMA's
Sachet publishes Common Alerting Protocol warnings continuously — 60 to 100 live
on an ordinary monsoon day, from 25 agencies, in a dozen languages.

People still die and relief still lands in the wrong village.

Four failures sit between a working forecast and a saved life, and this platform
is the design for all four:

| # | Failure | What the platform does about it |
|---|---|---|
| 1 | **The warning is too coarse to act on.** "Red alert for Kangra" covers 5,700 km². It cannot tell one family beside one nala that tonight is the night. | Score per location, not per district. Rank every alert by the population actually underneath it. |
| 2 | **Nobody trusts the warning.** Broad alerts that resolve into nothing teach people to ignore the next one. | Cross-check every signal before it becomes public alarm. Carry confidence and evidence on every alert. Hold low-confidence signals back. |
| 3 | **Relief is uncoordinated.** Aid duplicates in one village and never reaches the next. | One shared picture of need. Deduplicate reports into incidents. Rank against coverage already on the ground. |
| 4 | **The tools assume calm hands.** Nobody fills a form during a flood. | Three buttons on the volunteer screen. Offline by default. Voice where it helps. |

**What this is not.** Not a replacement for Sachet or the IMD — we consume their
signals and cite them by name. Not a weather model — prediction is an input, not
the product. The product is everything between a signal arriving and a person
being reached.

---

## 1 · Roles and the trust model

Four roles. The boundary that matters is not seniority — it is **who can cause
something irreversible to happen to a member of the public.**

| Role | Is | Can cause | Cannot |
|---|---|---|---|
| **Citizen** | someone in an affected area | a report about themselves | see anyone else's SOS |
| **Volunteer** | NGO field staff | a status change on their own mission, a broadcast *request* | broadcast, dispatch, see SOS outside their mission |
| **NGO lead** | volunteer + org admin | add and remove members of their org | anything outside their org |
| **Coordinator** | DDMA / SDMA desk | broadcasts, dispatches, org verification | — |

### Three rules that do not bend

**Raising an SOS never requires an account.** A person in danger must not meet a
login wall. Anonymous SOS is accepted, geolocated and queued like any other.
The cost — some noise — is the correct trade.

**Volunteers cannot broadcast directly.** They are closest to the ground and
most likely to be right, and they are also the largest, least-verified
population on the platform. A volunteer raises a **broadcast request** scoped to
their mission; it lands at the top of the coordinator's queue with one-tap
approval and the volunteer's evidence attached. Under a declared emergency a
coordinator may **pre-authorise** an org for a radius and a duration — real
incident-command delegation, time-boxed, logged, revocable in one tap.

**Nothing outward-facing fires without a named human.** Every broadcast and
dispatch is staged, shown in the exact words it will go out in, and confirmed.
The confirming user is recorded. This holds for the AI, for the automation, and
for the coordinator in a hurry.

### Identity

Phone number plus password, scrypt-hashed, server-side sessions with SHA-256
token hashes in httpOnly cookies. Phone rather than email because the field
population has phones and not inboxes. **Roadmap:** OTP as primary, since a
volunteer at 3am will not remember a password.

---

## 2 · Information architecture

Every role lands somewhere different. This is the single most important routing
decision on the platform: a citizen who lands on the coordinator's board learns
nothing and a coordinator who lands on the citizen view is blind.

```
                    ┌──────────────┐
                    │   /  (root)  │  routes by role
                    └──────┬───────┘
        ┌──────────────────┼──────────────────┬─────────────────┐
        ▼                  ▼                  ▼                 ▼
  /watch            /missions           /missions        /command
  CITIZEN           VOLUNTEER           NGO LEAD         COORDINATOR
  live alerts       my tasks            + members        full board
  raise SOS         + report            + invite         + dispatch
  ask the AI        + request cast      + roster         + broadcast
  my alerts         + chat                               + resources
```

### 2.1 Citizen — `/watch`

The person here is frightened or curious, on a phone, possibly on 2G.

| Component | Behaviour |
|---|---|
| **National band** | one line: *"3 red alerts live, 27 crore people covered."* Never a wall of numbers. |
| **Map of India** | glowing state outlines, alert markers by severity and hazard glyph. Tap a state → §3. |
| **My area** | alerts covering their registered place, in **the issuing authority's own words and language**. Never our translation. |
| **SOS** | one large button. Voice-first: speak, we structure. Works offline and syncs. |
| **Ask** | natural-language question box over live alerts, districts, protocols and news, with sourcing. |
| **What do I do** | NDMA do's-and-don'ts for the hazard nearest them, before/during/after. |
| **Where do I go** | nearest shelters from the offline bundle. Works with no network at all. |
| **Notifications** | in-app inbox + Telegram; per-hazard and per-place subscriptions. |

### 2.2 Volunteer — `/missions`

The screen that has to survive a crisis. Large targets, no forms, offline first.

| Component | Behaviour |
|---|---|
| **My missions** | tasks for any org they belong to, ordered on-site → accepted → assigned, then severity |
| **The three buttons** | `Accept` → `I'm on site` → `Done` + one line of outcome. Every transition timestamped — **that is the deployment log**, with nothing extra to fill in. |
| **Field report** | photo/video/voice attached to a mission. Captured offline, uploaded when there is signal. |
| **Broadcast request** | scoped to the mission, goes to the coordinator's queue with evidence |
| **Mission chat** | thread per mission, not free-form DMs — auditable, and stops the tool becoming WhatsApp |
| **Mission timeline** | who did what and when, per incident |
| Everything a citizen sees | read-only |

### 2.3 NGO lead — `/missions` + org admin

Adds: member roster, invite link, who is deployed right now, org resource levels
(boats, medical kits, food packets), and assignment of an org task to a named
member.

### 2.4 Coordinator — `/command`

Dense, desktop-first, everything visible. This is the Palantir half.

```
┌─ live stat strip ───────────────────────────────────────────────┐
├─ filters ──┬─ MAP / HEAT ─────────────┬─ UNIFIED FEED ──────────┤
│ source     │                          │  ● SOS   Dhubri    6    │
│ severity   │  India, all layers       │  ◆ red   Kerala   1.3cr │
│ state      │  click → §3 drill-down   │  ◇ lead  Bhind     72   │
│ hazard     │                          │  …                      │
│ verified   │                          │                         │
├────────────┴──────────────────────────┴─────────────────────────┤
│  selected item: evidence, verification, actions                 │
├─────────────────────┬───────────────────────────────────────────┤
│  DEPLOYMENTS        │  RESOURCES        │  BROADCAST QUEUE      │
│  who is where       │  boats, kits      │  volunteer requests   │
└─────────────────────┴───────────────────┴───────────────────────┘
```

**The one rule the layout enforces:** where a row came from is never implicit.
"An authority issued this" (◆), "our scan flagged it and nobody has warned" (◇),
and "a person asked for help" (●) are three different kinds of claim, carried by
glyph as well as colour. A board that renders them identically invites a
coordinator to act on our estimate as though it were the government's.

---

## 3 · The state drill-down

Click a state and the command centre opens **layered floating windows** over the
map — the Jarvis half. Windows are draggable, resizable, closable, and remember
their arrangement per user.

| Window | Content | Source |
|---|---|---|
| **Live alerts** | every CAP alert for the state, ranked by people under it | NDMA Sachet |
| **Risk surface** | our per-district scores as a heat layer | Open-Meteo, scored in plain code |
| **Terrain & hydrology** | elevation, rivers, catchments, embankments | SRTM / HydroSHEDS / OSM |
| **Satellite** | recent optical or SAR tiles, flood-extent where available | Sentinel / Bhuvan |
| **News** | headlines mentioning the state, deduplicated, disaster-filtered | The Hindu, NDTV, PIB |
| **Mini web view** | embedded, sandboxed — the source page itself | iframe, allowlisted origins |
| **Historical** | past events at this place, replayed on real archive data | Open-Meteo archive, 80 years |
| **Forecast** | next 24–72h rainfall, with the reason attached | Open-Meteo |
| **Population at risk** | districts under each alert, with vulnerability | Census 2011 → 2026 projection |
| **Deployments** | teams here now, and what they are carrying | ours |

### Layer rules

**Every layer names its source and its age in the window chrome.** A satellite
tile from 40 hours ago and a CAP alert from 4 minutes ago must not sit side by
side looking equally current.

**Layers do not blend into a single score.** A coordinator who sees "risk: 71"
built from eight fused sources cannot audit it. Layers stack visibly and each
one keeps its own provenance.

**The mini web view is sandboxed and allowlisted.** `sandbox="allow-scripts
allow-same-origin"` against a fixed origin list, no top-navigation, no form
submission. An embedded page is untrusted content inside an operations tool.

---

## 4 · Where AI helps — and where it must not

The architectural rule, stated once and enforced everywhere:

> **The model reads and writes language. It never produces a number that decides
> who is in danger or who gets help first.**

Thresholds, slope, stream distance, severity, priority and ranking are plain
code with readable weights. A hallucinated risk score is not a bug; it is a
harm. This is also what makes the platform auditable by a government partner.

| Flow | What AI does | What stays deterministic |
|---|---|---|
| **SOS intake** | reads Hinglish free text; pulls out place, people count, a clean summary | **category and severity.** A live model filed *"paani ghar me ghus gaya, chhat pe phase hain"* as `shelter` — a roof rescue as a request for accommodation. Keywords are the floor; the model may raise severity, never lower it. |
| **Clustering** | judges whether two reports describe the same event | the 12km / 12h geo-time window |
| **Prioritisation** | explains *why* an incident ranks where it does | the ranking itself |
| **Alert drafting** | writes only when no authority has issued wording | **relaying the issuer's own text verbatim** is the default |
| **Verification** | weighs corroboration in prose | the confidence ladder and the official/model reconciliation |
| **Search** | natural-language → tool + arguments | a deterministic router handles the unambiguous 80%; the model is the fallback |
| **Summarisation** | a shift handover, an incident digest, a situation brief | the underlying counts |
| **Anomaly detection** | flags a district whose rainfall is unusual against its own 80-year history | the statistical test |
| **Deployment advice** | *"Dhubri first — densest under this alert, and a quarter of its housing is kutcha"* | distance, capacity, availability |
| **Routing** | — | haversine + road graph |

### Predictive insight, honestly scoped

We do not forecast weather. We interpret published forecasts. Where the platform
does predict, it predicts **consequence**, not meteorology:

- **Population at risk** under an alert, before anyone reports anything
- **Coverage gaps** — a district under an orange alert with no team within 80km
- **Escalation likelihood** — river gauge trend against the danger mark
- **Alert fatigue** — a place with repeated warnings that resolved into nothing,
  where the next one will be ignored

---

## 5 · Data model

Existing entities in **bold**; the rest are designed and marked in §10.

```
users ─┬─< sessions
       ├─< memberships >─── teams (organisations)
       ├─< sos_requests >── incidents ─┬─< assignments >── teams
       ├─< alert_deliveries            └─< tasks >──────── users (assignee)
       ├─< telegram_links                    └─< task_events
       └─< subscriptions                     └─< field_reports >── media
alerts ──< alert_deliveries
seen_alerts        (NDMA dedupe + the monitoring loop)
pending_actions    (staged, awaiting a human)
broadcast_requests (volunteer → coordinator)
messages           (mission-scoped threads)
audit_log          (every irreversible act)
```

| Entity | Key fields | Notes |
|---|---|---|
| **users** | phone, name, password_hash, role, place, lat/lng, language, telegram_chat_id | phone is the identity |
| **teams** | name, kind, place, lat/lng, capacity, status, created_by, verified, invite_code | **a team *is* the organisation** — one concept, one table |
| **memberships** | team_id, user_id, role_in_org | deliberately separate from `users.role`: system role is which screens you get, org role is whether you can add members. Someone can lead one NGO and be a member of another. |
| **incidents** | title, category, severity, status, report_count, people_count, place, lat/lng | clustered from many `sos_requests` |
| **tasks** | incident_id, team_id, assignee_user_id, status, timestamps per transition | **belongs to the org first, a person second** — a dispatch waiting on one named individual to open their phone can stall |
| **task_events** | task_id, from, to, at, by, lat/lng, note | append-only; **this is the deployment log** |
| **field_reports** | task_id, kind, body, media_id, captured_at, uploaded_at | captured offline, uploaded later — both timestamps kept |
| **broadcast_requests** | task_id, requested_by, radius_km, message, status, decided_by | the volunteer→coordinator gate |
| **subscriptions** | user_id, place, hazard, min_severity, channel | personalised alerting |
| **audit_log** | actor_id, action, target, payload_hash, at, ip | every broadcast, dispatch, verification, member change |

---

## 6 · API contracts

REST over JSON. Streaming only where the UI genuinely assembles progressively.

### Conventions
- Auth by httpOnly session cookie. `401` unauthenticated, `403` wrong role.
- Every mutating endpoint is **stage → confirm**. Staging returns `actionId`;
  nothing happens until confirm, by the same user, within a TTL.
- Errors are `{ error: string }` written for a human under pressure, not a code.
- A degraded answer beats an error. Endpoints that merge sources return partial
  results with an explicit reachability flag.

### Read
```
GET  /api/feed                  → { items[], stats, officialReachable, at }
     the whole board, merged and ranked, one call

GET  /api/feed/:id              → { item, evidence[], layers[] }
GET  /api/state/:code           → { alerts[], risk[], news[], forecast[],
                                    history[], population, deployments[] }
     everything the drill-down needs, one call per state

GET  /api/missions              → { tasks[] }        scoped to the caller's orgs
GET  /api/orgs                  → { orgs[] }         invite_code only to a lead
GET  /api/orgs/:id/members      → { members[] }
GET  /api/inbox                 → { alerts[] }       what actually reached me
GET  /api/watch                 → { checked, changes[], queue[], sourceReachable }
```

### Write — always two-phase
```
POST /api/ops   { action: "prepare_alert",    region, message?, level }
                → { actionId, pending: true, recipients, wording, evidence }
POST /api/ops   { action: "prepare_dispatch", incidentId }
                → { actionId, pending: true, team, distanceKm, backup }
POST /api/ops   { action: "confirm", actionId, message?, level? }
                → { confirmed: true, delivery[] }      ← per-channel truth
POST /api/ops   { action: "cancel",  actionId }
```

### Volunteer
```
POST /api/tasks/:id/advance  { to, outcome?, lat?, lng?, at? }
     idempotent — the client queues these offline and replays them, so a
     repeated "accept" on a task already on site must not drag it backwards,
     and a replayed action that already landed is a success, not an error

POST /api/tasks/:id/report   { kind, body, media?, capturedAt }
POST /api/tasks/:id/broadcast-request { radiusKm, message }
```

### Assistant
```
POST /api/agent  { query, history? }  → NDJSON stream
     {type:"tool_start"} {type:"panel"} {type:"text"} {type:"done"|"error"}
```

### Delivery truth
`delivery[]` is per channel and never optimistic:
```json
[{ "channel": "in_app",   "delivered": 29, "failed": 0 },
 { "channel": "telegram", "delivered": 1,  "failed": 0 },
 { "channel": "sms",      "delivered": 0,  "failed": 0,
   "unavailable": "SMS needs a paid gateway — not configured" }]
```
A channel is listed as delivered only if something left the building. Telling a
coordinator "SMS sent" when no SMS was sent is the one failure this product
cannot survive.

---

## 7 · Security, privacy, reliability

### Privacy — the part most disaster apps get wrong

An SOS is among the most sensitive records a civic system can hold: a named
person, their location, and the fact that they are vulnerable right now.

| Rule | Why |
|---|---|
| **SOS is visible to the coordinator and the assigned org only.** Not to every volunteer on the platform. | The volunteer population is large and lightly verified |
| **Location is coarsened for anyone outside the assigned org** — district, not a point | A precise location of a vulnerable person is a targeting vector |
| **Field media is access-controlled and expiring**, never a public URL | Photos from a disaster contain injured and dead people |
| **Recipient lists are never exported.** Broadcast targets are computed server-side and never returned to a client | The list *is* a map of who lives where |
| **Retention:** SOS and media purge 90 days after resolution; the incident and the deployment log persist anonymised | Accountability needs the log; nobody needs the photo |
| **Anonymous SOS stays anonymous.** No silent device fingerprinting to link it | A person who chose not to identify themselves made a choice |

### Permissions
Enforced server-side on every mutating route. The UI hides what a role cannot
do; the API refuses it regardless. Org-scoped reads check membership, not just
role — a volunteer in org A cannot read org B's missions by changing an id.

### Reliability — the degradation ladder

Every layer answers a worse question rather than none:

| Failure | Behaviour |
|---|---|
| All model providers rate-limited | The panel narrates itself from its own data. Deterministic routing means the core flows never needed a model to pick a tool. |
| NDMA unreachable | **Reported as unreachable.** Never rendered as "no alerts". An outage that reads as an all-clear is the failure that gets someone hurt. |
| One of four national scan batches times out | Partial scan reported with the count. 543 districts is worse than 724 and far better than an error. |
| A news feed's DNS fails | That source returns nothing; the others answer. A transient failure in the least important source must not take down the response. |
| Volunteer has no network | Every action queues locally and replays on reconnect. |
| Any outbound call hangs | Timeouts on all of them — 20s national batches, 12s point forecast, 6s a feed. |

### Abuse
- Rate limits per phone and per IP on SOS and signup
- A coordinator can mark an SOS as noise; repeat offenders throttle
- Every irreversible act is in `audit_log` with the actor
- Invite codes are per-org, rotatable, revocable

---

## 8 · Tech stack and deployment

**Chosen for this project, and honestly:**

| Layer | Choice | Why |
|---|---|---|
| App | Next.js App Router, TypeScript | one deployable, server components for the dense reads, streaming built in |
| DB | libsql / SQLite → Turso | a file locally, a URL in production, same client and same SQL. No ORM: the queries are the domain logic and should be readable. |
| Auth | scrypt + server sessions | no third party holding a disaster platform's user table |
| Maps | hand-built SVG over bundled GeoJSON | no tile-server dependency, no key, and it works offline. A map that needs the network is useless in the one moment it matters. |
| AI | OpenAI-compatible across OpenRouter / Groq / Cerebras / Gemini | one fetch client, four free tiers, automatic failover |
| Delivery | Telegram Bot API + in-app | the only genuinely free push channel in India. SMS needs DLT registration — days, and a registered entity. |
| Hosting | Vercel + Turso + GitHub Actions cron | free tier end to end |

**Scale.** The national scan is 4 bulk calls for 724 districts, cached 15
minutes — roughly 400 calls/day against a 10k/day free limit. NDMA is polled on
a 5-minute cache with ETag revalidation, as their integration guide requires.
The read path is cacheable and the write path is small. The first thing that
breaks at scale is media storage, which is why field media is designed for
object storage with signed, expiring URLs from the start.

**Deployment.** Push to main → Vercel build. Schema migrates idempotently on
first request. A GitHub Actions cron hits `/api/watch` every 10 minutes so the
monitoring loop runs whether or not anyone has the app open.

---

## 9 · Mobile

Web-first, responsive, and the breakpoints are chosen by role rather than by
device — because the roles genuinely use different machines.

- **Citizen and volunteer are phone-first.** Single column, targets ≥ 44px, the
  three mission buttons full-width, offline queue always on.
- **Coordinator is desktop-first** and degrades to a stacked board on a tablet.
  The floating-window drill-down becomes a full-screen sheet below 1024px.
- Everything works at 320px. Nothing depends on hover.

---

## 10 · Status — what is real today

Marked honestly. It is 6 Aug; submission is 10 Aug.

### Shipped 6 Aug — the roadmap section, built
- **The layered state drill-down (§3).** Click a state: draggable, resizable
  floating windows over the map — official alerts in the issuer's own words,
  our risk surface (labelled as ours), 72-hour forecast, the 80-year rainfall
  anomaly, news, population at risk with vulnerability, deployments with
  distance, and a live weather map (Windy's embed, sandboxed). Every window
  names its source and cache age in the chrome; arrangements persist per
  device; below 1024px the windows become full-screen sheets with a tab strip.
- **The command deck (§4's surface).** A typed or spoken question streams back
  panels as floating windows plus one or two spoken sentences. Deterministic
  router first, model fallback, panel self-narration when every provider is
  down — and when a tool answers in a sentence with no panel, that sentence is
  the answer rather than silence.
- **Mission chat** — a thread per task, org-scoped, coordinator-visible.
- **Ground reports with photos** — compressed on the phone to ~1280px JPEG,
  stored behind the mission's own access check (never a public URL), captured
  offline and uploaded on reconnect with both timestamps kept.
- **Broadcast requests** — the volunteer→coordinator gate of §1, end to end:
  request with wording and mission evidence, one-tap approve/decline, the
  approval sending exactly the words shown, per-channel delivery truth on the
  receipt, and the decision landing back in the volunteer's notifications.
- **Subscriptions and the notification centre** — watch places at a chosen
  severity floor; one merged per-person stream (deliveries, watched-place
  alerts, request decisions, unaccepted missions) behind a bell with a local
  read cursor.
- **Anomaly detection (§4)** — this fortnight's rainfall ranked against every
  same-calendar fortnight since 1940 (ERA5), percentile and rank computed in
  plain code, with a speakable evidence sentence.
- **Honest staging previews** — staging an alert now returns who it reaches;
  staging a dispatch names the team and distance and pins that exact team, so
  a coordinator can never approve one team and send another.

### Shipped and checked earlier (318 checks then; 15 suites now)
- NDMA Sachet ingestion, CAP documents with the mandated ETag caching, drill and
  cancellation filtering
- 724-district continuous scan; deterministic risk engine
- Population at risk per alert; severity-then-population ranking
- Unified feed, filters, map, evidence and actions — the coordinator board
- SOS intake in Hinglish, clustering, prioritisation, dispatch, resolve
- Two-phase confirm on every outward action; per-channel delivery truth
- Telegram linking and real delivery; official-wording relay
- 34 NDMA/SDRF protocols; 4,275 offline shelters
- Organisations, memberships and tasks — schema and logic
- Degradation: panel self-narration, NDMA outage honesty, partial scan, feed
  isolation, timeouts everywhere

### By 10 Aug
- Volunteer mission screen — the three buttons, offline queue
- Role-aware routing to `/watch`, `/missions`, `/command`
- Org registration and invite flow
- Deploy, README, screencast

### Roadmap
- True satellite/SAR tiles and terrain-hydrology layers (the weather-map
  window embeds live radar and satellite imagery via Windy; Sentinel/Bhuvan
  flood-extent products are the next step)
- OTP auth as primary — a volunteer at 3am will not remember a password
- A dedicated `audit_log` table (today the alert, task and request rows carry
  actor and timestamp themselves)
- Rate limiting on SOS and signup
- Field media in object storage with signed, expiring URLs, once volume
  outgrows rows
