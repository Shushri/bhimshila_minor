/**
 * Build src/data/district-profiles.json — one disaster-relevant profile per
 * district, for every district in India.
 *
 *   node scripts/build-district-profiles.mjs
 *
 * WHY THIS EXISTS
 *
 * Until now only 36 states and 12 Himachal districts carried any attributes, so
 * "tell me about Palakkad" returned nothing at all while "tell me about Kangra"
 * returned a full profile. The agent could see a red alert over eight Kerala
 * districts and not say how many people were under it.
 *
 * WHAT IS SELECTED, AND WHY NOT LITERACY
 *
 * The census has 118 columns. Most are irrelevant here, and the obvious ones
 * are the wrong ones. Literacy tells you little about surviving a flood; what
 * housing you live in, whether anyone can phone you, and how far from a road
 * you are tell you a great deal. So the fields kept are the ones that change
 * how a responder should act:
 *
 *   fragileHousingPct  dilapidated dwellings — who loses a roof first
 *   phoneReachPct      households with any phone — whether our alert can land
 *   ruralPct           how hard the area is to reach
 *   elderlyPct         50+, who cannot self-evacuate quickly
 *   lowIncomePct       under Rs 45,000 — capacity to recover, and to leave
 *
 * SOURCE AND VERIFICATION
 *
 * Census of India 2011, district tables. The file is checked on every run: its
 * district populations must sum to exactly 1,210,854,977, the published
 * national total. A mirror that has been edited fails that immediately.
 *
 * VINTAGE
 *
 * 2011 is old, and it is also the most recent COMPLETED census — the 2021 round
 * was postponed and is now scheduled for 2027. Every Indian data product lives
 * with this. The base is carried forward to 2026 at each state's official
 * projected growth rate; see extract-state-projections.mjs. Both figures are
 * kept, and the projection is labelled as one wherever it surfaces.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = join(ROOT, "src", "data");

const CENSUS_URL =
  "https://raw.githubusercontent.com/nishusharma1608/India-Census-2011-Analysis/master/india-districts-census-2011.csv";

/** The published Census 2011 population of India. Non-negotiable checksum. */
const INDIA_2011 = 1_210_854_977;

const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * State names as the 2011 census wrote them.
 *
 * Three kinds of drift: renames (Orissa → Odisha), reorganisations that
 * post-date the census (Telangana split from Andhra in 2014, Ladakh from J&K in
 * 2019), and a merger (Dadra & Nagar Haveli with Daman & Diu in 2020). The
 * post-2011 cases map to the parent, which is correct — in 2011 their districts
 * were counted under it.
 */
const STATE_ALIAS = {
  odisha: ["orissa"],
  puducherry: ["pondicherry"],
  delhi: ["nctofdelhi"],
  telangana: ["andhrapradesh"],
  ladakh: ["jammuandkashmir"],
  jammukashmir: ["jammuandkashmir"],
  // One modern UT, two 2011 ones. Mapping to only the first stranded Daman &
  // Diu's 243,247 people with no state to belong to.
  dadraandnagarhavelianddamananddiu: ["dadraandnagarhaveli", "damananddiu"],
  andamannicobar: ["andamannicobarislands"],
};

const censusStatesFor = (sKey) => STATE_ALIAS[sKey] ?? [sKey];

/**
 * Lakshadweep is absent from the bundled geometry entirely.
 *
 * 36 islands, 64,473 people, and squarely in the cyclone belt — the Andamans
 * were under a red squall warning the day this was written. Dropping it because
 * we lack a polygon would mean the system reports zero people under an alert
 * that covers a real population, so it is carried as a point with its published
 * area.
 */
const MISSING_FROM_GEOMETRY = [
  { d: "Lakshadweep", s: "Lakshadweep", lat: 10.5667, lng: 72.6417, areaKm2: 32 },
  // The bundled geometry has one "Mumbai" — the island city, 3.1M. Mumbai
  // Suburban is a separate district of 9.4 million people on a flood-prone
  // coast, and it was simply absent.
  { d: "Mumbai Suburban", s: "Maharashtra", lat: 19.1136, lng: 72.8697, areaKm2: 446 },
];

/**
 * Districts RENAMED since 2011, where fuzzy matching would miss or misfire.
 *
 * Renames only. A district that was *split* must never be listed here — mapping
 * both halves to the parent hands each of them the parent's whole population.
 * Purba and Paschim Bardhaman did exactly that and overcounted West Bengal by
 * millions. Splits are left to the apportionment step, which conserves the
 * state total by construction.
 */
const DISTRICT_ALIAS = {
  ayodhya: "faizabad",
  amroha: "jyotibaphulenagar",
  prayagraj: "allahabad",
  hapur: "panchsheelnagar",
  sambhal: "bhimnagar",
  kasganj: "kanshiramnagar",
  ballari: "bellary",
  bagalkote: "bagalkot",
  belagavi: "belgaum",
  kalaburagi: "gulbarga",
  vijayapura: "bijapur",
  chikkamagaluru: "chikmagalur",
  tumakuru: "tumkur",
  shivamogga: "shimoga",
  mysuru: "mysore",
  chamarajanagara: "chamarajanagar",
  balasore: "baleshwar",
  angul: "anugul",
  jajapur: "jajpur",
  sonepur: "subarnapur",
  boudh: "baudh",
  ahmedabad: "ahmadabad",
  ahmednagar: "ahmadnagar",
  gondia: "gondiya",
  buldhana: "buldana",
  raigad: "raigarh",
  hooghly: "hugli",
  howrah: "haora",
  darjeeling: "darjiling",
  coochbehar: "kochbihar",
  rangareddy: "rangareddi",
  mahabubnagar: "mahbubnagar",
  bengaluruurban: "bangalore",
  bengalururural: "bangalorerural",
  beed: "bid",
  spsnellore: "sripottisriramulunellore",
  nellore: "sripottisriramulunellore",
  ysrkadapa: "ysr",
  kadapa: "ysr",
  // norm() strips digits, so "North 24 Parganas" becomes "northparganas" and
  // never reaches "North Twenty Four Parganas". Ten million people each.
  northparganas: "northtwentyfourparganas",
  southparganas: "southtwentyfourparganas",
};

// ─────────────────────────────────────────────────────────────── geometry

const DEG_KM = 111.32;

/**
 * Area of a lon/lat ring in km².
 *
 * Equirectangular at the ring's own mean latitude. At district scale the error
 * against a proper geodesic area is well under a percent, and this keeps the
 * build dependency-free. Area matters here only to divide population by it.
 */
function ringAreaKm2(ring) {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const kx = DEG_KM * Math.cos((meanLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * kx * (ring[i][1] * DEG_KM) - ring[i][0] * kx * (ring[j][1] * DEG_KM);
  }
  return Math.abs(sum / 2);
}

/**
 * Area of a district's geometry in km².
 *
 * The bundled shape is nested `g[part][ring][point]` — a MultiPolygon. Reading
 * it one level shallower treats each ring as a point and yields NaN, which then
 * rounds to a silent zero rather than throwing, so the nesting is asserted here.
 * Per GeoJSON, ring 0 of each part is the exterior and the rest are holes.
 */
function polygonAreaKm2(parts) {
  let total = 0;
  for (const rings of parts) {
    if (!Array.isArray(rings?.[0]?.[0])) {
      throw new Error("Unexpected geometry nesting — expected g[part][ring][point]");
    }
    total += ringAreaKm2(rings[0]);
    for (let i = 1; i < rings.length; i++) total -= ringAreaKm2(rings[i]);
  }
  return Math.max(0, total);
}

// ─────────────────────────────────────────────────────────────── matching

/**
 * Normalised Levenshtein, and deliberately nothing cleverer.
 *
 * A substring shortcut was here — "if one name contains the other, call it a
 * match" — and it is why Delhi took New Delhi's 142,004 people instead of the
 * NCT's 16.8 million. Containment is a poor signal for place names, because the
 * containing name is usually a *different, smaller* place: New Delhi in Delhi,
 * North Goa in Goa, West Sikkim in Sikkim. Edit distance rejects all three.
 */
function similarity(a, b) {
  if (a === b) return 1;
  const long = a.length > b.length ? a : b;
  const short = a.length > b.length ? b : a;
  if (!long.length) return 1;

  // Levenshtein, normalised.
  const prev = Array.from({ length: short.length + 1 }, (_, i) => i);
  for (let i = 1; i <= long.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= short.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (long[i - 1] === short[j - 1] ? 0 : 1),
      );
      last = tmp;
    }
  }
  return (long.length - prev[short.length]) / long.length;
}

// ─────────────────────────────────────────────────────────────── build

const num = (row, key) => {
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : 0;
};
const pct = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);

async function main() {
  console.log("Fetching Census 2011 district tables…");
  const res = await fetch(CENSUS_URL);
  if (!res.ok) throw new Error(`Census download failed: ${res.status}`);
  const csv = await res.text();

  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const rows = lines.map((l) => {
    // The file has no quoted fields; a plain split is correct and keeps this
    // script dependency-free. Guarded by the checksum below regardless.
    const cells = l.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });

  const total = rows.reduce((a, r) => a + num(r, "Population"), 0);
  if (total !== INDIA_2011) {
    throw new Error(
      `Checksum failed: district populations sum to ${total.toLocaleString()}, ` +
        `expected ${INDIA_2011.toLocaleString()}. The source has been altered — do not ship it.`,
    );
  }
  console.log(`  ✓ ${rows.length} districts, summing to exactly ${total.toLocaleString()}`);

  // Index census rows by state, so a fuzzy match can never cross a border.
  const byState = new Map();
  for (const r of rows) {
    const k = norm(r["State name"]);
    if (!byState.has(k)) byState.set(k, []);
    byState.get(k).push(r);
  }

  const rawCentroids = JSON.parse(readFileSync(join(DATA, "district-centroids.json"), "utf8"));

  // 34 rows in the bundled file have a null district name — they are state-level
  // centroids that leaked into a district file. They were being scored as
  // districts by the national sweep, so every state was silently counted once
  // more at its own centre, and "757 districts" was never 757 districts.
  const phantom = rawCentroids.filter((c) => !c.d || c.d === "null");

  // Chandigarh appears twice, identically. With one census record to claim, the
  // duplicate took a population of zero — a real district reading as empty.
  const seenKeys = new Set();
  const deduped = [];
  for (const c of rawCentroids) {
    if (!c.d || c.d === "null") continue;
    const key = `${norm(c.d)}|${norm(c.s)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(c);
  }
  const dupes = rawCentroids.length - phantom.length - deduped.length;
  const centroids = [...deduped, ...MISSING_FROM_GEOMETRY];
  console.log(
    `  ✓ ${centroids.length} real districts ` +
      `(dropped ${phantom.length} state-level rows and ${dupes} duplicates, ` +
      `added ${MISSING_FROM_GEOMETRY.length} missing)`,
  );

  const polygons = JSON.parse(readFileSync(join(DATA, "india-districts.json"), "utf8"));
  const areaByKey = new Map(
    polygons.map((p) => [`${norm(p.d)}|${norm(p.s)}`, polygonAreaKm2(p.g)]),
  );

  const profiles = [];
  const unmatched = [];

  /**
   * A 2011 district may be claimed by exactly one modern district.
   *
   * Without this, every split double-counts: two halves of Bardhaman each take
   * Bardhaman's full population and West Bengal gains millions of people who do
   * not exist. Whoever matches first — exact name beats alias beats fuzzy —
   * keeps it; the rest fall through to apportionment, where the state total
   * constrains them.
   */
  const claimed = new Set();
  const claim = (row) => {
    if (!row) return null;
    const key = `${norm(row["State name"])}|${norm(row["District name"])}`;
    if (claimed.has(key)) return null;
    claimed.add(key);
    return row;
  };

  // Exact names first, across the whole country, so a later fuzzy match can
  // never steal a district that some other centroid matches exactly.
  const passes = [
    (cands, dKey) => cands.find((r) => norm(r["District name"]) === dKey),
    (cands, dKey) => cands.find((r) => norm(r["District name"]) === DISTRICT_ALIAS[dKey]),
  ];

  for (const c of centroids) {
    const dKey = norm(c.d);
    const sKey = norm(c.s);
    const candidates = censusStatesFor(sKey).flatMap((k) => byState.get(k) ?? []);

    let hit = null;
    for (const pass of passes) {
      hit = claim(pass(candidates, dKey));
      if (hit) break;
    }

    if (!hit && candidates.length) {
      // Best fuzzy match inside the same state, above a threshold chosen to
      // accept transliteration drift (Baleshwar/Balasore) and reject genuine
      // neighbours (Bilaspur/Bijapur).
      let best = null;
      let bestScore = 0;
      for (const r of candidates) {
        if (claimed.has(`${norm(r["State name"])}|${norm(r["District name"])}`)) continue;
        const s = similarity(dKey, norm(r["District name"]));
        if (s > bestScore) {
          bestScore = s;
          best = r;
        }
      }
      if (bestScore >= 0.84) hit = claim(best);
    }

    const areaKm2 = areaByKey.get(`${dKey}|${sKey}`) ?? c.areaKm2 ?? null;

    if (!hit) {
      // A district carved out after 2011 — Telangana alone went from 10 to 33.
      // Its people were counted, but under boundaries that no longer exist, so
      // there is no direct figure. Left null here and filled by apportionment
      // below, which conserves the state total exactly.
      unmatched.push(`${c.d} (${c.s})`);
      profiles.push({
        d: c.d,
        s: c.s,
        censusState: censusStatesFor(sKey).join("+"),
        lat: c.lat,
        lng: c.lng,
        areaKm2: areaKm2 ? Math.round(areaKm2) : null,
        population: null,
        estimated: true,
      });
      continue;
    }

    const population = num(hit, "Population");
    const households = num(hit, "Households");
    const powerParityTotal = num(hit, "Total_Power_Parity");

    profiles.push({
      d: c.d,
      s: c.s,
      censusState: censusStatesFor(sKey).join("+"),
      lat: c.lat,
      lng: c.lng,
      areaKm2: areaKm2 ? Math.round(areaKm2) : null,
      population,
      households,
      density: areaKm2 ? Math.round(population / areaKm2) : null,
      ruralPct: pct(num(hit, "Rural_Households"), households),
      fragileHousingPct: pct(
        num(hit, "Condition_of_occupied_census_houses_Dilapidated_Households"),
        households,
      ),
      phoneReachPct: pct(num(hit, "Households_with_Telephone_Mobile_Phone"), households),
      elderlyPct: pct(num(hit, "Age_Group_50"), population),
      lowIncomePct: pct(num(hit, "Power_Parity_Less_than_Rs_45000"), powerParityTotal),
    });
  }

  // ── Reconcile every state to its 2011 total
  //
  // Two things leave a state unbalanced. A district created since 2011 has no
  // 2011 figure, because its people were counted under boundaries that no
  // longer exist — Telangana went from 10 districts to 33. And our geometry is
  // sometimes coarser than the census, so 2011 districts go unclaimed: the
  // whole Delhi NCT is one district here and nine there.
  //
  // The rule that matters most is what this does NOT do. A district that
  // matched its 2011 record keeps that figure exactly, always. An earlier
  // version scaled whole states to force the national total to reconcile, and
  // it inflated Thane by 783,000 people to absorb an unclaimed Mumbai. A
  // coordinator reading a wrong population for a real district is a worse
  // failure than a shortfall in a national sum nobody acts on — so verified
  // figures are never touched, and what cannot be placed is reported instead of
  // being smeared across them.
  const censusStateTotals = new Map();
  for (const r of rows) {
    const k = norm(r["State name"]);
    censusStateTotals.set(k, (censusStateTotals.get(k) ?? 0) + num(r, "Population"));
  }

  const byCensusState = new Map();
  for (const p of profiles) {
    if (!byCensusState.has(p.censusState)) byCensusState.set(p.censusState, []);
    byCensusState.get(p.censusState).push(p);
  }

  let estimatedPeople = 0;
  const unallocated = [];

  for (const [state, group] of byCensusState) {
    const stateTotal = state
      .split("+")
      .reduce((a, k) => a + (censusStateTotals.get(k) ?? 0), 0);
    if (!stateTotal) continue;

    const gaps = group.filter((p) => p.population === null);
    const held = group.reduce((a, p) => a + (p.population ?? 0), 0);
    let residual = stateTotal - held;

    if (gaps.length) {
      // What is left of the state, spread over the new districts by land area.
      const gapArea = gaps.reduce((a, p) => a + (p.areaKm2 ?? 0), 0);
      // Never more than the state's own average density would put there — the
      // rest is an unclaimed 2011 district, not people living in the new one.
      const groupArea = group.reduce((a, p) => a + (p.areaKm2 ?? 0), 0);
      const byDensity = groupArea > 0 ? (stateTotal / groupArea) * gapArea : 0;
      const allocatable = Math.max(0, Math.min(residual, Math.round(byDensity)));

      for (const p of gaps) {
        p.population =
          gapArea > 0 ? Math.round((allocatable * (p.areaKm2 ?? 0)) / gapArea) : 0;
        estimatedPeople += p.population;
      }
      residual -= allocatable;

      // Where our one district IS the whole state — Delhi, Chandigarh, Goa's
      // UT neighbours — it receives the state total exactly. That is a census
      // figure under a different name, not an estimate, and labelling it one
      // would understate a number that is precisely right.
      if (group.length === 1 && gaps.length === 1 && residual === 0) {
        delete gaps[0].estimated;
      }
    }

    if (residual > 50_000) {
      unallocated.push({ state, residual });
    }

    for (const p of group) {
      p.density = p.areaKm2 && p.population ? Math.round(p.population / p.areaKm2) : null;
      if (p.estimated) {
        p.note =
          "District created after the 2011 census. Population estimated from the state " +
          "total by land area — an estimate, not a count.";
      }
    }
  }

  // ── Carry the 2011 base forward to today
  //
  // The census is fifteen years old and there is no newer one. Rather than
  // invent a growth rate, each district is grown at its own state's official
  // rate from the National Commission on Population's projections — see
  // extract-state-projections.mjs. The district's share of its state is held
  // constant, which is an approximation (urban districts outgrow rural ones
  // inside the same state), so both numbers are kept and the projection is
  // always labelled as one.
  let projection = null;
  try {
    projection = JSON.parse(readFileSync(join(DATA, "state-projection.json"), "utf8"));
  } catch {
    console.log("\n  ⚠ state-projection.json missing — run extract-state-projections.mjs first");
  }

  if (projection) {
    const growthByState = new Map();
    for (const [name, v] of Object.entries(projection.states)) {
      growthByState.set(norm(name), v.growth);
    }
    const nationalGrowth = projection.india.p2026 / projection.india.p2011;

    /**
     * Table 8 names three states differently and omits six small ones.
     *
     * Ladakh separated from J&K after the report, so it inherits J&K's rate.
     * Telangana is not projected separately; undivided Andhra is the closest
     * proxy — same region, near-identical fertility — and far better than the
     * national average, which is dominated by the northern states.
     */
    const PROJECTION_ALIAS = {
      delhi: "nctofdelhi",
      jammuandkashmir: "jammukashmir",
      ladakh: "jammukashmir",
      telangana: "andhrapradesh",
    };

    let projected = 0;
    const fellBack = new Set();
    for (const p of profiles) {
      const key = PROJECTION_ALIAS[norm(p.s)] ?? norm(p.s);
      const growth = growthByState.get(key);
      // Goa and the small island UTs are not in the report at all. The national
      // rate is a weaker estimate, so it is recorded as such rather than passed
      // off as the state's own.
      if (growth === undefined) fellBack.add(p.s);
      p.population2026 = Math.round(p.population * (growth ?? nationalGrowth));
      p.growthFactor = Math.round((growth ?? nationalGrowth) * 10000) / 10000;
      p.growthSource = growth === undefined ? "national" : "state";
      projected += p.population2026;
    }
    if (fellBack.size) {
      console.log(
        `  not projected separately by the report, using the national rate: ${[...fellBack].join(", ")}`,
      );
    }
    console.log(
      `\n  projected to ${projection.targetYear}: ${projected.toLocaleString()} ` +
        `(India ×${nationalGrowth.toFixed(4)}, per state)`,
    );
  }

  const matched = profiles.filter((p) => p.population !== null && !p.estimated);
  const covered = profiles.reduce((a, p) => a + (p.population ?? 0), 0);

  writeFileSync(join(DATA, "district-profiles.json"), JSON.stringify(profiles));

  console.log(`\n  ${profiles.length} districts written`);
  console.log(`  ${matched.length} matched directly to a 2011 district`);
  console.log(
    `  ${unmatched.length} created since 2011, estimated by area (${estimatedPeople.toLocaleString()} people)`,
  );

  if (unallocated.length) {
    const sum = unallocated.reduce((a, u) => a + u.residual, 0);
    console.log(
      `\n  ${sum.toLocaleString()} people belong to 2011 districts our geometry does not`,
    );
    console.log(`  separate. Left unallocated rather than added to a verified district:`);
    for (const u of unallocated.sort((a, b) => b.residual - a.residual).slice(0, 8)) {
      console.log(`    ${u.state.padEnd(24)} ${u.residual.toLocaleString()}`);
    }
  }

  const drift = INDIA_2011 - covered;
  console.log(`\n  covered: ${covered.toLocaleString()} of ${INDIA_2011.toLocaleString()}`);
  const driftPct = (100 * drift) / INDIA_2011;
  if (Math.abs(driftPct) > 3) {
    console.log(`  ⚠ ${drift.toLocaleString()} (${driftPct.toFixed(2)}%) unplaced — check the alias maps`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${drift.toLocaleString()} unplaced (${driftPct.toFixed(2)}%) — within tolerance`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
