# Sajag — Regional Data Layer

**Principle: national schema, pilot data load, live query wherever possible.**

Three tiers, and the difference between them decides whether this costs hours or the whole week.

---

## Tier 1 — Query live, store nothing

These answer for **any point in India** on demand. No ingest, no storage, no staleness. Build against these first.

| Data | Source | Notes |
|---|---|---|
| **Officially issued alerts, all India** | **[NDMA Sachet](https://sachet.ndma.gov.in/) CAP feed** | **The authoritative one — see below** |
| Rainfall forecast + 80y history | [Open-Meteo](https://open-meteo.com/) | Free, no API key, 1.5 km regional resolution |
| Elevation | Open-Meteo elevation endpoint | Same call, no extra dependency |
| Streams, rivers, waterways | [OSM Overpass API](https://overpass-api.de/) | Distance to nearest nala — core risk input |
| Schools, hospitals, shelters | OSM Overpass | Evacuation destinations, "go to the school 400m uphill" |
| Roads & tracks | OSM Overpass | Routing, blocked-road reporting |
| Buildings / settlements | OSM Overpass | Where structures actually are |

> Overpass is rate-limited. Cache responses per tile in Postgres with a TTL — that is the whole optimisation needed.

### NDMA Sachet — the only source that is *issued* rather than inferred

Every other feed here is raw material we score ourselves. Sachet carries
warnings a State Disaster Management Authority, the IMD or the Central Water
Commission has actually published, under the Common Alerting Protocol. That
makes it the strongest corroboration available, and the reason our own estimate
is never presented as official.

**The documented path is `FetchXMLFile?identifier=…`** — one full CAP 1.2
document per alert. NDMA publishes an integration guide for it at
[`/docs/Integration_Guide_For_Agencies.pdf`](https://sachet.ndma.gov.in/docs/Integration_Guide_For_Agencies.pdf),
and **ETag caching is mandatory, not advisory**: consumers must send
`If-None-Match` after the first request and serve 304s from their own cache.
The guide lists "no rate-limiting issues" among the benefits, which is the
polite phrasing — fetching a dozen of these without ETags gets connections
dropped, as this integration found out first-hand.

The CAP document carries four things the summary feed does not, and two of them
are safety-critical:

| Field | Why it matters |
|---|---|
| `status` | `Actual` / `Exercise` / `Test`. Broadcasting a drill as real is unrecoverable |
| `msgType` | `Alert` / `Update` / **`Cancel`** — a withdrawn alert must stop showing as live |
| `urgency` / `certainty` | `Immediate`+`Observed` is a different world from `Future`+`Possible` |
| `instruction` | The issuer's own wording for what people should do |

The portal at `/CapFeed` is a client-rendered page — the JSON endpoints behind
it are undocumented internals, but they are what the portal itself calls, and
one request covers the country. Free, no key, CORS-open, ~100 live alerts:

| Endpoint | Returns | Latency |
|---|---|---|
| `cap_public_website/FetchAllAlertDetails` | Every live alert, all India (~100) | ~1.8 s |
| `cap_public_website/FetchIMDNowcastAlerts` | IMD nowcasts (~650 rows) | ~0.7 s |
| `cap_public_website/FetchDashboardData` | National counts | ~0.2 s |
| `cap_public_website/FetchCycloneDetails` | Active cyclone tracks (empty off-season) | slow |
| `cap_public_website/rss/rss_india.xml` | The same alerts as CAP RSS, plus 36 per-state feeds | — |
| `cap_public_website/FetchXMLFile?identifier=` | **Full CAP 1.2 doc for one alert — the documented path** | ~0.5 s |

**How BhimShila splits them.** The JSON sweep is one request for the whole country,
so it drives the map and the situation report. The CAP document is fetched for
a single alert at the moment it matters — when `verify_signal` is asked whether
something is real, which is exactly when someone is deciding to act. That is
where `status` and `msgType` get checked, and it is one ETag-cached request, not
a hundred.

Per alert: `centroid`, `disaster_type`, `severity_color` (red/orange/yellow —
the IMD convention), `effective_start_time`/`effective_end_time`,
`alert_source` (the issuing authority, by name), `area_covered` in km², and
`warning_message` **already written in the local language by the issuer** —
`hi`, `te`, `or`, `ml`, `mr`, `kn`, `en`. Quoting that beats translating it: it
is more accurate, it is citable, and it is the exact text people will see on the
government portal.

Two parsing traps, both of which fail silently — see `test/sachet.mjs`:

- `centroid` is **`lon,lat`** (GeoJSON order). Read as `lat,lng` it puts every
  Indian alert in the Arabian Sea.
- Dates are stamped `"Tue Aug 04 17:30:00 IST 2026"`. `Date.parse` does not
  understand `IST` — it returns `NaN` in some runtimes and Israel Standard Time
  in others. Apply +05:30 explicitly.

This also turns out to be the practical way to reach IMD nowcast data at all —
IMD's own API registrations have been on hold.

## Tier 2 — Bulk download

Split by file size, not by ambition. The vector and tabular layers are small — **load all of India**. Only the rasters and the OSM extract are heavy enough to stay pilot-scoped.

### 2a — All India (cheap, do it)

Small files, national coverage, load in a day.

| Data | Source | Why it's cheap |
|---|---|---|
| Admin boundaries (state → district → tehsil) | [GADM](https://gadm.org/) / data.gov.in | Vector, tens of MB |
| District & tehsil census, population, density | [Census of India 2011](https://censusindia.gov.in/) | CSV. Official baseline |
| Protected areas, wildlife sanctuaries, tiger reserves | [Protected Planet / WDPA](https://protectedplanet.net/) | Polygons, small |
| Forest cover classes | [Forest Survey of India](https://fsi.nic.in/) | Classified polygons |
| River basins & networks | [HydroSHEDS](https://www.hydrosheds.org/) | Basin polygons, manageable |

### 2b — Pilot district only (heavy)

| Data | Source | Why it stays scoped |
|---|---|---|
| Population, 100m grid | [WorldPop](https://www.worldpop.org/) | Raster — process Himachal, keep India tiles cold |
| Population, 30m | Meta HRSL via [HDX](https://data.humdata.org/) | Higher res, correspondingly heavier |
| Terrain / DEM | Copernicus DEM or SRTM 30m | Large; Open-Meteo's elevation endpoint covers the rest live |
| Full OSM extract | Geofabrik India `.pbf` | Multi-GB to process — use live Overpass outside the pilot |

| Data | Source | Format |
|---|---|---|
| **Population, 100m grid** | [WorldPop](https://www.worldpop.org/) | Raster. The practical answer to "how many people in this cell" |
| **Population, 30m** | Meta HRSL via [HDX](https://data.humdata.org/) | Higher resolution where available |
| **Census population & density** | [Census of India 2011](https://censusindia.gov.in/) | District / tehsil / village PCA. Dated but it is the official baseline |
| **Admin boundaries** | [GADM](https://gadm.org/) or data.gov.in | State → district → tehsil |
| **Protected areas & wildlife** | [Protected Planet / WDPA](https://protectedplanet.net/) | National parks, wildlife sanctuaries, tiger reserves |
| **Forest cover** | [Forest Survey of India](https://fsi.nic.in/) | ISFR canopy density classes |
| **River basins & networks** | [HydroSHEDS](https://www.hydrosheds.org/) | Catchments — what drains into which nala |
| **Terrain / DEM** | Copernicus DEM or SRTM 30m | Slope computation at better fidelity than the API |

## Tier 2c — Government documents (RAG)

**This is where RAG belongs — unstructured text, not geography.**

| Corpus | What it answers |
|---|---|
| **District Disaster Management Plans (DDMP)** | "What is Kangra's protocol for a flash flood?" — every district publishes one |
| **NDMA national guidelines** | Hazard-specific standard operating procedure |
| **State SDMA SOPs** | Who is responsible for what, and in what order |
| **SDRF / NDRF relief norms** | "What is this family entitled to for a destroyed kutcha house?" — genuinely useful in the field |
| **IMD colour-code definitions** | What red / orange / yellow actually mean operationally |

Chunk by section, embed, store in `pgvector` alongside the rest of Postgres — no separate vector database. **Every answer must render its citation**: document name, section, and a link. An uncited protocol answer is worse than no answer in this domain.

### The line that must not be crossed

| Question | Route | Never |
|---|---|---|
| "How many people in this cell?" | PostGIS / raster query | ❌ RAG. Embedding search over numbers returns confident nonsense |
| "Which settlements are within 500m of this nala?" | PostGIS spatial query | ❌ RAG |
| "What is the protocol for this hazard?" | RAG over DDMP / NDMA | ✅ |
| "What relief is this family entitled to?" | RAG over SDRF norms | ✅ |

Geography and numbers go through the database. Documents go through RAG. Mixing them is how a disaster tool starts inventing population figures.

## Tier 3 — We generate it

Nobody else has this, which is the point.

| Data | Origin |
|---|---|
| **Mapped settlements** | Coordinator-registered clusters — temporary sheds, labour camps, anything on no official register |
| **Household profiles** | Self-registered: headcount, mobility needs, language, near-stream |
| **Live incidents** | Clustered from citizen SOS and volunteer reports |
| **Deployment & resources** | Who is active where, what is left |

---

## Why wildlife and forest data belong here

Worth stating in the README, because a reviewer will ask:

- **Evacuation routing** must avoid protected forest — often no roads, and legally restricted
- **Human–wildlife conflict spikes during floods** as animals are displaced into settlements
- **Forest and slope classes are landslide predictors** in the Himalayas
- **Rescue teams need terrain type** before they are dispatched into it

It is not decoration; it changes where you send people.

---

## Schema shape

Keep every table national from day one. Only the *loaded rows* are pilot-scoped.

```
regions        (admin hierarchy: state → district → tehsil → village)
population_grid(cell geometry, population, source, year)
protected_areas(geometry, category, name)
water_features (geometry, type, order)
facilities     (schools, hospitals, shelters — capacity where known)
clusters       (our registered settlements → FK region)
```

Every row carries `source` and `as_of`. When an alert cites "480 people in this cell", the provenance must be answerable.

---

## What to do in the 7 days

1. **Day 2 —** wire Tier 1 live queries. Covers most of the risk engine, zero downloads.
2. **Day 2 —** load Tier 2a **for all of India**. Boundaries, census, protected areas, forest, basins. Small files, one sitting.
3. **Day 2 —** load Tier 2b rasters **for Himachal only**.
4. **Day 5 —** ingest Tier 2c documents into `pgvector`. Start with Kangra's DDMP, NDMA flood/landslide guidelines, and SDRF relief norms. Three documents beat thirty.
5. **README —** "National coverage on the structured layers; rasters and document corpus pilot-scoped. Expanding is a load job, not a rebuild."

---

## Honest cost note

The bottleneck is not writing ETL — AI writes that quickly. It is multi-GB downloads, broken projections, and validating that a number is actually right. Those do not compress.

So the split matters: **Tier 2a is genuinely all-India in a day. Tier 2b is not, and pretending otherwise costs the week.** Live-query Tier 1 wherever you can, and keep the schema national throughout so scope is a load job rather than a rewrite.
