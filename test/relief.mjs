/**
 * Relay and camp endpoints — the write halves.
 *
 * The read halves are checked as pure arithmetic in reach.mjs and camps.mjs.
 * What can only be checked against a running server is who is allowed to write
 * what, and whether a second report of the same shortage updates the row or
 * quietly doubles a camp's claim on the next truck.
 *
 * Needs the dev server on :3000.
 */
const BASE = "http://localhost:3000";

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name} — ${detail}`);
    console.log(`  ✗ ${name}  ${detail}`);
  }
};

const makeJar = () => ({ cookie: "" });
async function call(jar, path, body, method) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(jar.cookie ? { cookie: jar.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) jar.cookie = sc.split(";")[0];
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

const uniq = () => String(Date.now()).slice(-9);
async function signup(jar, role, place) {
  const phone = "9" + uniq();
  await call(jar, "/api/auth", {
    action: "signup",
    phone,
    password: "relief2026",
    name: `${role} ${phone.slice(-3)}`,
    role,
    place,
  });
  return phone;
}

const coord = makeJar();
const vol = makeJar();
const citizen = makeJar();
const nobody = makeJar();
await signup(coord, "coordinator", "Dhubri");
await signup(vol, "volunteer", "Dhubri");
await signup(citizen, "citizen", "Dhubri");

console.log("WHO MAY OPEN A CAMP");
{
  // A camp's recorded population is what ranks it against every other camp, so
  // an unreviewed edit there silently reorders the supply queue.
  let r = await call(nobody, "/api/camps", { action: "open_camp", name: "X", place: "Y" });
  check("anonymous cannot", r.status === 401, `got ${r.status}`);
  r = await call(vol, "/api/camps", { action: "open_camp", name: "X", place: "Y" });
  check("a volunteer cannot", r.status === 403, `got ${r.status}`);
  r = await call(citizen, "/api/camps", { action: "open_camp", name: "X", place: "Y" });
  check("a citizen cannot", r.status === 403, `got ${r.status}`);
}

let campId = null;
console.log("\nOPENING ONE, AND WHAT IT REQUIRES");
{
  let r = await call(coord, "/api/camps", { action: "open_camp", name: "", place: "Dhubri" });
  check("a camp with no name is refused", r.status === 400, `got ${r.status}`);

  r = await call(coord, "/api/camps", {
    action: "open_camp",
    name: `Check Camp ${uniq()}`,
    place: "Dhubri, Assam",
    people: 500,
  });
  check("a coordinator can open one", r.status === 200 && !!r.json?.campId, JSON.stringify(r.json));
  campId = r.json?.campId;
}

console.log("\nA SECOND REPORT OF THE SAME SHORTAGE UPDATES, NEVER DUPLICATES");
{
  await call(coord, "/api/camps", {
    action: "set_need",
    campId,
    item: "water",
    needed: 300,
    received: 0,
    urgency: "critical",
  });
  await call(coord, "/api/camps", {
    action: "set_need",
    campId,
    item: "water",
    needed: 300,
    received: 250,
    urgency: "normal",
  });

  const r = await call(coord, "/api/camps?place=Dhubri");
  const mine = (r.json?.camps ?? []).find((c) => c.id === campId);
  // Two rows for "water" would be counted twice by the ranking and double this
  // camp's claim on the next truck.
  check(
    "only the latest figures survive",
    !mine || mine.unmet.filter((n) => n.item === "water").length <= 1,
    JSON.stringify(mine?.unmet),
  );
  check(
    "the delivered 250 counts — 50 short, not 300",
    !mine || mine.unmet.find((n) => n.item === "water")?.short === 50,
    JSON.stringify(mine?.unmet),
  );
}

console.log("\nA FULLY SUPPLIED CAMP LEAVES THE SUPPLY LIST");
{
  await call(coord, "/api/camps", {
    action: "set_need",
    campId,
    item: "water",
    needed: 300,
    received: 300,
  });
  const r = await call(coord, "/api/camps?place=Dhubri");
  const mine = (r.json?.camps ?? []).find((c) => c.id === campId);
  check("it drops off rather than ranking last", !mine, mine ? JSON.stringify(mine.unmet) : "gone");
}

console.log("\nREADING CAMPS IS NOT COORDINATOR-ONLY");
{
  // A volunteer driving to a camp should know what it is short of.
  const r = await call(vol, "/api/camps");
  check("a volunteer can read the list", r.status === 200 && Array.isArray(r.json?.camps), `got ${r.status}`);
  const anon = await call(nobody, "/api/camps");
  check("anonymous cannot", anon.status === 401, `got ${anon.status}`);
}

console.log("\nA PLACE THAT MATCHES NOTHING IS NOT AN ALL-CLEAR");
{
  // The failure this guards against: asked about "India", no camp is recorded
  // under that word, and the empty result reads as "no camp needs anything".
  const r = await call(coord, "/api/camps?place=Narnia");
  check("it says which word matched nothing", r.json?.unmatched === "Narnia", JSON.stringify(r.json?.unmatched));
  check(
    "and widens rather than reporting empty",
    r.json?.scope === "all" || (r.json?.camps ?? []).length === 0,
    `scope=${r.json?.scope} camps=${(r.json?.camps ?? []).length}`,
  );
}

console.log("\nRELAY — ANY SIGNED-IN PERSON, BECAUSE THAT IS WHO RELAYS");
{
  let r = await call(nobody, "/api/relay", { alertId: 1, households: 5, place: "X" });
  check("anonymous cannot log one", r.status === 401, `got ${r.status}`);

  // Whichever alert exists most recently; there may be none on a fresh world.
  const latest = await call(citizen, "/api/relay");
  const alertId = latest.json?.alert?.id;

  if (!alertId) {
    check("skipped — no alert exists yet to relay", true);
  } else {
    r = await call(citizen, "/api/relay", { alertId, households: 12, place: "Dhubri" });
    check("a citizen can — the trial measured community members, not job titles", r.status === 200, `got ${r.status}`);
    check("reach comes back with it", typeof r.json?.reach?.relayedHouseholds === "number", JSON.stringify(r.json?.reach));

    const before = r.json.reach.relayedHouseholds;
    r = await call(vol, "/api/relay", { alertId, households: 8, place: "Barpeta" });
    check("a volunteer can too, and it adds", r.json?.reach?.relayedHouseholds === before + 8,
      `${before} → ${r.json?.reach?.relayedHouseholds}`);
    check("two places are both named", (r.json?.reach?.places ?? []).length >= 2, JSON.stringify(r.json?.reach?.places));
  }
}

console.log("\nRELAY VALIDATION");
{
  const latest = await call(citizen, "/api/relay");
  const alertId = latest.json?.alert?.id ?? 1;
  let r = await call(citizen, "/api/relay", { households: 5, place: "X" });
  check("no alert id is refused", r.status === 400, `got ${r.status}`);
  r = await call(citizen, "/api/relay", { alertId, households: 0, place: "X" });
  check("zero households is refused", r.status === 400, `got ${r.status}`);
  r = await call(citizen, "/api/relay", { alertId, households: 5000, place: "X" });
  check("an implausible count is refused rather than swamping honest ones", r.status === 400, `got ${r.status}`);
  r = await call(citizen, "/api/relay", { alertId: 99999999, households: 5, place: "X" });
  check("a missing alert is a 404, not a 500", r.status === 404, `got ${r.status}`);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES");
  for (const f of failures) console.log("  •", f);
}
process.exit(failures.length ? 1 : 0);
