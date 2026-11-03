/**
 * The monitoring loop.
 *
 * Two failures this is guarding against. The first is crying wolf: without a
 * record of what was already known, every sweep reports a hundred brand-new
 * alerts and the queue stops being read. The second is worse — reporting an
 * unreachable feed as "no alerts", which turns a government outage into an
 * all-clear.
 *
 * Needs a dev server on :3000.
 */
const BASE = "http://localhost:3000";

let pass = 0;
const failures = [];
const check = (n, ok, d = "") => {
  if (ok) { pass++; console.log(`  ✓ ${n}`); }
  else { failures.push(`${n} — ${d}`); console.log(`  ✗ ${n}  ${d}`); }
};

const jar = { cookie: "" };
async function call(j, path, body, method) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(j.cookie ? { cookie: j.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) j.cookie = sc.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

console.log("\nSWEEP");
const first = await call(jar, "/api/watch");
check("sweep responds", first.status === 200, `got ${first.status}`);
check("reports whether the source was reachable", typeof first.json?.sourceReachable === "boolean");

if (!first.json?.sourceReachable) {
  // NDMA is down right now. That is a legitimate state, and the one assertion
  // that still matters is that it is never dressed up as an all-clear.
  check("an outage is stated, not silently treated as all-clear",
    typeof first.json?.note === "string" && /not an all-clear/i.test(first.json.note),
    JSON.stringify(first.json)?.slice(0, 120));
  check("no changes are invented from an empty feed", first.json?.changes?.length === 0);
} else {
  check("checked a nonzero number of live alerts", first.json.checked > 0, `${first.json.checked}`);

  console.log("\nIDEMPOTENCE");
  const second = await call(jar, "/api/watch");
  check("a repeat sweep reports no changes", second.json?.changes?.length === 0,
    `${second.json?.changes?.length} changes on the second pass`);
  check("but still sees the same alerts", second.json?.checked === first.json?.checked,
    `${first.json?.checked} then ${second.json?.checked}`);

  console.log("\nQUEUE");
  const q = second.json?.queue ?? [];
  check("queue excludes yellow — 50 'be aware' alerts would bury the reds",
    q.every((x) => x.colour === "red" || x.colour === "orange"),
    [...new Set(q.map((x) => x.colour))].join(","));
  check("queue is severest first",
    q.length < 2 || q[0].colour === "red" || q.every((x) => x.colour === "orange"),
    q.slice(0, 3).map((x) => x.colour).join(","));
  check("every queued alert names its issuing authority",
    q.every((x) => typeof x.source === "string" && x.source.length > 2));
  check("every queued alert carries its CAP id", q.every((x) => !!x.capId));

  console.log("\nACKNOWLEDGE IS COORDINATOR-ONLY");
  const anon = { cookie: "" };
  let r = await call(anon, "/api/watch", { capIds: q.slice(0, 1).map((x) => x.capId) });
  check("anonymous cannot clear the queue", r.status === 401, `got ${r.status}`);

  const cit = { cookie: "" };
  await call(cit, "/api/auth", {
    action: "signup", phone: "9" + String(Math.floor(Math.random() * 9e8) + 1e8),
    password: "relief2026", name: "Citizen", role: "citizen", place: "Kangra",
  });
  r = await call(cit, "/api/watch", { capIds: q.slice(0, 1).map((x) => x.capId) });
  check("a citizen cannot clear the queue", r.status === 403, `got ${r.status}`);

  if (q.length) {
    const coord = { cookie: "" };
    await call(coord, "/api/auth", {
      action: "signup", phone: "9" + String(Math.floor(Math.random() * 9e8) + 1e8),
      password: "relief2026", name: "Coordinator", role: "coordinator", place: "Kangra",
    });
    // Assert the property, not a count. Comparing queue lengths across runs
    // makes this depend on whether NDMA happened to issue something between
    // sweeps, which is how it first went flaky.
    const target = q[0].capId;
    r = await call(coord, "/api/watch", { capIds: [target] });
    check("a coordinator clears it", r.status === 200 && r.json?.cleared === 1,
      `status ${r.status} cleared ${r.json?.cleared}`);
    check("the cleared alert leaves the queue",
      !(r.json?.queue ?? []).some((x) => x.capId === target), `${target} still queued`);
    check("clearing the same alert twice is a no-op",
      (await call(coord, "/api/watch", { capIds: [target] })).json?.cleared === 0);
  }
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES");
  for (const f of failures) console.log("  •", f);
}
process.exit(failures.length ? 1 : 0);
