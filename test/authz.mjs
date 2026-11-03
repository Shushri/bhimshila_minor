const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
const check = (n, ok, d="") => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`)); };
const jar = () => ({ cookie: "" });
async function call(j, path, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(j.cookie ? { cookie: j.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie"); if (sc) j.cookie = sc.split(";")[0];
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const ph = () => "9" + String(Math.floor(Math.random()*9e8)+1e8);

console.log("\nAUTHORIZATION ON WRITE PATHS");
const anon = jar();
let r = await call(anon, "/api/ops", { action: "prepare_alert", region: "Kangra", message: "x", level: "severe" });
check("anonymous cannot even stage an alert", r.status === 401, `got ${r.status}`);
r = await call(anon, "/api/ops", { action: "prepare_dispatch", incidentId: 1 });
check("anonymous cannot stage a dispatch", r.status === 401, `got ${r.status}`);
r = await call(anon, "/api/ops", { action: "resolve", incidentId: 1 });
check("anonymous cannot resolve", r.status === 401, `got ${r.status}`);

const cit = jar();
await call(cit, "/api/auth", { action: "signup", phone: ph(), password: "relief2026", name: "Cit", role: "citizen", place: "Kangra" });
r = await call(cit, "/api/ops", { action: "prepare_alert", region: "Kangra", message: "x", level: "severe" });
check("a citizen cannot broadcast", r.status === 403, `got ${r.status}`);
r = await call(cit, "/api/ops", { action: "prepare_dispatch", incidentId: 1 });
check("a citizen cannot dispatch", r.status === 403, `got ${r.status}`);
r = await call(cit, "/api/sos", { message: "Chhat pe phanse hain, paani badh raha hai", place: "Kangra" });
check("a citizen CAN still raise an SOS", r.status === 200 && !!r.json?.incidentId, `got ${r.status}`);
const incId = r.json?.incidentId;

const anonSos = await call(jar(), "/api/sos", { message: "Trapped, water rising", place: "Patna" });
check("an anonymous person CAN raise an SOS", anonSos.status === 200, `got ${anonSos.status}`);

const co = jar();
await call(co, "/api/auth", { action: "signup", phone: ph(), password: "relief2026", name: "Coord", role: "coordinator", place: "Kangra" });
r = await call(co, "/api/ops", { action: "prepare_alert", region: "Kangra", message: "Nadi ke paas mat jaayein", level: "severe" });
check("a coordinator can stage", r.json?.pending === true, JSON.stringify(r.json)?.slice(0,60));
const staged = r.json.actionId;

const co2 = jar();
await call(co2, "/api/auth", { action: "signup", phone: ph(), password: "relief2026", name: "Coord2", role: "coordinator", place: "Shimla" });
r = await call(co2, "/api/ops", { action: "confirm", actionId: staged });
check("another coordinator cannot confirm someone else's action", r.status === 403, `got ${r.status}`);

r = await call(co, "/api/ops", { action: "confirm", actionId: staged });
check("the staging coordinator can confirm", r.json?.confirmed === true, JSON.stringify(r.json)?.slice(0,60));

r = await call(co, "/api/ops", { action: "resolve", incidentId: incId });
check("a coordinator can resolve", r.json?.resolved === incId, JSON.stringify(r.json)?.slice(0,60));

console.log(`\n${pass} passed, ${fail} failed`);
// Without this the runner reads a suite with red checks as a pass.
process.exit(fail ? 1 : 0);
