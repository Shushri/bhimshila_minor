/**
 * Run every suite and say honestly which ran.
 *
 * Half the suites need the dev server on :3000 and several talk to live
 * sources on purpose (see README). A missing server skips those loudly rather
 * than failing them — "12 suites passed" must never quietly mean "the 6 that
 * could run without a server passed".
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));

const OFFLINE = ["triage.mjs", "router.mjs", "districts.mjs", "protocols.mjs", "shelters.mjs", "language.mjs", "voices.mjs", "commands.mjs", "reach.mjs", "camps.mjs", "translit.mjs"];
const LIVE_SOURCES = ["sachet.mjs", "exposure.mjs", "anomaly.mjs"];
const NEEDS_SERVER = ["testall.mjs", "authz.mjs", "watch.mjs", "telegram.mjs", "missions.mjs", "field.mjs", "relief.mjs"];

/**
 * `--only=live` or `--only=deterministic` splits the battery for CI.
 *
 * The live-source suites talk to NDMA and Open-Meteo on purpose, which is the
 * point of them — but a government feed being slow is not a code failure, and a
 * pipeline that goes red for it teaches everyone to ignore the pipeline. CI
 * gates on the deterministic half and reports the live half without blocking.
 * Run with no flag and you get everything, which is what a person wants.
 */
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

let serverUp = false;
try {
  const r = await fetch("http://localhost:3000/api/auth", { signal: AbortSignal.timeout(5000) });
  serverUp = r.ok;
} catch {
  serverUp = false;
}

const groups =
  only === "live"
    ? [LIVE_SOURCES]
    : only === "deterministic"
      ? [OFFLINE, serverUp ? NEEDS_SERVER : []]
      : [OFFLINE, LIVE_SOURCES, serverUp ? NEEDS_SERVER : []];

const toRun = groups.flat();
const skipped = serverUp || only === "live" ? [] : NEEDS_SERVER;

const failed = [];
for (const suite of toRun) {
  console.log(`\n━━ ${suite} ${"━".repeat(Math.max(1, 50 - suite.length))}`);
  const r = spawnSync(process.execPath, [join(HERE, suite)], { stdio: "inherit" });
  if (r.status !== 0) failed.push(suite);
}

console.log("\n" + "═".repeat(56));
console.log(`${toRun.length - failed.length}/${toRun.length} suites passed`);
if (skipped.length) {
  console.log(`SKIPPED (no dev server on :3000 — run \`npm run dev\` first): ${skipped.join(", ")}`);
}
if (failed.length) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
process.exit(skipped.length ? 2 : 0);
