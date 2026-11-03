# BhimShila — every feature, by who uses it

Read off the code, not remembered: routes in `src/app/api`, role gates as
written, tools in `src/lib/agent/tools.ts`. Anything not built is in
**Not built** at the bottom rather than left out.

Three logins, three products. The same database, three different jobs.

---

## 👤 CITIZEN

Someone standing in the water. The design rule for this whole surface: **they
cannot be required to know anything.**

### Raise an SOS
- **Speak one sentence** — Hindi, English or Hinglish, no form, no fields
- **Or type it**, same box, if speaking is not possible
- Comes back **structured**: category, severity, headcount, place
- **The safety floor** — keywords set a minimum severity the model cannot lower.
  A live model once filed *people trapped on a roof* as `shelter, severity 3`;
  the floor corrected it to `rescue, severity 5`
- **Location without a district name** — resolves 724 districts plus localities,
  or uses the phone's GPS
- **Clustering** — same category within 12km / 12h joins the existing incident
  instead of creating a duplicate, so ten calls about one bridge are one job
- **Offline** — the SOS is queued on the phone and sends itself when the network
  returns. Nothing is lost because a tower was busy

### Three quick actions, for someone who doesn't know what to ask
- **⌂ Nearest shelter** — works with no network; shelters ship inside the app
- **☂ Abhi kya karun?** — NDMA protocol for the hazard, cited
- **◆ Mere area ke alerts** — what is live where they are

### Receive
- **In-app inbox** — every alert delivered to them, with its evidence
- **Telegram** — free, real, working today; link the account in one tap
- **Subscriptions** — watch a place at a chosen severity floor
  (yellow / orange / red) and get told when it crosses

### Ask anything
- The **command deck** and the **voice orb** — the same agent a coordinator
  uses, with the tools a citizen is allowed to reach

---

## 🎽 VOLUNTEER

Someone in the field at eleven percent battery. Sees only their own
organisation's work.

### Missions
- **My missions only** — scoped by membership, not by role. Another NGO's
  missions are unreachable even by changing an id in the URL
- **Two ways a mission arrives:**
  - **A dispatch** — landed on the whole org, unclaimed → **Accept** to take it
  - **A mission raised for them by name** → already theirs, **no Accept step**
- **Move it forward:** `Accept` → `I'm on site` → `Done`, with an outcome line
- **Decline**, with the mission returning to the org
- **Ownership is enforced** — nobody can advance a mission that belongs to
  someone else, so the deployment log records who actually went
- **Everything queues offline** — every status change is stored on the phone and
  replayed on reconnect. Replaying the same transition twice is accepted, not
  an error
- **Timestamps record the press, not the sync** — clamped against a lying clock
  (nothing from the future, nothing older than a week)
- **🧭 Directions** — hands the incident coordinates to the phone's own navigator

### Report from the ground
- **Mission thread** — a conversation per mission, so it lives with the work
  instead of in someone's WhatsApp. Org-scoped, coordinator-visible
- **Ground reports with photos** — compressed on the phone before upload,
  access-controlled, oversize files refused with a reason
- **Notes** without a photo, for when there is nothing to show

### The broadcast gate
- A volunteer is first to know a bridge is out — but **cannot warn a district on
  their own authority**
- **Request a broadcast** with their own wording and evidence
- The coordinator approves in one tap and **the volunteer's exact words go out**
- **The decision comes back** to their notifications, approved or not

### Also
- **Log a relay** — record that they passed an alert on by hand, and to how many
  households. This is the mechanism a randomised trial in Bihar found made
  warnings arrive before the water 46.5% more often
- **Read camp needs** — a volunteer driving to a camp should know what it is
  short of
- **Notification centre** — one merged stream: alerts, decisions, assignments

---

## 🎧 COORDINATOR

Forty alerts on the desk and eight teams. The job is deciding, and being able
to show later what was decided.

### The board
- **One unified feed** — three kinds of row together: official alerts, our own
  scan, citizen SOS
- **Every official row states its own provenance** — who issued it, until when,
  how many people under it, and whether our scan agrees
- **India map** — all 35 states glowing by their worst district, 724 district
  hairlines beneath, 5° graticule, animated zoom, click-to-drill
- **KPI tiles** with one-hour deltas
- **Alert tempo** — 14 days of alerts first seen per day, red days marked

### State drill-down — one click, ten layers
`Kerala kholo` (typed or spoken) opens the deck: **official alerts · risk
surface · forecast · 86-year rainfall anomaly · river discharge · news ·
population at risk · deployments · satellite & radar**. One API call. Any layer
that fails says so and offers ↻ Try again rather than killing the deck.

### Act — always behind a confirmation
- **Stage an alert** → shows the real recipient count and **the issuing
  authority's own wording in their own language**, never machine-translated →
  Confirm
- **Stage a dispatch** → names the nearest team, the distance, a backup team,
  pins it on the map → Confirm
- **Resolve an incident** → closes it and releases the team
- **Cancel** any staged action; a staged action cannot be replayed (410)
- **Nothing leaves without Confirm.** The AI proposes; it never sends

### Raise a mission
- Pick **volunteers by name** from an organisation they belong to
- Write **what to do**, in their own words
- Choose **which alert or incident** it answers, from a dropdown
- Sends **one mission per volunteer** — two people sent to the same place still
  arrive separately and each report their own outcome
- Lands on the volunteer's board **already theirs**

### Watch, read-only
- **Every live mission**, who is on it, and where they have got to — in plain
  words (*"Meena Devi — on site now"*), not state names
- A coordinator **cannot** press Accept / on-site / Done on someone else's
  mission. Those timestamps are the deployment log, and it has to be true

### Approve
- **Broadcast queue** — volunteer requests to warn the public, with wording and
  evidence attached, approved or declined in one tap
- **Alert queue** — new and escalated official alerts raised by the monitoring
  sweep, acknowledged by a coordinator (never auto-broadcast)

### Organisations
- **Register an NGO** — name, base, coordinates
- **Invite link** — one URL; open it, sign up if needed, you are in
- **Members list** with lead / member roles
- **Stock-take** — boats, medical kits, food packets per organisation

### The two things nobody else publishes
- **Alert-fatigue ledger** — states with 5+ warnings in 30 days and *zero* SOS
  behind any of them. A measurement of how fast a population is learning to
  ignore us, built from our own records
- **Coverage gaps** — live orange+ alerts with people under them and **no team
  within 150 km**. Not a warning; a hole in the response, visible before anyone
  has called for help
- **Duplicate coverage** — two different teams working within 15 km of each
  other. Aceh's four measles vaccinations, in one number

### Relief camps
- **Open a camp**, record its population and who is running it
- **Set needs** — food, water, medical, bedding, sanitation, boats, each with an
  urgency
- **Ranked supply list** — camps ordered by people waiting × urgency × item,
  with the team actually carrying that stock named. Returns *"nobody is carrying
  medical"* rather than a useless nearest guess

### Shift handover
- **12-hour digest** where every number is a database query and the model only
  writes the prose around them. One tap to copy

---

## 🤖 THE AGENT — all three roles

**Voice in, voice out.** Speech-to-text is the browser's own Web Speech API —
free, on-device, streaming, handles Hindi.

**Three layers, and most of it is not the model:**
1. **Client matcher** — `"Kerala kholo"`, `"ऑपरेशन्स खोलो"`, `"replay chalao"`,
   `"sab band karo"` resolve in the browser with **zero network**. Works spoken
   (Devanagari) or typed (Latin)
2. **Deterministic router** — reads the question, picks the tool in code. Exists
   because free tiers cap tokens per minute, and shipping 1,400 tokens of tool
   schemas every turn bought about five turns a minute
3. **The model** — only for genuinely ambiguous input, and it defers rather than
   guessing

**20 tools:** `official_alerts` · `assess_risk` · `situation_report` ·
`verify_signal` · `search_news` · `replay_event` · `find_shelter` ·
`lookup_protocol` · `list_incidents` · `dispatch_team` · `prepare_alert` ·
`resolve_incident` · `camp_needs` · `alert_reach` · `duplicate_coverage` ·
`region_density` · `region_profile` · `rank_regions` · `list_hazards` ·
`control_ui`

**The model never generates UI** — it picks from a fixed set of 10 panels and
fills a shape. It cannot invent one.

**Four providers, in order:** Sarvam (Indic-tuned, primary) → OpenRouter →
Groq → Gemini. A rate limit, a rejected key, a retired model or a dead host all
fail over. **Neural voice** from Sarvam Bulbul, falling back to the device voice
— which is chosen from the script, not the language tag, and overridable in
Settings with a play button.

**Degrades to silent, never to wrong.** If the model says nothing, the panel
narrates its own headline.

---

## ⚙️ UNDER ALL THREE

| | |
|---|---|
| **Auth** | scrypt passwords, server-side sessions, httpOnly cookies — real, not mocked |
| **Data** | NDMA Sachet (CAP 1.2) · Open-Meteo forecast + 1940 archive · GloFAS rivers · USGS quakes · OpenStreetMap shelters · 6 news feeds incl. Hindi · Census 2011 → 2026 |
| **Monitoring** | sweep every 10 min on GitHub Actions, free; diffs new *and* escalated against what was already seen |
| **Delivery honesty** | in-app always real · Telegram real · WhatsApp code-ready, no credential · **SMS reported unavailable, never faked** |
| **Replay theatre** | 4 documented disasters replayed hour-by-hour on archive data. Khaniyara crosses HIGH **21 hours** before the flood, with its own ceiling printed on the surface |
| **Offline** | three queues — SOS, mission transitions, field reports |
| **Installable** | PWA with manifest and icon |
| **Bring your own key** | localStorage only — no database row, no cookie, no log line |
| **Checked** | 18 suites, 400+ assertions; live government sources tested live on purpose |

---

## Not built — said plainly

- **WhatsApp** — code path exists, needs Meta Business verification
- **SMS** — needs a paid gateway; reported as unavailable rather than faked
- **Cross-agency coordination** — single-tenant per organisation
- **Alert ageing / escalation** — the queue surfaces unacknowledged alerts, but
  does not chase them
- **Forecasting** — deliberately not attempted. IMD and CWC forecast; this reads
  what they publish and cites them
