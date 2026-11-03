/**
 * Build src/data/shelters.json — public buildings that can serve as evacuation
 * destinations, bundled so they work with no network.
 *
 *   node scripts/build-shelters.mjs
 *
 * WHY THIS EXISTS
 *
 * nearbyShelters() queried Overpass live, on demand, with caching disabled. The
 * organizers' brief states as a hard constraint:
 *
 *   "How do you keep this usable when connectivity and time are both scarce
 *    during an actual disaster?"
 *
 * A disaster is precisely when Overpass is unreachable, rate-limited or slow
 * enough not to matter. "Where do I go" is the one question that has to answer
 * offline, so the answer ships with the app.
 *
 * WHY NOT OVERPASS
 *
 * The first version of this script asked Overpass for each district in turn.
 * It is free, volunteer-run infrastructure, and 700 queries is not a reasonable
 * thing to ask of it — the run was refused after 48 requests, correctly. HDX
 * publishes the same OpenStreetMap data as a pre-built national extract, so
 * this is two downloads instead of seven hundred queries. When a bulk export
 * exists, hammering an API for the same rows is just rude.
 *
 * WHAT THIS IS AND IS NOT
 *
 * Schools, colleges, hospitals and clinics from OpenStreetMap — the buildings
 * that actually get used as relief camps. It is NOT a register of designated
 * cyclone shelters; India has those, but not as an open machine-readable feed,
 * and the app says which of the two it is showing. Coverage follows OSM and is
 * uneven: a metro district returns dozens, a remote one may return none.
 * Districts with nothing are recorded as having nothing rather than quietly
 * omitted, so the gap is visible.
 *
 * Source: Humanitarian OpenStreetMap Team via HDX (UN OCHA), ODbL.
 */

import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = join(ROOT, "src", "data");

const SOURCES = [
  {
    kind: "education",
    url: "https://production-raw-data-api.s3.amazonaws.com/ISO3/IND/education_facilities/hotosm_ind_education_facilities_osm_geojson.zip",
  },
  {
    kind: "health",
    url: "https://production-raw-data-api.s3.amazonaws.com/ISO3/IND/health_facilities/hotosm_ind_health_facilities_osm_geojson.zip",
  },
];

/** Metres from a district centre. Beyond this, "nearby" would be a lie. */
const RADIUS_M = 30_000;
/** Kept per district — enough to offer a choice, small enough to ship. */
const PER_DISTRICT = 6;

const R = 6_371_000;
function haversineM(aLat, aLng, bLat, bLng) {
  const p = Math.PI / 180;
  const dLat = (bLat - aLat) * p;
  const dLng = (bLng - aLng) * p;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Representative point of any GeoJSON geometry. */
function pointOf(geometry) {
  if (!geometry) return null;
  const { type, coordinates: c } = geometry;
  if (type === "Point") return { lng: c[0], lat: c[1] };
  if (type === "Polygon") return centroidOfRing(c[0]);
  if (type === "MultiPolygon") return centroidOfRing(c[0]?.[0]);
  if (type === "LineString") return { lng: c[0][0], lat: c[0][1] };
  return null;
}

function centroidOfRing(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let lng = 0;
  let lat = 0;
  for (const p of ring) {
    lng += p[0];
    lat += p[1];
  }
  return { lng: lng / ring.length, lat: lat / ring.length };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, dir, name, attempt = 1) {
  console.log(`  fetching ${name}${attempt > 1 ? ` (attempt ${attempt})` : ""}…`);
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  } catch (e) {
    // A 10 MB transfer dropping mid-stream is ordinary; retry rather than lose
    // the work already done on the other layer.
    if (attempt <= 4) {
      await sleep(3_000 * attempt);
      return download(url, dir, name, attempt + 1);
    }
    throw new Error(`${name}: ${e.message}`);
  }
  if (!res.ok) {
    if (res.status >= 500 && attempt <= 4) {
      await sleep(3_000 * attempt);
      return download(url, dir, name, attempt + 1);
    }
    throw new Error(`${name}: HTTP ${res.status}`);
  }
  const zip = join(dir, `${name}.zip`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

  execFileSync("unzip", ["-o", "-q", zip, "-d", join(dir, name)]);
  const listing = execFileSync("find", [join(dir, name), "-name", "*.geojson"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!listing.length) throw new Error(`${name}: no .geojson inside the archive`);
  return JSON.parse(readFileSync(listing[0], "utf8"));
}

/**
 * A spatial index, because the naive form is 724 × 100,000 comparisons.
 *
 * Facilities are binned into 0.25° cells (~28km) and each district only checks
 * the cells its radius can reach.
 */
const CELL = 0.25;
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "dai-shelters-"));
  console.log("Building offline shelter index from HDX / HOT extracts\n");

  const grid = new Map();
  let loaded = 0;

  for (const { kind, url } of SOURCES) {
    const fc = await download(url, dir, kind);
    for (const f of fc.features ?? []) {
      const pt = pointOf(f.geometry);
      if (!pt || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) continue;

      const tags = f.properties ?? {};
      const amenity = tags.amenity ?? tags.building ?? kind;
      // Unnamed points are not directable — "go to the unnamed school" helps
      // nobody — but they are kept as a last resort where nothing else exists.
      const entry = {
        n: tags.name ?? null,
        k: amenity,
        lat: Math.round(pt.lat * 1e4) / 1e4,
        lng: Math.round(pt.lng * 1e4) / 1e4,
      };
      const key = cellKey(pt.lat, pt.lng);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(entry);
      loaded++;
    }
    console.log(`    ${kind}: ${(fc.features ?? []).length.toLocaleString()} features`);
  }
  console.log(`\n  ${loaded.toLocaleString()} facilities indexed`);

  const districts = JSON.parse(readFileSync(join(DATA, "district-profiles.json"), "utf8"));
  const reach = Math.ceil(RADIUS_M / 111_000 / CELL);

  const out = {};
  let withAny = 0;
  let total = 0;

  for (const d of districts) {
    const near = [];
    const cLat = Math.floor(d.lat / CELL);
    const cLng = Math.floor(d.lng / CELL);

    for (let i = -reach; i <= reach; i++) {
      for (let j = -reach; j <= reach; j++) {
        for (const f of grid.get(`${cLat + i}:${cLng + j}`) ?? []) {
          const m = haversineM(d.lat, d.lng, f.lat, f.lng);
          if (m <= RADIUS_M) near.push({ ...f, m: Math.round(m) });
        }
      }
    }

    // Named first — "Government Higher Secondary School" is directable,
    // "unnamed" is not — then nearest.
    const kept = near
      .sort((a, b) => (a.n ? 0 : 1) - (b.n ? 0 : 1) || a.m - b.m)
      .slice(0, PER_DISTRICT);

    out[`${d.d}|${d.s}`] = kept;
    if (kept.length) withAny++;
    total += kept.length;
  }

  writeFileSync(
    join(DATA, "shelters.json"),
    JSON.stringify({
      source: "Humanitarian OpenStreetMap Team via HDX (UN OCHA), ODbL",
      builtAt: new Date().toISOString().slice(0, 10),
      radiusM: RADIUS_M,
      note:
        "Schools, colleges, hospitals and clinics near each district centre — the buildings that " +
        "get used as relief camps. NOT a register of designated cyclone shelters; those are not " +
        "published as an open feed. Coverage follows OpenStreetMap and is uneven.",
      districts: out,
    }),
  );

  console.log(`\n  ${total.toLocaleString()} shelters kept across ${withAny} of ${districts.length} districts`);
  const gaps = districts.length - withAny;
  if (gaps) {
    console.log(`  ${gaps} districts have nothing mapped within ${RADIUS_M / 1000}km — recorded as empty`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
