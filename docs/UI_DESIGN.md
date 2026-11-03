# Sajag — Generative Command UI

**The idea:** the dashboard is not pre-built. India sits as the resting state; you speak, and the interface assembles the panel that answers you, then dismisses it. No navigation, no menus, no tabs.

Reference aesthetic: OpenCTI-style dark, dense, data-forward. Interaction model: JARVIS — transient panels summoned by speech.

---

## 1. How it actually works

The critical decision, and the one that makes this buildable in a week:

> **The model never generates UI. It picks a panel type from a fixed enum and fills a data query.**

Letting an LLM emit markup or colors is slow, unreliable, and off-palette. Instead:

```
voice → STT → Claude (tool calling) → tool returns { panel, title, query_result, meta }
     → frontend renders the matching React component → overlay animates in
```

Each tool is a real, typed function against Postgres/PostGIS. Claude's only job is **intent → which tool, with which arguments**. The panel components are hand-built, on-palette, and fast.

### Tool surface

| Tool | Returns panel | Example utterance |
|---|---|---|
| `region_density(region)` | `choropleth` | *"Kis region me sabse zyada bheed hai?"* |
| `region_profile(region)` | `region_card` | *"Kangra ke baare me batao"* |
| `active_incidents(filter)` | `ranked_list` + `point_map` | *"Abhi kya chal raha hai?"* |
| `risk_timeline(region, window)` | `line` | *"Pichle 48 ghante ka rainfall"* |
| `deployments(region)` | `board` | *"Teams kahan hain?"* |
| `unmet_need(region)` | `ranked_list` | *"Kahan madad nahi pahunchi?"* |
| `protocol_lookup(question)` | `doc_answer` | *"Flash flood ka protocol kya hai?"* |
| `dispatch_alert(region, …)` | `confirm_card` | *"Khaniyara ko alert bhejo"* |

**Write actions always return a confirm card first.** The assistant states what it is about to do and to whom; it executes on confirmation. Never fire a real alert on an unconfirmed voice parse.

---

## 2. Screen model

```
┌──────────────────────────────────────────────────────────┐
│  KPI ROW — 4 stat tiles                                  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│              INDIA  (resting state)                      │
│              choropleth, sequential blue                 │
│                                                          │
│         ┌────────────────────────────┐                   │
│         │  SUMMONED PANEL            │  ← animates in,   │
│         │  (dims the map behind)     │    dismisses      │
│         └────────────────────────────┘                   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  ◉ listening…            "kis region me sabse zyada…"    │
└──────────────────────────────────────────────────────────┘
```

**Resting state:** India choropleth + a 4-tile KPI row. Nothing else. The emptiness is the point — it makes the summoned panel feel like a response.

**Panel behaviour:** enters at 240ms ease-out (scale 0.96→1, opacity 0→1), map behind drops to 40% opacity. Auto-dismisses after 20s idle, or on the next query, or on Esc. A **pin** control keeps one panel resident — coordinators need to hold a priority list open while working.

**Stacking:** maximum two panels at once, side by side. A third replaces the oldest. Unbounded stacking turns JARVIS into a mess of windows.

---

## 3. Panel library

Eight components, built by hand. Nothing else exists.

| Panel | Form | Color job |
|---|---|---|
| `stat_tile` | value + delta + sparkline | status for delta only |
| `choropleth` | region fill by magnitude | **sequential, one hue** |
| `point_map` | incidents/clusters as points | status (severity) |
| `ranked_list` | ordered rows + inline bars | sequential |
| `line` | rainfall / incident volume over time | 1–2 categorical |
| `board` | deployment columns by status | status |
| `region_card` | population, density, protected area, facilities | text + one meter |
| `doc_answer` | RAG answer **+ citation** | text only |

### Form rules that apply here

- **Density and risk are magnitude → sequential blue, light→dark.** Never a rainbow, never red-to-green. The reference screenshot's polar chart uses ~8 rainbow hues; do not copy that — it is unreadable under colour-vision deficiency and it is the single most common dashboard mistake.
- **Choropleth is an all-pairs form** — if it ever carries categories instead of magnitude, it caps at **three** categorical hues. Beyond that, fold to "Other" or facet.
- **Severity is status, not series.** good / warning / serious / critical are reserved and always ship with an icon + label, never colour alone.
- **One axis, always.** Rainfall and incident count are two different scales — two panels, never a dual-axis chart.
- **Hover is not optional.** Every map region, bar and line gets a tooltip; lines get a crosshair.
- **Legend for ≥2 series**, direct labels at ≤4. A single-series panel needs no legend — the title names it.

---

## 4. Palette (dark-first)

```css
.sajag {
  color-scheme: dark;
  --plane:          #0d0d0d;  /* page background */
  --surface:        #1a1a19;  /* panel + chart surface */
  --ink-primary:    #ffffff;
  --ink-secondary:  #c3c2b7;
  --ink-muted:      #898781;  /* axis, labels */
  --gridline:       #2c2c2a;
  --baseline:       #383835;
  --border:         rgba(255,255,255,0.10);

  /* sequential — density, risk, magnitude */
  --seq-100: #cde2fb;  --seq-250: #86b6ef;  --seq-400: #3987e5;
  --seq-550: #1c5cab;  --seq-650: #104281;

  /* categorical — only where series identity is the subject */
  --series-1: #3987e5;  --series-2: #d95926;  --series-3: #199e70;

  /* status — reserved, never reused as a series */
  --good:     #0ca30c;
  --warning:  #fab219;
  --serious:  #ec835a;
  --critical: #d03b3b;
}
```

Light mode is a later concern — this product is operated at night, in the field, on a phone. Ship dark, do it well.

> Before shipping: run the palette validator on any categorical set actually used together.
> `node scripts/validate_palette.js "#3987e5,#d95926,#199e70" --mode dark --surface "#1a1a19"`

### Marks

Thin marks; 4px rounded data-ends anchored to the baseline; 2px lines; ≥8px map markers; a 2px surface gap between adjacent fills and a 2px surface ring on overlapping points. Recessive grid and axes — the data is the only thing that should be loud. Values, labels and legends wear ink tokens, never the series colour.

---

## 5. The voice layer

**Two modes, one input.**

- **Query** — read-only. Executes immediately, renders a panel. *"Kitne SOS pending hain?"*
- **Command** — writes. Renders a confirm card, waits. *"Nazdeeki team bhejo."*

Always visible: a transcript strip showing what was heard. Misheard input is the number-one failure of voice demos, and showing the transcript converts a silent failure into an obvious, correctable one.

**Typed fallback is always present** — a command palette on `/`. Mics fail in demo rooms; this is insurance for the thing your entire submission rests on.

**Latency cover:** the panel frame animates in immediately with a skeleton, then fills. Never a blank screen while the model thinks.

---

## 6. Minimum viable JARVIS

This UI is a large slice of a seven-day build. Cut in this order — the top four are the demo.

```
KEEP ──────────────────────────────────────
  1. India choropleth (resting state)
  2. Voice → intent → panel  (the mechanic itself)
  3. region_density  →  choropleth + region_card
  4. active_incidents →  ranked_list + point_map
───────────────────────────────────  LINE
  5. dispatch_alert → confirm card
  6. risk_timeline → line
  7. deployments → board
  8. protocol_lookup → doc_answer
  9. pinning, stacking, auto-dismiss polish
```

**Four panel types is a complete demo.** Twelve half-built ones is not. If one query works flawlessly and beautifully, the pattern reads as a system — the audience extrapolates the rest.

---

## 7. What to steal from the reference, and what not to

**Steal:** the density — real numbers everywhere, no wasted space. The dark plane with slightly lighter panel surfaces. The KPI row across the top with delta indicators. Small multiples of different chart forms coexisting. Hairline borders instead of heavy cards.

**Do not steal:** the rainbow polar chart. Rainbow categorical encoding fails colour-vision deficiency, and a radar/polar form makes magnitude genuinely hard to compare — area misleads. Use a bar or heatmap for the same data.

Also avoid the reference's habit of colour-coding by rank — colour must follow the **entity**, so a filter that changes which regions are visible never repaints the survivors.
