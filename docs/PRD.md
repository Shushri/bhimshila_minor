# BhimShila — voice-first disaster intelligence & response

> **One line:** A disaster platform you operate by talking to it — it ingests official signals, verifies them against the ground before anyone is alarmed, warns the right people in their own language, and coordinates the rescue.
>
> BestPossible.AI Hackathon · Build Season 2026 · Governance & civic · Due 10 Aug 2026

---

## The problem

India's disaster machinery is not missing. IMD and CWC forecast well — CWC states over 90% accuracy. NDMA's [SACHET](https://sachet.ndma.gov.in/) publishes Common Alerting Protocol warnings in twelve languages over SMS, app, browser and satellite.

People still die, and relief still arrives in the wrong places.

On 26 June 2025 the Manuni rivulet flash-flooded at Khaniyara, Dharamshala. Labourers asleep in temporary sheds were swept away — two dead, six missing. A red alert was already in force for Kangra district. Across that monsoon Himachal recorded 27 cloudbursts, 44 flash floods, 40 landslides and 173 deaths.

Four failures sit between a working forecast and a saved life:

**The warning is too coarse to act on.** "Red alert for Kangra" covers 5,700 km². It cannot tell one family beside one nala that tonight is the night.

**Nobody trusts the warning any more.** Broad alerts that resolve into nothing teach people to ignore the next one. Research on India's early-warning systems names alert fatigue directly — *"the real test is not whether the message was delivered, but whether it changed behaviour."* No system today checks a machine warning against the ground before broadcasting it.

**Relief is uncoordinated.** In the aftermath, aid duplicates in some areas and never arrives in others, because no one holds a shared picture of need.

**The tools assume calm hands.** Field volunteers under pressure, on bad networks, do not fill forms. Coordinators managing a live response do not click through dashboards.

## What this is not

- **Not a replacement for SACHET or IMD.** We consume their signals and cite them. National alerting and meteorology stay where they belong.
- **Not a new weather model.** We do not claim to predict cloudbursts. Prediction is an input, not our product.

The product is everything between a signal arriving and a person being reached — verification, targeting, language, and coordination.

## How it works

**Ingest.** Public forecast data (Open-Meteo, 1.5 km resolution, free, no key) plus official warnings where available are pulled continuously and scored per location — not per district. Rainfall intensity ahead, ground already saturated, slope, distance to the nearest stream.

**Verify — the part nobody does.** A machine signal alone never fires an alert. BhimShila cross-checks it against the ground: reports and SOS messages arriving from that area, confirmations from volunteers already deployed nearby, and whether earlier signals in this area proved real. Every alert carries a confidence score and the evidence behind it. Low confidence holds the alert back instead of spending public trust on it. **This is the direct antidote to alert fatigue, and it is the core of the product.**

**Alert.** Verified risk goes only to the people actually exposed — registered households, mapped settlements, deployed volunteers — over WhatsApp, SMS or Telegram, in their language, as voice as well as text. Every alert states its reason: *"120mm has already fallen in two days and 80mm more is coming tonight."*

**Coordinate.** Citizens raise SOS by voice. Field volunteers report needs by speaking, offline if the network is gone. AI clusters overlapping reports into single incidents, kills duplicates, and ranks them by severity against coverage already on the ground — which is how you stop aid piling up in one village while another gets nothing. Coordinators see one live picture, assign teams, and track who is deployed where and what resources remain.

**Everything is voice-operable.** *"Khaniyara ko alert bhejo."* *"Sabse nazdeeki team bhejo."* *"Kitne SOS abhi pending hain?"* The assistant parses intent, shows what it is about to do, and executes on confirmation. Typing is the fallback, not the default.

## Who it's for

| Role | What they do | Interface |
|---|---|---|
| **Citizen / resident** | Receives targeted warnings; raises SOS | Voice + WhatsApp, own language |
| **Field volunteer** | Reports needs from the ground, confirms or denies signals | Voice, offline-first |
| **Coordinator (NGO / district)** | Sees the live picture, assigns teams, tracks resources | Voice commands + dashboard |

**Pilot:** Kangra district, Himachal Pradesh · flash flood and cloudburst.

## Why AI, why now

**Verification is a judgment problem, not a data problem.** Deciding whether a rainfall signal plus four vague voice reports plus one volunteer's confirmation adds up to a real emergency is exactly the reasoning a duty officer does — and there are not enough duty officers. This is the first year a model can do it defensibly, with its reasoning shown.

**Voice finally works in Indian languages.** The people most exposed are least likely to read; the volunteers reaching them are least likely to have free hands. Speech is not an accessibility feature here, it is the only interface that survives a crisis.

**Hyper-local forecast data became free.** Open-Meteo serves ECMWF and DWD ICON at up to 1.5 km with 80 years of history, no key, no signup.

## The impact

Narrow, defensible claims:

- **Fewer false alarms broadcast** — verification rate, and trust preserved for the alert that matters
- **Alerts reaching the exposed few hundred** instead of a district of millions
- **Less duplicated relief** — incidents deduped, coverage gaps surfaced
- **Faster time from SOS to assignment** — the metric that actually maps to lives

## What it does

- **Per-location risk scoring** from free public forecast data — deterministic, explainable, never a black box
- **Ground verification** with confidence scoring, so unverified signals never become public alarm
- **Targeted multilingual alerts** over WhatsApp / SMS / Telegram, voice and text, always with the reason attached
- **Voice SOS** for citizens; **voice needs-reporting** for volunteers, working offline and syncing later
- **AI clustering and prioritisation** — duplicate reports merged, incidents ranked by severity against existing coverage
- **Coordination dashboard** — live picture of need, team assignment, deployment tracking, resource levels
- **Voice command layer across the whole platform** — *"send alert"*, *"nearest team bhejo"*, *"kitne pending hain"*
- **Replay mode** — rerun any past event on real historical data

## Notes for builders

**Depth goes in three places: the voice command layer, verification, and coordination.** Ingest and alert dispatch should be real but thin. A platform that demos as seven shallow modules loses to one with a clear spine.

**The risk engine stays deterministic.** Thresholds, slope and stream distance live in plain code with readable weights. The model handles language, verification judgment, and prioritisation — never the raw danger score. A hallucinated risk number here is a harm, not a bug.

**Build replay early.** No disaster will occur during Demo Day. Open-Meteo's historical API reconstructs 26 June 2025 at Khaniyara completely — and AltSpace, the finale venue, sits in that same valley. Showing judges what the system would have said fourteen hours earlier, on real data, in the place it happened, is the strongest demo available to any submission here.

**Offline is a stated requirement, not a nice-to-have.** Volunteer reporting must queue locally and sync when the network returns.

## Resources

- [Open-Meteo](https://open-meteo.com/) — free forecast + 80y historical, no API key
- [SACHET, NDMA](https://sachet.ndma.gov.in/) — national CAP alerts; upstream source to cite
- [CWC Flood Forecast Dashboard](https://cwc.gov.in/ffm_dashboard) — river-level forecasting
- [IMD API](https://api.imd.gov.in/) — **registrations on hold**; do not build a dependency on it
- [CEEW — early warning systems in India](https://www.ceew.in/publications/how-can-india-strengthen-climate-disaster-preparedness-with-multi-hazard-effective-early-warning-systems) — the last-mile gap, documented
- OpenStreetMap Overpass API — free waterway geometry

## The brief

| | |
|---|---|
| **Stage** | PRD ready |
| **Build effort** | Ambitious |
| **Looking for** | Full-stack dev · AI / agents · Voice · Geospatial · Domain expert (disaster response) |
| **Themes** | Governance · Accessibility · Climate · Rural India |
| **Pilot** | Kangra district, Himachal Pradesh · flash flood & cloudburst |

---

## Coverage against the brief we were sent

| Their deliverable | Where it lives |
|---|---|
| Needs-reporting form (lightweight) | Voice needs-reporting, offline-first |
| Prioritisation / clustering model | AI clustering + severity-vs-coverage ranking |
| Shared coordination dashboard | Coordinator live view |
| Deployment log — who is active where | Deployment tracking |
| Offline-capable sync | Local queue + sync on reconnect |
| *"Simple enough for stressed volunteers"* | Voice as the default input, not a feature |
| *"Usable when connectivity is scarce"* | Offline-first field surface |
