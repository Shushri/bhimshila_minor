# Data Audit — what BhimShila has, what it is missing

Audited 4 Aug 2026 against the product vision: predict → detect → verify →
alert → coordinate → rescue → recover, operated by voice.

The question this answers: **for a complete product, where is data still
missing, and does any of it need RAG?**

---

## 1. What is actually in the system

| Layer | Source | Coverage | Live? |
|---|---|---|---|
| Officially issued alerts | NDMA Sachet (CAP 1.2) | ~71–104 nationwide, 22 issuing agencies | ✅ live |
| Rainfall forecast + 80y archive | Open-Meteo | **all 757 districts** | ✅ live |
| Elevation | Open-Meteo | per point | ✅ live |
| Earthquakes | USGS | global, M4+ | ✅ live |
| News / ground reports | The Hindu, NDTV, PIB RSS | national | ✅ live |
| Waterway proximity | OSM Overpass | per point | ✅ live |
| Shelters (schools, hospitals) | OSM Overpass | per point | ⚠️ live **only** |
| District geometry | bundled GeoJSON | 757 polygons + centroids | 📦 offline |
| Census attributes | Census 2011 | **36 states + 12 districts** | 📦 offline |
| Relief protocols | NDMA / SDRF / IMD / Sphere | **10 entries** | 📦 offline |
| Response teams | seeded | 24 units + resource counts | 💾 in DB |

Detection and verification are in good shape. **The gaps are all on the
right-hand side of the lifecycle — precautions and coordination.**

---

## 2. The gaps, ranked

### 🔴 P1 — District attributes: 745 of 757 districts have no data

`district-centroids.json` carries `{ district, state, lat, lng }` and nothing
else. Census attributes exist for 36 states and **12 districts — all of them in
Himachal**, left over from the Kangra pilot.

Demonstrated, not theoretical:

```
tell me about Kangra    → region_card, pop 1,510,075, density 263  ✅
tell me about Palakkad  → no panel, no answer at all               ❌
```

Palakkad is a district inside a live Kerala red-alert zone. The stated vision
was *"uss region ke baare mein saari info fetch ho jaye — specs, area, kitne log
hai, density"*. Today that holds for 48 places out of 757.

**Need:** population, area, density, literacy, urban/rural split per district.
Census 2011 district tables (data.gov.in / censusindia.gov.in), one CSV, bundled
like the polygons already are. Pure data work, no new architecture.

### 🔴 P2 — Population at risk per alert (falls out of P1)

Sachet gives every alert a centroid and `area_covered` in km². District
population is the only missing multiplicand. With P1 done, the system can say:

> *"This red alert covers roughly 2.3 million people across 8 districts"*

and rank 71 live alerts **by people affected** rather than by colour alone.
Right now a red alert over the Nicobars ranks equal to one over Kerala.

This is the prioritisation the organizers' brief explicitly asks for, it is a
genuine differentiator, and it is nearly free once P1 lands.

### 🟠 P3 — Precautions: 10 protocol entries, wrong shape

Current 10: four SDRF entitlements (money), one IMD colour key, four responder
SOPs (flood, landslide, cloudburst, heatwave), one camp standard.

Two problems:

**Hazard coverage does not match the live feed.** Lightning and thunderstorm
were **28 of 102** alerts in a sampled sweep — the largest category after flood
— and there is no protocol for either. Nor for cyclone, earthquake, urban
flooding, or squally weather, all of which appear in the feed.

**Almost nothing is citizen-facing.** The entries answer "what is a coordinator
owed" and "what does an official do". Nobody has asked the more common question:
*"paani aa raha hai, main abhi kya karun?"* — before / during / after, per
hazard, in plain language.

**Need:** roughly 35–50 more entries. NDMA publishes exactly this material as
do's-and-don'ts per hazard. Curated and cited, same structure as the existing
ten.

### 🟠 P4 — Shelters are live-query only, which breaks the offline requirement

`nearbyShelters()` hits OSM Overpass on demand. The organizers' brief states as
a hard constraint:

> *"How do you keep this usable when connectivity and time are both scarce
> during an actual disaster?"*

A disaster is precisely when Overpass is unreachable and rate-limited. Evacuation
destinations are the one thing that must work offline.

**Need:** pre-fetch schools, hospitals and community halls for all 757 district
centroids once, bundle the result. Overpass allows this as a batch job; it is a
build-time script, not a runtime dependency.

### 🟡 P5 — Coordination capacity data

Teams and their resources are seeded and real. What is missing: hospital bed
capacity, road and bridge status, helipads.

**Honest assessment: skip this.** India has no free, current, machine-readable
feed for hospital capacity or road status at usable granularity. Inventing it
would be worse than not having it. The teams-and-resources model already answers
the brief's deployment-tracker deliverable.

---

## 3. Do we need RAG?

**Mostly no. For one thing, maybe — and it is the lowest priority here.**

| Data | Right tool | Why not RAG |
|---|---|---|
| Census, density, capacity | table lookup | These are exact numbers. Retrieval returns *approximately relevant text*; a population figure is either right or wrong. Embedding numbers to look them up fuzzily is strictly worse |
| Alerts, weather, quakes | API + cache | Already structured, already live. Nothing to retrieve |
| Coordinates, polygons | bundled JSON | Geometry, not prose |
| Protocols at ~50 entries | keyword + synonym index | Already built, already Hinglish-indexed, already cites. At this size a vector store adds latency, cost and a failure mode — retrieving the wrong paragraph and citing it confidently |
| Full NDMA/NDRF PDF corpus | **RAG genuinely fits** | Hundreds of pages of real prose where the queries cannot be enumerated in advance |

The threshold is roughly this: **RAG earns its place when the corpus is large,
genuinely prose, and you cannot enumerate the questions.** Only the last row
qualifies, and even there curated entries beat retrieval for a demo — a wrong
paragraph cited confidently is a worse failure than "I don't have that".

This also matches the principle the codebase already runs on: deterministic
where the answer is knowable, model only where language is the hard part. A
population figure is knowable. Retrieval is the wrong instrument.

**Verdict: build the data tables (P1–P4). Revisit RAG only if the NDMA document
corpus becomes a requirement.**

---

## 4. Recommended order

| # | Item | Effort | Unlocks |
|---|---|---|---|
| 1 | ✅ **Done** — 725-district census + 2026 projection | | `region_profile` everywhere |
| 2 | ✅ **Done** — population at risk per alert | | Alerts ranked by people within severity |
| 3 | ✅ **Done** — protocols 10 → 34, citizen-facing | | The precautions layer |
| 4 | ✅ **Done** — 4,275 shelters bundled, 720/724 districts | | The brief's offline constraint |
| 5 | Capacity data | — | **Skip.** No free source worth trusting |
| 6 | RAG | — | **Skip** unless the PDF corpus becomes a requirement |

Items 1 and 2 together are the highest-value work left in the product. Neither
needs new architecture — both are data.
