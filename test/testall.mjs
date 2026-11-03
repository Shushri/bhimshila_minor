/** Full-surface test: every route, every tool, plus the edge cases. */
const BASE = "http://localhost:3000";

let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name} — ${detail}`); console.log(`  ✗ ${name}  ${detail}`); }
}

function makeJar() {
  return { cookie: "" };
}

async function call(jar, path, body, method) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(jar.cookie ? { cookie: jar.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) jar.cookie = sc.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json, headers: res.headers };
}

async function agent(jar, query) {
  const res = await fetch(BASE + "/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(jar.cookie ? { cookie: jar.cookie } : {}) },
    body: JSON.stringify({ query }),
  });
  if (!res.ok || !res.body) return { status: res.status, tools: [], panels: [], text: "" };
  const text = await res.text();
  const tools = [], panels = [];
  let said = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "tool_start") tools.push(e.name);
    if (e.type === "panel") panels.push(e.panel);
    if (e.type === "done") said = e.text ?? "";
  }
  return { status: res.status, tools, panels, text: said };
}

const ph = () => "9" + String(Math.floor(Math.random() * 9e8) + 1e8);

// ─────────────────────────────────────────────── AUTH
console.log("\nAUTH");
const jar = makeJar();
const phone = ph();

let r = await call(jar, "/api/auth", { action: "signup", phone: "123", password: "abcdef" });
check("rejects a malformed phone number", r.status === 400, `got ${r.status}`);

r = await call(jar, "/api/auth", { action: "signup", phone, password: "abc" });
check("rejects a short password", r.status === 400, `got ${r.status}`);

r = await call(jar, "/api/auth", {
  action: "signup", phone, password: "relief2026", name: "Test Coordinator",
  role: "coordinator", place: "Kangra",
});
check("signup succeeds", r.status === 200 && r.json?.user?.role === "coordinator", JSON.stringify(r.json)?.slice(0, 80));

r = await call(jar, "/api/auth");
check("session survives across requests", r.json?.user?.phone === phone, JSON.stringify(r.json)?.slice(0, 60));

const jar2 = makeJar();
r = await call(jar2, "/api/auth", { action: "signup", phone, password: "relief2026" });
check("duplicate phone is rejected", r.status === 409, `got ${r.status}`);

r = await call(jar2, "/api/auth", { action: "login", phone, password: "wrongpass" });
check("wrong password is rejected", r.status === 401, `got ${r.status}`);

r = await call(jar2, "/api/auth", { action: "login", phone, password: "relief2026" });
check("login works", r.status === 200 && !!r.json?.user, `got ${r.status}`);

const jar3 = makeJar();
r = await call(jar3, "/api/auth");
check("anonymous request has no user", r.json?.user === null, JSON.stringify(r.json)?.slice(0, 60));

// role escalation attempt
const jarBad = makeJar();
r = await call(jarBad, "/api/auth", {
  action: "signup", phone: ph(), password: "relief2026", role: "superadmin",
});
check("unknown role falls back to citizen", r.json?.user?.role === "citizen", r.json?.user?.role);

// ─────────────────────────────────────────────── SOS
console.log("\nSOS INTAKE");
r = await call(jar, "/api/sos", { message: "" });
check("empty SOS is rejected", r.status === 400, `got ${r.status}`);

r = await call(jar, "/api/sos", { message: "Paani ghar me ghus gaya, chhat pe phase hain", place: "Thrissur" });
const inc1 = r.json?.incidentId;
check("Hinglish SOS is structured", r.json?.parsed?.category === "rescue", JSON.stringify(r.json?.parsed)?.slice(0, 90));
check("locates a district outside the curated set", !!inc1, "no incident id");

r = await call(jar, "/api/sos", { message: "Log chhat par phase hain, madad chahiye", place: "Thrissur" });
check("duplicate report merges", r.json?.incidentId === inc1 && r.json?.merged === true,
  `id=${r.json?.incidentId} merged=${r.json?.merged}`);

r = await call(jar, "/api/sos", { message: "Khana nahi mila do din se", place: "Thrissur" });
check("different category does NOT merge", r.json?.incidentId !== inc1, `id=${r.json?.incidentId}`);

r = await call(jar, "/api/sos", { message: "Help needed urgently", place: "Xyzzyland" });
check("unknown place still records the SOS", r.status === 200 && !!r.json?.incidentId, `got ${r.status}`);

const jarAnon = makeJar();
r = await call(jarAnon, "/api/sos", { message: "Trapped on roof, water rising", place: "Patna" });
check("anonymous SOS is accepted", r.status === 200 && !!r.json?.incidentId, `got ${r.status}`);

// ───────────────────────────────────────── ALERT WORDING PROVENANCE
//
// Which regions have a live official alert changes hour to hour, so these
// assert the invariant rather than today's weather: a staged alert must always
// say where its wording came from, and it must never present our own drafted
// line while citing an authority's CAP identifier as the basis.
console.log("\nALERT WORDING PROVENANCE");
{
  const OUR_DRAFT = /^Heavy rainfall warning for /;
  const KNOWN = [
    /^dictated by the coordinator$/,
    /^official wording from .+/,
    /^drafted by BhimShila — no official wording available/,
  ];

  for (const region of ["Kerala", "Kangra", "Assam"]) {
    const res = await agent(jar, `${region} ko alert bhejo`);
    const panel = res.panels.find((p) => p.panel === "confirm_action");
    if (!panel) {
      // A region under a withdrawn or exercise alert is refused outright, which
      // is a pass for the gate rather than a missing panel.
      const note = res.panels.find((p) => p.panel === "note");
      check(`${region}: refused with a stated reason`, !!note, JSON.stringify(res.panels)?.slice(0, 80));
      continue;
    }
    const line = (label) => panel.lines.find((l) => l.label === label)?.value ?? "";
    const wording = line("Wording");
    const message = line("Message");
    const evidence = line("Evidence");

    check(`${region}: states where the wording came from`, KNOWN.some((k) => k.test(wording)), wording);
    check(
      `${region}: does not claim official wording while using our draft`,
      !(wording.startsWith("official wording") && OUR_DRAFT.test(message)),
      `${wording} / ${message.slice(0, 50)}`,
    );
    check(
      `${region}: our own draft is never attributed to an authority`,
      !(OUR_DRAFT.test(message) && /CAP \d/.test(evidence)),
      `${message.slice(0, 40)} / ${evidence.slice(0, 60)}`,
    );
  }
}

// ───────────────────────────────────────── WHAT GETS SPOKEN
//
// Everything here is read aloud. Two real failures are pinned: a model that
// emitted `<function=preparealert><parameter=region>` as prose, which the
// synthesiser read as angle brackets; and a per-token trim that stripped the
// space between every word, so the answer arrived as
// "Himachalke9registereduserskeliye".
console.log("\nSPOKEN OUTPUT IS SPEAKABLE");
{
  for (const q of ["Himachal ke logon ko alert bhej do", "abhi kya chal raha hai"]) {
    const res = await agent(jar, q);
    const said = res.text ?? "";
    check(`"${q.slice(0, 34)}" says something`, said.trim().length > 10, said.slice(0, 60));
    check(
      `"${q.slice(0, 34)}" has no tool syntax`,
      !/[<>]|function\s*=|parameter\s*=/.test(said),
      said.slice(0, 80),
    );
    check(
      `"${q.slice(0, 34)}" has word spacing`,
      !/[a-z]{28,}/.test(said.replace(/\s+/g, " ")),
      said.slice(0, 80),
    );
    check(
      `"${q.slice(0, 34)}" has no markdown`,
      !/[*_`#]/.test(said),
      said.slice(0, 60),
    );
  }
}

// ─────────────────────────────────────────────── OPS
console.log("\nOPS + CONFIRM GATE");
r = await call(jar, "/api/ops");
check("ops returns stats", typeof r.json?.stats?.available === "number",
  `${r.status} ${JSON.stringify(r.json?.stats ?? r.json)?.slice(0, 70)}`);

// Counted as a delta, not an absolute: the point is that staging adds nothing,
// which must hold on a database that already has history.
const alertsBefore = (await call(jar, "/api/ops")).json?.alerts?.length ?? 0;
const st = await call(jar, "/api/ops", { action: "prepare_alert", region: "Kangra", message: "Test", level: "warning" });
check("prepare_alert stages without sending", st.json?.pending === true, JSON.stringify(st.json)?.slice(0, 70));

let alerts = (await call(jar, "/api/ops")).json?.alerts?.length ?? 0;
check("staging alone sends nothing", alerts === alertsBefore, `${alertsBefore} → ${alerts}`);

r = await call(jar, "/api/ops", { action: "confirm", actionId: st.json.actionId });
check("confirm delivers", r.json?.confirmed === true && Array.isArray(r.json?.delivery), JSON.stringify(r.json)?.slice(0, 90));
// The rule is not "only in_app" — Telegram genuinely delivers once a recipient
// has linked it, and this assertion was written before that was possible. What
// must always hold is that a channel is only claimed when it actually carried
// the message. Saying an alert went out by SMS when no SMS left the building is
// the one lie this product cannot afford.
{
  const claimed = r.json?.channels ?? [];
  const delivery = r.json?.delivery ?? [];
  const reallyDelivered = delivery.filter((d) => d.delivered > 0).map((d) => d.channel);
  check(
    "every claimed channel actually delivered",
    claimed.every((c) => reallyDelivered.includes(c)),
    `claimed ${JSON.stringify(claimed)} vs delivered ${JSON.stringify(reallyDelivered)}`,
  );
  check(
    "no channel that delivered is left unclaimed",
    reallyDelivered.every((c) => claimed.includes(c)),
    `delivered ${JSON.stringify(reallyDelivered)} vs claimed ${JSON.stringify(claimed)}`,
  );
  check(
    "an unconfigured channel says why rather than failing silently",
    delivery.filter((d) => d.delivered === 0 && d.failed === 0).every((d) => !!d.unavailable),
    JSON.stringify(delivery.filter((d) => !d.delivered && !d.failed && !d.unavailable)),
  );
}

r = await call(jar, "/api/ops", { action: "confirm", actionId: st.json.actionId });
check("a confirmed action cannot be replayed", r.status === 410, `got ${r.status}`);

const st2 = await call(jar, "/api/ops", { action: "prepare_dispatch", incidentId: inc1 });
r = await call(jar, "/api/ops", { action: "cancel", actionId: st2.json.actionId });
check("cancel works", r.json?.cancelled === true, JSON.stringify(r.json)?.slice(0, 60));
r = await call(jar, "/api/ops", { action: "confirm", actionId: st2.json.actionId });
check("a cancelled action cannot be confirmed", r.status === 410, `got ${r.status}`);

r = await call(jar, "/api/ops", { action: "confirm", actionId: 999999 });
check("an unknown actionId is rejected", r.status === 410, `got ${r.status}`);

const st3 = await call(jar, "/api/ops", { action: "prepare_dispatch", incidentId: inc1 });
r = await call(jar, "/api/ops", { action: "confirm", actionId: st3.json.actionId });
check("dispatch assigns a team", !!r.json?.teamName, JSON.stringify(r.json)?.slice(0, 80));
const distance = r.json?.distanceKm;
check("dispatch picks a plausible distance", distance !== null && distance < 400, `${distance} km`);

r = await call(jar, "/api/ops", { action: "resolve", incidentId: inc1, outcome: "rescued" });
check("resolve closes and releases", r.json?.resolved === inc1 && r.json?.teamReleased === true, JSON.stringify(r.json)?.slice(0, 70));

r = await call(jar, "/api/ops", { action: "resolve", incidentId: 999999 });
check("resolving a missing incident 404s", r.status === 404, `got ${r.status}`);

r = await call(jar, "/api/inbox");
check("inbox shows the delivered alert", (r.json?.alerts?.length ?? 0) > 0, `${r.json?.alerts?.length} alerts`);
r = await call(jarAnon, "/api/inbox");
check("anonymous inbox is empty", (r.json?.alerts?.length ?? 0) === 0, `${r.json?.alerts?.length}`);

// ─────────────────────────────────────────────── OVERVIEW + TTS
console.log("\nFEEDS");
r = await call(jar, "/api/overview");
// Not pinned to a magic count. The district set legitimately changes — 34
// state-level rows were removed from it and two missing districts added — and a
// hardcoded 757 turns that into a failure. What must hold is national coverage.
const scanned = r.json?.scanned ?? 0;
if (scanned === 0) {
  // Distinguish our bug from Open-Meteo throttling us, which is a normal
  // condition and not something this suite should report as broken code.
  check("national scan reached Open-Meteo", false, "scanned=0 — upstream may be rate-limiting");
} else {
  check(`national scan covers the country (${scanned} districts)`, scanned > 700, `scanned=${scanned}`);
}
check("markers are inside India", (r.json?.markers ?? []).every((m) => m.lat > 6 && m.lat < 38 && m.lng > 67 && m.lng < 98),
  "a marker fell outside the box");
check("news feed returns items", (r.json?.news?.length ?? 0) > 0, `${r.json?.news?.length} items`);

const tts = await fetch(BASE + "/api/tts", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Kerala mein risk high hai", lang: "hi-IN" }),
});
// Two honest outcomes, and both pass: audio comes back, or the route says
// which providers it tried and why each declined. Asserting only the first
// makes an exhausted free tier look like a code failure — and every provider
// here is a free tier, so that check goes red on a schedule nobody controls.
// What must always hold is that a refusal is diagnosable and the client can
// fall back, which is what the header is for.
const ttsType = tts.headers.get("content-type") ?? "";
const ttsTried = tts.headers.get("x-tts-tried") ?? "";
check("TTS returns audio, or names every provider it tried",
  (tts.status === 200 && ttsType.startsWith("audio")) || (tts.status === 204 && ttsTried.includes(":")),
  `${tts.status} ${ttsType} tried=${ttsTried}`);
check("a refused TTS is silent, not a broken response",
  tts.status === 200 || tts.status === 204, String(tts.status));

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("\nFAILURES");
  for (const f of failures) console.log("  •", f);
}
// Exit non-zero, or the runner counts a suite with red checks as a pass — the
// exact thing run.mjs's own header says must never happen. This suite reported
// "53 passed, 1 failed" and still exited 0, so the battery said 13/13.
process.exit(failures.length ? 1 : 0);
