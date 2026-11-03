/**
 * Organisations, membership, and the deployment log.
 *
 * This is the organizers' Track B deliverable — "who is deployed, where, when"
 * — and the half that made the three roles mean anything. Before it, `teams`
 * held seeded rows with nobody inside them, and a volunteer account could do
 * nothing a citizen could not.
 *
 * The checks that matter most are the boundaries. A volunteer in one NGO must
 * not be able to touch another's missions by changing an id, and the offline
 * queue replays transitions, so a repeated action must not move a task
 * backwards or read as an error.
 */
const BASE = "http://localhost:3000";

let pass = 0;
const failures = [];
const check = (n, ok, d = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    failures.push(`${n} — ${d}`);
    console.log(`  ✗ ${n}  ${d}`);
  }
};

const jar = () => ({ cookie: "" });
async function call(j, path, body, method) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(j.cookie ? { cookie: j.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) j.cookie = sc.split(";")[0];
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}
const ph = () => "9" + String(Math.floor(Math.random() * 9e8) + 1e8);

async function signup(j, role, place) {
  return call(j, "/api/auth", {
    action: "signup", phone: ph(), password: "relief2026",
    name: `${role} ${Math.floor(Math.random() * 999)}`, role, place,
  });
}

/**
 * A fresh location per run.
 *
 * Incidents cluster by category, 12km and 12 hours — which is correct
 * behaviour and made this suite fail on a second run: the SOS merged into the
 * previous run's incident, which was already dispatched to that run's
 * organisation, and every later check reported "belongs to another
 * organisation". The boundary was working; the fixture was reusing the world.
 *
 * Somewhere in eastern India, far enough apart that two runs never cluster.
 */
const SITE = {
  lat: 22 + Math.random() * 5,
  lng: 85 + Math.random() * 7,
};

const coord = jar();
const asha = jar();
const outsider = jar();
await signup(coord, "coordinator", "Guwahati");
await signup(asha, "volunteer", "Dhubri");
await signup(outsider, "volunteer", "Kochi");

console.log("REGISTERING AN ORGANISATION");
let r = await call(coord, "/api/orgs", {
  name: `Relief Collective ${Date.now()}`, kind: "ngo",
  place: "Field base", lat: SITE.lat, lng: SITE.lng, capacity: 25,
});
const org = r.json?.org;
check("a coordinator can register one", r.status === 200 && !!org?.id, JSON.stringify(r.json)?.slice(0, 80));
check("the registrant becomes its lead", !!org?.inviteCode, "no invite code returned to the creator");
check("it starts with exactly one member", org?.memberCount === 1, String(org?.memberCount));

r = await call(asha, "/api/orgs", { name: "X", place: "Y", lat: 1, lng: 1 });
check("a volunteer cannot register one", r.status === 403, `got ${r.status}`);

console.log("\nINVITES");
r = await call(asha, "/api/orgs/join", { code: org.inviteCode });
check("a volunteer joins with the code", r.status === 200 && r.json?.org?.id === org.id);
check("the roster grows", r.json?.org?.memberCount === 2, String(r.json?.org?.memberCount));

r = await call(asha, "/api/orgs/join", { code: org.inviteCode });
check("joining twice is a no-op, not an error", r.status === 200, `got ${r.status}`);

r = await call(outsider, "/api/orgs/join", { code: "deadbeef" });
check("a bad code is refused", r.status === 404, `got ${r.status}`);

// The invite code is the credential. Anyone who can read it can join, so it
// must not be handed to people outside the org.
r = await call(outsider, "/api/orgs");
const seen = (r.json?.orgs ?? []).find((o) => o.id === org.id);
check("an outsider never sees the invite code", !seen?.inviteCode, JSON.stringify(seen)?.slice(0, 70));

r = await call(outsider, `/api/orgs?id=${org.id}`);
check("an outsider cannot read the roster", r.status === 403, `got ${r.status}`);

console.log("\nDISPATCH CREATES A TASK");
// Dispatch the incident this run created, not whichever one happens to be open.
// Picking any open incident made this pass only on a fresh database: on a used
// one it grabbed an older incident somewhere else in the country, dispatch sent
// the nearest team to *that*, and every later check failed with "belongs to
// another organisation" — which was the suite lying about a boundary that was
// working correctly.
const sos = await call(jar(), "/api/sos", {
  message: "Chhat pe phase hain, paani badh raha hai, 6 log",
  place: "Field base",
  lat: SITE.lat,
  lng: SITE.lng,
});
const incidentId = sos.json?.incidentId;
check("the SOS opened a fresh incident", !!incidentId && !sos.json?.merged,
  `id=${incidentId} merged=${sos.json?.merged}`);

// The team is pinned explicitly rather than left to nearest-team. Sitting the
// org on the incident's coordinates was enough until the test database
// accumulated other runs' orgs in the same random box — two sites landing
// close together let a stale org win the distance race, and every boundary
// check downstream reported a violation that never happened. Nearest-team
// selection has its own check in testall; this suite is about membership.
const staged = await call(coord, "/api/ops", { action: "prepare_dispatch", incidentId, teamId: org.id });
const confirmed = await call(coord, "/api/ops", { action: "confirm", actionId: staged.json.actionId });
check("dispatch creates a task", !!confirmed.json?.taskId, JSON.stringify(confirmed.json)?.slice(0, 90));
const taskId = confirmed.json.taskId;

console.log("\nWHAT EACH PERSON CAN SEE");
r = await call(asha, "/api/missions");
check("a member sees their org's task", (r.json?.tasks ?? []).some((t) => t.id === taskId),
  `${(r.json?.tasks ?? []).length} tasks`);
check("scope is reported as member", r.json?.scope === "member", r.json?.scope);

r = await call(outsider, "/api/missions");
check("someone in no org sees nothing", (r.json?.tasks ?? []).length === 0,
  `${(r.json?.tasks ?? []).length} tasks leaked`);

r = await call(coord, "/api/missions");
check("a coordinator sees everything", r.json?.scope === "all" && (r.json?.tasks ?? []).length > 0);

console.log("\nTHE THREE BUTTONS");
for (const [to, label] of [["accepted", "Accept"], ["on_site", "I'm on site"], ["done", "Done"]]) {
  r = await call(asha, `/api/tasks/${taskId}/advance`, {
    to, outcome: to === "done" ? "6 rescued, moved to the school" : undefined,
  });
  check(`${label} → ${to}`, r.status === 200 && r.json?.task?.status === to,
    r.json?.error ?? r.json?.task?.status);
}
check("the volunteer's name is on it", (await call(asha, "/api/missions")).json.tasks
  .find((t) => t.id === taskId)?.assigneeName !== null);

console.log("\nTHE LOG IS THE DELIVERABLE");
const t = (await call(asha, "/api/missions")).json.tasks.find((x) => x.id === taskId);
check("accepted is timestamped", !!t?.acceptedAt, String(t?.acceptedAt));
check("on site is timestamped", !!t?.onSiteAt, String(t?.onSiteAt));
check("done is timestamped", !!t?.doneAt, String(t?.doneAt));
check("the outcome is kept", t?.outcome?.includes("rescued"), String(t?.outcome));

console.log("\nCLOSING THE LAST TASK CLOSES THE INCIDENT");
const after = await call(coord, "/api/ops");
const stillOpen = after.json.incidents.find((i) => i.id === incidentId);
check("the incident is no longer open", !stillOpen || stillOpen.status === "resolved",
  stillOpen?.status);
const team = after.json.teams.find((x) => x.id === confirmed.json.teamId);
check("the team is released", team?.status === "available", team?.status);

console.log("\nOFFLINE REPLAY AND BOUNDARIES");
// The queue replays transitions when the network returns, so the same action
// legitimately arrives twice. The volunteer did the right thing.
r = await call(asha, `/api/tasks/${taskId}/advance`, { to: "done" });
check("replaying a landed transition succeeds", r.status === 200, `got ${r.status}`);

r = await call(asha, `/api/tasks/${taskId}/advance`, { to: "accepted" });
check("a task cannot be dragged backwards", r.status === 409, `got ${r.status}`);

r = await call(outsider, `/api/tasks/${taskId}/advance`, { to: "accepted" });
check("another org cannot touch it", r.status === 403, `got ${r.status}`);

r = await call(jar(), `/api/tasks/${taskId}/advance`, { to: "accepted" });
check("an anonymous request cannot touch it", r.status === 401, `got ${r.status}`);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES");
  for (const f of failures) console.log("  •", f);
}
process.exit(failures.length ? 1 : 0);
