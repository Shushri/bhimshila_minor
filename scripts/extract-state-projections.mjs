/**
 * Build src/data/state-projection.json from the Government of India's own
 * population projections.
 *
 *   node scripts/extract-state-projections.mjs
 *
 * WHY
 *
 * Census 2011 is fifteen years old. It is also the most recent COMPLETED census
 * — the 2021 round was postponed and is now scheduled for 2027 — so every
 * Indian data product is built on it and has to deal with the age.
 *
 * The honest way to carry it forward is not to invent a growth rate. The
 * National Commission on Population (MoHFW) published "Population Projections
 * for India and States 2011-2036", Table 8, which gives an official projected
 * population for every state for every year to 2036. Taking the 2026 and 2011
 * rows gives a per-state growth factor that is the government's own estimate,
 * citable, and does not require us to model anything.
 *
 * Applying that factor to a district's 2011 population holds the district's
 * share of its state constant and grows it at the state's official rate. That
 * is an approximation — districts within a state grow at different rates, and
 * urban ones much faster — so projected figures are labelled as projections
 * everywhere they surface, and the census figure is kept alongside.
 *
 * The 11 MB source PDF is parsed once and the small result committed, rather
 * than downloaded on every build.
 *
 * Source: nhm.gov.in/New_Updates_2018/Report_Population_Projection_2019.pdf
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "src", "data", "state-projection.json");

const PDF_URL = "https://nhm.gov.in/New_Updates_2018/Report_Population_Projection_2019.pdf";

const BASE_YEAR = 2011;
const TARGET_YEAR = 2026;

/** Published Census 2011 total, in thousands, as Table 8 states it. */
const INDIA_2011_THOUSANDS = 1_210_855;

const clean = (s) => s.replace(/,/g, "").trim();

async function pdfText() {
  const dir = mkdtempSync(join(tmpdir(), "dai-proj-"));
  const pdf = join(dir, "projection.pdf");
  const txt = join(dir, "projection.txt");

  console.log("Fetching the NCP projection report (11 MB)…");
  const res = await fetch(PDF_URL);
  if (!res.ok) throw new Error(`Projection PDF download failed: ${res.status}`);
  writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));

  try {
    // -layout preserves the column alignment the table depends on.
    execFileSync("pdftotext", ["-layout", pdf, txt]);
  } catch {
    throw new Error(
      "pdftotext is required to parse the projection report (brew install poppler).",
    );
  }
  return readFileSync(txt, "utf8");
}

/**
 * Parse Table 8.
 *
 * It runs across many pages, three states per page, years down the rows:
 *
 *          INDIA            JAMMU & KASHMIR*(UT)     HIMACHAL PRADESH
 *   Year  Persons Male Females  Persons Male Females  Persons Male Females
 *   2011  12,10,855 6,23,270 …  12,267 6,484 …        6,865 3,482 …
 *
 * So each year row carries nine numbers, and the Persons column for the three
 * states is at offsets 0, 3 and 6.
 */
function parseTable8(text) {
  const lines = text.split(/\r?\n/);
  const byState = new Map();

  let heads = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/Projected Total Population by Sex as on 1st March/.test(line)) {
      // The state names sit within the next few lines. Poppler's pdftotext
      // puts them on their own line before a bare "Year"; Xpdf's puts "Year"
      // and the three names on ONE line — so a leading "Year" token is
      // stripped before asking for exactly three all-caps names.
      heads = null;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const candidate = lines[j];
        if (/^\s*Year\s*$/.test(candidate)) break;
        // Split on runs of 2+ spaces; a header row has 3 all-caps names.
        let parts = candidate.trim().split(/\s{2,}/).filter(Boolean);
        if (parts[0] === "Year") parts = parts.slice(1);
        if (parts.length === 3 && parts.every((p) => /[A-Z]{3}/.test(p))) {
          heads = parts.map((p) =>
            p.replace(/\*/g, "").replace(/\(UT\)/gi, "").replace(/\s+/g, " ").trim(),
          );
          break;
        }
      }
      continue;
    }

    if (!heads) continue;

    const m = /^\s*(20\d{2})\s+(.+)$/.exec(line);
    if (!m) continue;
    const year = Number(m[1]);
    if (year !== BASE_YEAR && year !== TARGET_YEAR) continue;

    const nums = m[2].trim().split(/\s+/).map(clean).map(Number);
    if (nums.length < 9 || nums.some(Number.isNaN)) continue;

    heads.forEach((state, k) => {
      const persons = nums[k * 3];
      if (!Number.isFinite(persons)) return;
      if (!byState.has(state)) byState.set(state, {});
      byState.get(state)[year] = persons;
    });
  }

  return byState;
}

async function main() {
  const text = await pdfText();
  const table = parseTable8(text);

  const india = table.get("INDIA");
  if (!india?.[BASE_YEAR] || !india?.[TARGET_YEAR]) {
    throw new Error("Could not locate India's row in Table 8 — the report layout may have changed.");
  }
  if (Math.abs(india[BASE_YEAR] - INDIA_2011_THOUSANDS) > 50) {
    throw new Error(
      `Parsed India 2011 as ${india[BASE_YEAR]}k, expected ~${INDIA_2011_THOUSANDS}k. Parse is wrong.`,
    );
  }

  const states = {};
  let dropped = 0;
  for (const [name, years] of table) {
    const a = years[BASE_YEAR];
    const b = years[TARGET_YEAR];
    if (!a || !b || a <= 0) {
      dropped++;
      continue;
    }
    states[name] = {
      p2011: a * 1000,
      p2026: b * 1000,
      growth: Math.round((b / a) * 10000) / 10000,
    };
  }

  // Two names truncate at a column edge in the PDF ("DADRA & NAGAR" over
  // "HAVELI", "ANDAMAN & NICOBAR" over "ISLANDS"), and one pair merged
  // administratively in 2020, after the report was written. Complete the
  // names, and publish the merged UT under the census's own name so the
  // district layer matches it without an alias table.
  // "AND", written out, because the census writes it out and the matcher
  // normalises "&" away entirely — "ANDAMAN & NICOBAR" and "Andaman and
  // Nicobar Islands" collapse to different keys.
  const andaman = states["ANDAMAN & NICOBAR"] ?? states["ANDAMAN & NICOBAR ISLANDS"];
  if (andaman) {
    states["ANDAMAN AND NICOBAR ISLANDS"] = andaman;
    delete states["ANDAMAN & NICOBAR"];
    delete states["ANDAMAN & NICOBAR ISLANDS"];
  }
  const daman = states["DAMAN & DIU"];
  const dnh = states["DADRA & NAGAR"] ?? states["DADRA & NAGAR HAVELI"];
  if (daman && dnh) {
    const p2011 = daman.p2011 + dnh.p2011;
    const p2026 = daman.p2026 + dnh.p2026;
    states["DADRA AND NAGAR HAVELI AND DAMAN AND DIU"] = {
      p2011,
      p2026,
      growth: Math.round((p2026 / p2011) * 10000) / 10000,
    };
  }

  const payload = {
    source:
      "Population Projections for India and States 2011-2036, Table 8. " +
      "National Commission on Population, Ministry of Health and Family Welfare, 2019.",
    url: PDF_URL,
    baseYear: BASE_YEAR,
    targetYear: TARGET_YEAR,
    india: { p2011: india[BASE_YEAR] * 1000, p2026: india[TARGET_YEAR] * 1000 },
    states,
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 1));

  const g = india[TARGET_YEAR] / india[BASE_YEAR];
  console.log(`\n  ${Object.keys(states).length} states/UTs parsed${dropped ? `, ${dropped} skipped` : ""}`);
  console.log(`  India ${BASE_YEAR}: ${(india[BASE_YEAR] * 1000).toLocaleString()}`);
  console.log(`  India ${TARGET_YEAR}: ${(india[TARGET_YEAR] * 1000).toLocaleString()}  (×${g.toFixed(4)})`);

  const ranked = Object.entries(states)
    .filter(([n]) => n !== "INDIA")
    .sort((a, b) => b[1].growth - a[1].growth);
  console.log("\n  fastest growing:");
  for (const [n, v] of ranked.slice(0, 4)) console.log(`    ${n.padEnd(24)} ×${v.growth}`);
  console.log("  slowest:");
  for (const [n, v] of ranked.slice(-3)) console.log(`    ${n.padEnd(24)} ×${v.growth}`);
}

if (!existsSync(join(ROOT, "src", "data"))) throw new Error("run from the dai/ directory");
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
