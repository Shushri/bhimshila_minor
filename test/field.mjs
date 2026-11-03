/**
 * The field layer: mission chat, ground reports, the broadcast gate,
 * subscriptions and the notification centre — plus the staged-preview
 * contract on /api/ops and the state drill-down endpoint.
 *
 * The checks that matter most are again the boundaries. A thread, a photo and
 * a warn-people request all belong to one mission, and someone from another
 * org changing an id in the URL must hit a wall. The broadcast checks pin the
 * trust model itself: a volunteer's request sends NOTHING until a coordinator
 * approves it, and what the coordinator approves is exactly what goes out.
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

// A fresh site per run — incidents cluster by 12km/12h, and reusing the world
// is how missions.mjs once produced false boundary failures.
const SITE = { lat: 22 + Math.random() * 5, lng: 85 + Math.random() * 7 };

const coord = jar();
const asha = jar();
const outsider = jar();
const citizen = jar();
await signup(coord, "coordinator", "Guwahati");
await signup(asha, "volunteer", "Dhubri");
await signup(outsider, "volunteer", "Kochi");
await signup(citizen, "citizen", "Dhubri");

// Org at the site, volunteer in it, incident there, task dispatched to it.
let r = await call(coord, "/api/orgs", {
  name: `Field Collective ${Date.now()}`, kind: "ngo",
  place: "Field base", lat: SITE.lat, lng: SITE.lng,
});
const org = r.json?.org;
await call(asha, "/api/orgs/join", { code: org.inviteCode });

const sos = await call(jar(), "/api/sos", {
  message: "Paani ghar me ghus gaya, 4 log phase hain",
  place: "Dhubri",
  lat: SITE.lat,
  lng: SITE.lng,
});
const incidentId = sos.json?.incidentId;

console.log("STAGING SHOWS REAL NUMBERS");
// Pinned to this run's own org — see missions.mjs for why nearest-team
// selection cannot be trusted on a database other runs have populated.
const staged = await call(coord, "/api/ops", { action: "prepare_dispatch", incidentId, teamId: org.id });
check("staging names the team it will send", typeof staged.json?.teamName === "string",
  JSON.stringify(staged.json)?.slice(0, 90));
check("staging states the distance", typeof staged.json?.distanceKm === "number",
  String(staged.json?.distanceKm));
const stagedAlert = await call(coord, "/api/ops", { action: "prepare_alert", region: "Dhubri", level: "warning" });
check("alert staging counts its recipients", typeof stagedAlert.json?.recipients === "number",
  JSON.stringify(stagedAlert.json)?.slice(0, 90));
check("alert staging names its scope", ["state", "district", "literal"].includes(stagedAlert.json?.scope),
  String(stagedAlert.json?.scope));
await call(coord, "/api/ops", { action: "cancel", actionId: stagedAlert.json?.actionId });

const confirmed = await call(coord, "/api/ops", { action: "confirm", actionId: staged.json.actionId });
const taskId = confirmed.json?.taskId;
check("dispatch created the mission", !!taskId, JSON.stringify(confirmed.json)?.slice(0, 90));
check("the dispatched team is the staged team", confirmed.json?.teamName === staged.json?.teamName,
  `staged ${staged.json?.teamName}, sent ${confirmed.json?.teamName}`);

console.log("\nMISSION CHAT");
r = await call(asha, `/api/tasks/${taskId}/messages`, { body: "Pahunch rahi hoon, 20 minute" });
check("a member can post to the thread", r.status === 200 && r.json?.messages?.length === 1,
  JSON.stringify(r.json)?.slice(0, 80));
r = await call(coord, `/api/tasks/${taskId}/messages`, { body: "Boat bhej di hai" });
check("the coordinator posts to the same thread", r.status === 200 && r.json?.messages?.length === 2);
r = await call(asha, `/api/tasks/${taskId}/messages`);
check("the thread reads in order", r.json?.messages?.[0]?.body?.includes("Pahunch"),
  r.json?.messages?.[0]?.body);
check("the reader knows which messages are theirs", typeof r.json?.me === "number");
r = await call(outsider, `/api/tasks/${taskId}/messages`);
check("another org cannot read the thread", r.status === 403, `got ${r.status}`);
r = await call(jar(), `/api/tasks/${taskId}/messages`);
check("anonymous cannot read the thread", r.status === 401, `got ${r.status}`);
r = await call(asha, `/api/tasks/${taskId}/messages`, { body: "   " });
check("an empty message is refused", r.status === 400, `got ${r.status}`);

console.log("\nGROUND REPORTS");
r = await call(asha, `/api/tasks/${taskId}/reports`, { kind: "note", body: "Nala school ke paas overflow kar raha hai" });
check("a note is filed", r.status === 200 && r.json?.reports?.length === 1, JSON.stringify(r.json)?.slice(0, 80));
r = await call(asha, `/api/tasks/${taskId}/reports`, { kind: "note", body: "" });
check("an empty note is refused", r.status === 400, `got ${r.status}`);

// A 1×1 JPEG — enough to exercise the media path end to end.
const dot =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
r = await call(asha, `/api/tasks/${taskId}/reports`, {
  kind: "photo", media: dot, mediaType: "image/jpeg", body: "school ka gate",
  capturedAt: new Date(Date.now() - 3600_000).toISOString(),
});
check("a photo report is filed", r.status === 200, JSON.stringify(r.json)?.slice(0, 80));
const withPhoto = r.json?.reports?.find((x) => x.kind === "photo");
check("the photo comes back through the mission API", withPhoto?.media?.startsWith("data:image/jpeg"),
  withPhoto?.media?.slice(0, 30));
check("field time survives alongside arrival time", !!withPhoto?.capturedAt, String(withPhoto?.capturedAt));

r = await call(asha, `/api/tasks/${taskId}/reports`, {
  kind: "photo", media: "data:text/html;base64,PGI+", mediaType: "text/html",
});
check("a non-image is refused", r.status === 400, `got ${r.status}`);
r = await call(asha, `/api/tasks/${taskId}/reports`, {
  kind: "photo", media: "data:image/jpeg;base64," + "A".repeat(1_200_000), mediaType: "image/jpeg",
});
check("an oversize photo is refused, with a reason", r.status === 400 && /large/i.test(r.json?.error ?? ""),
  `${r.status} ${r.json?.error}`);
r = await call(outsider, `/api/tasks/${taskId}/reports`);
check("another org cannot see the photos", r.status === 403, `got ${r.status}`);

console.log("\nTHE BROADCAST GATE");
const alertsBefore = (await call(coord, "/api/ops")).json.alerts.length;
r = await call(asha, `/api/tasks/${taskId}/broadcast-request`, {
  message: "Nala tez badh raha hai — school ke bagal wale ghar khali karein",
});
check("a volunteer can raise a request", r.status === 200 && r.json?.request?.status === "pending",
  JSON.stringify(r.json)?.slice(0, 80));
const reqId = r.json?.request?.id;
check("nothing was sent by raising it", (await call(coord, "/api/ops")).json.alerts.length === alertsBefore,
  "an alert row appeared without approval");

r = await call(asha, `/api/tasks/${taskId}/broadcast-request`, { message: "dusra request" });
check("a second request while one is pending is refused", r.status === 400, `got ${r.status}`);
r = await call(asha, "/api/broadcast-requests");
check("a volunteer cannot read the coordinator queue", r.status === 403, `got ${r.status}`);
r = await call(asha, "/api/broadcast-requests", { id: reqId, action: "approve" });
check("a volunteer cannot approve their own request", r.status === 403, `got ${r.status}`);

r = await call(coord, "/api/broadcast-requests");
const inQueue = (r.json?.requests ?? []).find((x) => x.id === reqId);
check("the coordinator sees it, wording attached", inQueue?.message?.includes("khali karein"),
  JSON.stringify(inQueue)?.slice(0, 80));
check("the request carries its provenance", !!inQueue?.volunteer && !!inQueue?.org && !!inQueue?.incidentTitle,
  JSON.stringify(inQueue)?.slice(0, 120));

r = await call(coord, "/api/broadcast-requests", { id: reqId, action: "approve" });
check("approval sends it", r.status === 200 && r.json?.status === "approved", JSON.stringify(r.json)?.slice(0, 90));
check("delivery is per-channel truth, never optimistic", Array.isArray(r.json?.delivery), typeof r.json?.delivery);
check("the Dhubri citizen was reached in-app", r.json?.recipients >= 1, String(r.json?.recipients));
r = await call(coord, "/api/broadcast-requests", { id: reqId, action: "approve" });
check("approving twice is refused", r.status === 409, `got ${r.status}`);

console.log("\nSUBSCRIPTIONS");
r = await call(citizen, "/api/subscriptions", { place: "Dhubri", minColour: "orange" });
check("a citizen can watch a place", r.status === 200 && r.json?.subscriptions?.length === 1,
  JSON.stringify(r.json)?.slice(0, 80));
const subId = r.json?.subscriptions?.[0]?.id;
r = await call(citizen, "/api/subscriptions", {});
check("a watch needs a place", r.status === 400, `got ${r.status}`);
r = await call(outsider, `/api/subscriptions?id=${subId}`, null, "DELETE");
r = await call(citizen, "/api/subscriptions");
check("someone else's DELETE cannot remove my watch", r.json?.subscriptions?.length === 1,
  `${r.json?.subscriptions?.length} left`);
r = await call(jar(), "/api/subscriptions");
check("anonymous cannot read watches", r.status === 401, `got ${r.status}`);

console.log("\nNOTIFICATIONS");
r = await call(citizen, "/api/notifications");
check("the delivered broadcast appears in the citizen's stream",
  (r.json?.items ?? []).some((i) => i.kind === "delivery"),
  (r.json?.items ?? []).map((i) => i.kind).join(","));
r = await call(asha, "/api/notifications");
check("the volunteer sees the decision on their request",
  (r.json?.items ?? []).some((i) => i.kind === "decision" && /approved/.test(i.title)),
  (r.json?.items ?? []).map((i) => i.kind).join(","));
r = await call(jar(), "/api/notifications");
check("anonymous gets nothing", r.status === 401, `got ${r.status}`);

console.log("\nTHE STATE DRILL-DOWN ENDPOINT");
r = await call(jar(), "/api/state/Kerala");
check("a state resolves", r.status === 200 && r.json?.state?.name === "Kerala",
  `${r.status} ${r.json?.state?.name}`);
check("every layer answers or says why not",
  ["alerts", "risk", "forecast", "anomaly", "news", "population", "deployments", "rivers"].every((k) => k in (r.json ?? {})),
  Object.keys(r.json ?? {}).join(","));
check("river discharge answers with rows or an honest error",
  "error" in (r.json?.rivers ?? {}) ||
    (Array.isArray(r.json?.rivers?.rows) && typeof r.json?.rivers?.headline === "string"),
  JSON.stringify(r.json?.rivers)?.slice(0, 80));
check("deployments carry distance from the state", "error" in (r.json?.deployments ?? {}) ||
  typeof r.json?.deployments?.[0]?.distanceKm === "number", JSON.stringify(r.json?.deployments)?.slice(0, 60));
r = await call(jar(), "/api/state/Orissa");
check("a pre-rename name still lands (Orissa → Odisha)", r.status === 200 && r.json?.state?.name === "Odisha",
  `${r.status} ${r.json?.state?.name}`);
r = await call(jar(), "/api/state/Narnia");
check("an unknown state is a 404, not a guess", r.status === 404, `got ${r.status}`);

console.log("\nARCHIVE, FATIGUE, GAPS AND THE HANDOVER");
// The four-event replay catalogue is gone; the archive answers for any place
// and any date since 1940 instead. Checked through the agent because that is
// the only way in now — there is no dedicated endpoint to probe.
//
// Two honest outcomes and both pass: it reports what fell, or it says the
// archive did not answer. What is never acceptable is silence, or a score
// presented without its ceiling — an archive holds what actually fell, not
// the forecast anyone had at the time, and the answer has to say so.
{
  const res = await fetch(BASE + "/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "what happened at Kedarnath on 2013-06-16" }),
  });
  const text = await res.text();
  const events = text.split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const tools = events.filter((e) => e.type === "tool_start").map((e) => e.name);
  const said = events.find((e) => e.type === "done")?.text ?? "";
  const panel = events.find((e) => e.type === "panel")?.panel;

  check("a historical question reaches the archive tool", tools.includes("past_weather"),
    tools.join(",") || "no tool called");
  check("it answers rather than going silent", said.trim().length > 20, said.slice(0, 70));

  const archiveDown = /archive (is unreachable|did not answer)/i.test(said);
  check("a named place the census does not carry still resolves",
    archiveDown || !/no place in india matches/i.test(said), said.slice(0, 80));
  check("the panel carries the rainfall series",
    archiveDown || !panel || (panel.points ?? []).length > 0,
    `${(panel?.points ?? []).length} points`);
}

r = await call(coord, "/api/ops");
check("ops carries the fatigue ledger and coverage gaps",
  Array.isArray(r.json?.fatigue) && Array.isArray(r.json?.gaps),
  Object.keys(r.json ?? {}).join(","));
check("a fatigue row is warnings-with-no-incidents by construction",
  (r.json?.fatigue ?? []).every((f) => f.incidents === 0 && f.alerts >= 5),
  JSON.stringify(r.json?.fatigue?.[0]));

r = await call(coord, "/api/handover");
check("a coordinator gets the handover, facts attached",
  r.status === 200 && typeof r.json?.brief === "string" && r.json?.brief.length > 50 && !!r.json?.facts,
  `${r.status} · ${r.json?.brief?.length} chars`);
check("the handover counted this run's own dispatch",
  (r.json?.facts?.dispatches ?? []).length >= 1, `${(r.json?.facts?.dispatches ?? []).length} dispatches`);
r = await call(asha, "/api/handover");
check("a volunteer cannot pull the handover", r.status === 403, `got ${r.status}`);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES");
  for (const f of failures) console.log("  •", f);
}
process.exit(failures.length ? 1 : 0);
