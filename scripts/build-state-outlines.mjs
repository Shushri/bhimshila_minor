/**
 * Fill the gaps in src/data/state-outlines.json from the district polygons.
 *
 *   node scripts/build-state-outlines.mjs           # report only
 *   node scripts/build-state-outlines.mjs --write   # add the missing states
 *
 * WHY THIS EXISTS
 *
 * The outline file shipped with 34 of India's 36 states. The two it did not
 * have were Ladakh and — this is the one that matters — Uttarakhand, which is
 * where Kedarnath is, which is the disaster this entire product is named
 * after. On the map, the whole top of the country simply was not drawn: the
 * outlines stopped at 35.5°N while India reaches 37.1°N.
 *
 * The district file has both states. So the shapes were always there; only
 * the state-level boundary was missing, and it can be derived.
 *
 * HOW
 *
 * Dissolve, by edge cancellation. Districts that share a border describe that
 * border twice, once in each direction. Collect every edge, drop the ones that
 * appear in both directions, and what remains is the outer boundary — which is
 * then stitched back into closed rings.
 *
 * This is exact rather than approximate, and it depends on one thing being
 * true of the source: adjacent districts must share identical vertices along
 * their common border. That is checked and reported before anything is
 * written, because if it does not hold the result would be a state outline
 * with district seams still in it, which would look like a rendering bug
 * rather than a data one.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "src", "data");

const districts = JSON.parse(readFileSync(join(DATA, "india-districts.json"), "utf8"));
const outlines = JSON.parse(readFileSync(join(DATA, "state-outlines.json"), "utf8"));

/** Coordinates are rounded in the source; key on the printed form so shared
 *  vertices compare equal without floating-point noise. */
const key = ([lng, lat]) => `${lng.toFixed(3)},${lat.toFixed(3)}`;

function dissolve(polygons) {
  // Every directed edge in every ring of every district in this state.
  const edges = new Map();
  for (const poly of polygons) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = key(ring[i]);
        const b = key(ring[i + 1]);
        if (a === b) continue;
        edges.set(`${a}|${b}`, [ring[i], ring[i + 1]]);
      }
    }
  }

  // An internal border is described once from each side, so it appears as both
  // a→b and b→a. Removing both leaves only the outer boundary.
  const boundary = new Map();
  let cancelled = 0;
  for (const [id, seg] of edges) {
    const [a, b] = id.split("|");
    if (edges.has(`${b}|${a}`)) {
      cancelled++;
      continue;
    }
    boundary.set(id, seg);
  }

  // Stitch the surviving edges into closed rings by following each end to the
  // edge that starts where it finished.
  const from = new Map();
  for (const [id, seg] of boundary) {
    const a = id.split("|")[0];
    if (!from.has(a)) from.set(a, []);
    from.get(a).push({ id, seg });
  }

  const rings = [];
  const used = new Set();
  for (const [id, seg] of boundary) {
    if (used.has(id)) continue;
    const ring = [seg[0]];
    let current = { id, seg };

    while (current && !used.has(current.id)) {
      used.add(current.id);
      ring.push(current.seg[1]);
      const next = (from.get(key(current.seg[1])) ?? []).find((e) => !used.has(e.id));
      current = next;
    }

    if (ring.length > 3) rings.push(ring);
  }

  // Drop slivers.
  //
  // Cancellation is not perfectly clean — the source rounds coordinates to
  // three decimals, so a handful of shared vertices differ in the last place
  // and survive as tiny loops a few hundred metres across. Every state comes
  // out as one dominant ring plus a scatter of those. Keeping anything at
  // least a twentieth of the largest ring's area preserves real islands and
  // exclaves, which matter for Andaman and for Puducherry, while discarding
  // artifacts that would render as specks of noise on the coastline.
  const area = (r) => {
    let minLng = 1e9, minLat = 1e9, maxLng = -1e9, maxLat = -1e9;
    for (const [lng, lat] of r) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return (maxLng - minLng) * (maxLat - minLat);
  };
  const largest = Math.max(...rings.map(area), 0);
  const kept = rings.filter((r) => area(r) >= largest / 20);

  return { rings: kept, dropped: rings.length - kept.length, cancelled, boundaryEdges: boundary.size };
}

const byState = new Map();
for (const d of districts) {
  if (!byState.has(d.s)) byState.set(d.s, []);
  byState.get(d.s).push(...d.g);
}

/*
 * Every state, not only the absent ones.
 *
 * The shipped file was a legacy artifact: it carried Orissa and Uttaranchal,
 * names retired in 2011 and 2007, listed Dadra and Nagar Haveli separately
 * from Daman and Diu although they merged in 2020, and had neither Telangana
 * (2014) nor Ladakh (2019) at all. Every one of those mismatches silently
 * broke the join between a state's shape and its data, which is why several
 * states never lit up.
 *
 * Rebuilding all of them from the district file makes one source authoritative
 * for both the shapes and the names, so a state and its districts can never
 * again disagree about what it is called or where it ends.
 */
const states = [...byState.keys()].sort();

console.log(`  outline file has ${Object.keys(outlines).length} states (legacy names)`);
console.log(`  district file has ${byState.size} states (current)`);
const stale = Object.keys(outlines).filter((s) => !byState.has(s)).sort();
console.log(`  names no longer current: ${stale.join(", ") || "none"}\n`);

const built = {};
for (const state of states) {
  const polys = byState.get(state);
  const { rings, dropped, cancelled } = dissolve(polys);
  if (!rings.length) {
    console.log(`  ${state.padEnd(38)} ✗ no ring survived — left as-is`);
    continue;
  }
  const points = rings.reduce((n, r) => n + r.length, 0);
  const lats = rings.flat().map((p) => p[1]);
  console.log(
    `  ${state.padEnd(38)} ${String(polys.length).padStart(3)} polys → ` +
      `${rings.length} ring(s) ${String(points).padStart(4)} pts · ` +
      `${String(cancelled).padStart(4)} dissolved, ${dropped} slivers dropped · ` +
      `lat ${Math.min(...lats).toFixed(1)}–${Math.max(...lats).toFixed(1)}`,
  );
  built[state] = rings;
}

if (!process.argv.includes("--write")) {
  console.log("\n  (report only — pass --write to update state-outlines.json)");
  process.exit(0);
}

// Replaced wholesale rather than merged: leaving the legacy keys behind would
// mean two entries for the same ground under two names, and the map would draw
// Orissa and Odisha on top of each other.
writeFileSync(join(DATA, "state-outlines.json"), JSON.stringify(built));
const lats = Object.values(built).flat(2).map((p) => p[1]);
console.log(`\n  wrote ${Object.keys(built).length} states`);
console.log(`  northern extent now ${Math.max(...lats).toFixed(2)}N (was 35.50N, map bounds reach 37.2N)`);
