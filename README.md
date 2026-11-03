# BhimShila · भीमशिला

**Disaster intelligence for India.** It reads the government's own alert feed,
ranks every live warning by how many people are actually underneath it, takes
citizen SOS in Hinglish, and coordinates the NGO teams that respond.

> Named for the boulder that lodged behind the Kedarnath temple on 16 June 2013
> and split the debris flow, so the temple and everyone sheltering inside it
> survived. That was luck. Nobody should need a boulder.

---

## The problem

India's disaster machinery is not missing. The IMD and CWC forecast well. NDMA's
[Sachet](https://sachet.ndma.gov.in/) publishes CAP warnings continuously — 60
to 100 live on an ordinary monsoon day, from 25 agencies, in a dozen languages.

**It arrives as a flat list.** Nothing on it says which warning covers a million
people and which covers forty thousand. So at three in the morning, one district
coordinator does that ranking by hand — while citizen distress arrives on a
different channel entirely, in Hinglish, over the phone.

On 26 June 2025 a rivulet flash-flooded at Khaniyara near Dharamshala. Two dead,
six missing. **A red alert was already in force** — for Kangra district, which is
5,700 km². A warning that size cannot tell one family beside one stream that
tonight is the night.

## What it does

| | |
|---|---|
| **Ingests** | NDMA Sachet CAP 1.2 (with the ETag caching their integration guide requires), Open-Meteo across all 724 districts continuously, USGS, Indian news RSS |
| **Ranks** | every alert by the population underneath it — Census 2011 projected to 2026 — severity first, people within it |
| **Verifies** | cross-checks each official alert against our own scan, and reports the disagreement rather than hiding it |
| **Answers** | typed or spoken questions, Hinglish included — a deterministic router picks the tool, panels open as floating windows, replies are spoken. Works with zero model keys |
| **Drills down** | click a state → layered movable windows: official alerts in the issuer's language, our risk surface, 72-h forecast, **this fortnight ranked against 86 years of rainfall**, news, population at risk, deployments, live weather map |
| **Alerts** | in the **issuing authority's own words and language**, never our translation. Telegram + in-app, with per-channel delivery truth, plus per-place watch subscriptions and a notification centre |
| **Coordinates** | Hinglish SOS → clustered incidents → priority queue → nearest team → deployment log → mission chat, photo ground reports, and volunteer broadcast requests a coordinator approves in one tap |
| **Survives** | offline shelters, offline SOS / mission / report queues, provider failover, honest degradation |

### The rule the whole thing runs on

> **The model reads and writes language. It never produces a number that decides
> who is in danger or who gets help first.**

Thresholds, slope, stream distance, severity, priority and ranking are plain code
with readable weights. A hallucinated risk score is not a bug, it is a harm — and
it is also what makes the system auditable by a government partner.

Asked to structure *"paani ghar me ghus gaya, chhat pe phase hain"*, a live model
returned `shelter`, severity 4 — people trapped on a roof by rising water, filed
as a request for accommodation. The keyword parser had it right. Category and
severity are resolved deterministically for exactly that reason; the model may
raise severity, never lower it.

---

## Running it

```bash
npm install
cp .env.local.example .env        # then add at least one model key
npm run dev
```

Open <http://localhost:3000>.

**It runs with no keys at all.** A deterministic intent router handles most
questions without a model, official alerts and the risk scan need no key, and
every panel can narrate itself. Keys make it better, not functional.

### Environment

| Key | Needed for | Free from |
|---|---|---|
| `OPENROUTER_API_KEY` | the assistant | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `GROQ_API_KEY` | faster assistant, failover | [console.groq.com/keys](https://console.groq.com/keys) |
| `GEMINI_API_KEY` | failover + neural voice | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `TELEGRAM_BOT_TOKEN` | real alert delivery | [@BotFather](https://t.me/BotFather) |
| `DATABASE_URL` | production only | [turso.tech](https://turso.tech) — a local file otherwise |

Put each on its own line. **An inline `#` comment is read as part of the key** —
that has bitten this project once already.

### Checks

```bash
npm run dev                # in one terminal, then:
npm test                   # every suite; skips (loudly) what needs a server it can't find
```

400+ checks across 15 suites. `test/README.md` explains what each one is really
protecting — most of them exist because something broke in a way that was
silent, including one the newest suite caught the day it was written: a
swapped SQL argument that let a broadcast request be approved twice.

---

## Data

Everything is free and needs no key except where noted.

| Source | Used for |
|---|---|
| [NDMA Sachet](https://sachet.ndma.gov.in/) CAP 1.2 | official alerts — the authoritative layer |
| [Open-Meteo](https://open-meteo.com/) | rainfall forecast + 80y archive, 724 districts in 4 bulk calls |
| Census of India 2011 | district population, density, vulnerability → projected to 2026 |
| [HOT / HDX](https://data.humdata.org/) | 4,275 shelters, bundled and answering offline |
| OSM Overpass | waterway proximity |
| USGS | earthquakes |
| The Hindu · NDTV · PIB | ground corroboration |

`docs/DATA_SOURCES.md` has the endpoints, the two parsing traps in the Sachet
feed that fail silently, and what is dead (ReliefWeb v1/v2, IMD's own API).

---

## Design

`docs/PLATFORM.md` is the full product design — four roles, screens, the state
drill-down, the AI surface map, data model, API contracts, security and privacy
posture, deployment. Each section is marked **shipped**, **by 10 Aug**, or
**roadmap**, so nothing in it reads as a claim about what exists.

Other docs: `PRD.md`, `SYSTEM_DESIGN.md` (roles and the deployment log),
`DATA_AUDIT.md` (what data was missing and why), `FEATURES.md`.

---

## Stack

Next.js App Router · TypeScript · libsql/SQLite → Turso · scrypt auth with
server sessions · hand-built SVG map over bundled GeoJSON (no tile server, works
offline) · OpenAI-compatible model client across four free providers with
automatic failover.

---

Built for **BestPossible.AI Build Season 2026** — Governance & civic.
"# bhimshila_minor" 
