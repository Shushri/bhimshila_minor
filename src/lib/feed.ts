import { fetchOfficialAlerts, type OfficialAlert } from "./kb/sachet";
import { exposureFor } from "./kb/exposure";
import { scanNation, type DistrictSignal } from "./kb/national";
import { listIncidents } from "./ops";
import { hazardKind } from "./kb/sachet";

/**
 * One stream, every source, ranked — the spine of the dashboard.
 *
 * Until now this intelligence only existed inside the agent's tools, which
 * meant you had to ask a question to get it. A coordinator watching a screen
 * should not have to ask. Everything the system knows is merged here and
 * ranked once, so the dashboard renders from a single ordered list rather than
 * stitching four endpoints together in the browser.
 *
 * Three sources, and the distinction between them is the point:
 *
 *   official   An authority has issued this. Not our judgement.
 *   model      Our own scan is elevated where nobody has issued anything.
 *              This is the only row type that is genuinely ours, and it is
 *              labelled as a lead to verify, never as a warning.
 *   incident   A person asked for help.
 */

export type FeedSource = "official" | "model" | "incident";
export type Severity = "red" | "orange" | "yellow" | "info";

/**
 * How an official alert and our own reading line up.
 *
 * Reported per row because the disagreements are the interesting part — a
 * district where we see something and nobody has warned is a lead; one where an
 * authority has warned and we see nothing means they have radar we do not.
 */
export type Verification = "confirmed" | "official_only" | "model_only" | "reported";

export interface FeedItem {
  id: string;
  source: FeedSource;
  severity: Severity;
  /** Hazard family — drives the glyph. */
  kind: string;
  title: string;
  place: string;
  state: string;
  lat: number | null;
  lng: number | null;
  /** People under it. Null when we genuinely cannot say. */
  people: number | null;
  /** Who says so — an authority by name, or us. */
  issuer: string;
  at: string | null;
  until: string | null;
  verification: Verification;
  /** Short lines a human can read to decide whether to trust this. */
  evidence: string[];
  /** What a coordinator can do about it from here. */
  actions: ("alert" | "dispatch" | "resolve" | "verify")[];
}

const COLOUR_RANK: Record<Severity, number> = { red: 3, orange: 2, yellow: 1, info: 0 };

/** Severity from our 0–100 score. Deliberately conservative at the top. */
function severityOfScore(score: number): Severity {
  if (score >= 70) return "orange";
  if (score >= 50) return "yellow";
  return "info";
}

const km = (m: number) => Math.round(m / 100) / 10;

/**
 * Where our own scan counts as agreeing with an authority.
 *
 * 28, the same line the rest of the system draws, and not the 50 this started
 * with: nationally 85 districts sit above 28 and one sits above 50, so a
 * threshold of 50 meant "confirmed" essentially never fired and every official
 * alert was reported as unconfirmed. The Khaniyara cloudburst that killed
 * people scored 37.
 */
const AGREEMENT_SCORE = 28;

function officialRow(a: OfficialAlert, nearbyModel: DistrictSignal | null): FeedItem {
  const exposure = exposureFor(a);
  const modelAgrees = (nearbyModel?.score ?? 0) >= AGREEMENT_SCORE;

  return {
    id: `cap:${a.id}`,
    source: "official",
    severity: a.colour === "green" ? "info" : a.colour,
    kind: hazardKind(a.disasterType),
    title: a.disasterType,
    place: a.areaDescription || a.disasterType,
    // The nearest scanned district names the state. Falling back to the
    // exposure calculation matters because filtering by state is the first
    // thing a coordinator does, and a blank state is invisible to it.
    state: nearbyModel?.state ?? exposure.districts[0]?.state ?? "",
    lat: a.lat,
    lng: a.lng,
    people: exposure.people || null,
    issuer: a.source,
    at: a.startsAt,
    until: a.endsAt,
    verification: modelAgrees ? "confirmed" : "official_only",
    evidence: [
      `Issued by ${a.source}${a.endsAt ? `, in force until ${new Date(a.endsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} IST` : ""}`,
      exposure.basis,
      modelAgrees
        ? `Our rainfall scan agrees — ${nearbyModel!.district} at ${nearbyModel!.score}/100`
        : "Our own rainfall signal is quiet here. Go with the issuing authority — they see radar and river gauges we do not.",
    ],
    // Dispatch belongs here, not only on incidents. An official alert arrives
    // before anyone calls, and being unable to pre-position a team against one
    // is the gap this product exists to close. It opens an incident for the
    // place, clearly marked as anticipatory rather than reported.
    actions: a.lat !== null && a.lng !== null ? ["alert", "dispatch", "verify"] : ["alert", "verify"],
  };
}

function modelRow(d: DistrictSignal): FeedItem {
  return {
    id: `scan:${d.state}:${d.district}`,
    source: "model",
    severity: severityOfScore(d.score),
    kind: "rain",
    title: `Elevated flash-flood exposure — ${d.score}/100`,
    place: d.district,
    state: d.state,
    lat: d.lat,
    lng: d.lng,
    people: null,
    issuer: "BhimShila rainfall scan",
    at: null,
    until: null,
    verification: "model_only",
    evidence: [
      `${d.antecedent72h}mm fell in the past 72 hours, ${d.next24h}mm forecast in the next 24.`,
      `Peak intensity ${d.peak}mm/h${d.elevationM !== null ? `, elevation ${d.elevationM}m` : ""}.`,
      "No authority has issued a warning here. This is a lead to verify, not a warning.",
    ],
    actions: ["verify", "dispatch"],
  };
}

interface IncidentRow {
  id: number;
  title: string;
  category: string;
  place: string | null;
  severity: number;
  priority: number;
  reportCount: number;
  peopleCount: number | null;
  status: string;
  assignedTeam: string | null;
  reasons: string[];
  lat?: number | null;
  lng?: number | null;
}

function incidentRow(i: IncidentRow): FeedItem {
  return {
    id: `inc:${i.id}`,
    source: "incident",
    severity: i.severity >= 5 ? "red" : i.severity >= 4 ? "orange" : "yellow",
    kind: i.category === "medical" ? "alert" : i.category === "rescue" ? "flood" : "alert",
    title: i.title,
    place: i.place ?? "location unknown",
    state: "",
    lat: i.lat ?? null,
    lng: i.lng ?? null,
    people: i.peopleCount,
    issuer: i.reportCount > 1 ? `${i.reportCount} citizen reports` : "Citizen SOS",
    at: null,
    until: null,
    verification: "reported",
    evidence: [
      `${i.category.replace("_", " ")}, severity ${i.severity} of 5, priority ${i.priority}.`,
      ...i.reasons,
      i.assignedTeam ? `Assigned to ${i.assignedTeam}.` : "Not yet assigned to a team.",
    ],
    actions: i.status === "resolved" ? [] : i.assignedTeam ? ["resolve"] : ["dispatch"],
  };
}

export interface Feed {
  items: FeedItem[];
  stats: {
    official: number;
    red: number;
    orange: number;
    modelOnly: number;
    incidents: number;
    unassigned: number;
    peopleCovered: number;
    districtsScanned: number;
    districtsElevated: number;
  };
  /** False when NDMA is unreachable — never rendered as "no alerts". */
  officialReachable: boolean;
  at: string;
}

/**
 * Build the whole picture.
 *
 * The three sources are fetched together and a failure in any one degrades that
 * section rather than the page — an unreachable NDMA is reported as unreachable,
 * which is a different thing from all-clear and must never look like it.
 */
export async function buildFeed(): Promise<Feed> {
  const [officialSettled, scanSettled, incidentSettled] = await Promise.allSettled([
    fetchOfficialAlerts(),
    scanNation(),
    listIncidents(),
  ]);

  const official = officialSettled.status === "fulfilled" ? officialSettled.value : [];
  const scan = scanSettled.status === "fulfilled" ? scanSettled.value : [];
  const incidents = (incidentSettled.status === "fulfilled" ? incidentSettled.value : []) as IncidentRow[];

  // Nearest scanned district to each alert, so an official row can say whether
  // our own reading agrees with it.
  const nearestTo = (lat: number, lng: number): DistrictSignal | null => {
    let best: DistrictSignal | null = null;
    let bestGap = Infinity;
    for (const d of scan) {
      const gap = (d.lat - lat) ** 2 + (d.lng - lng) ** 2;
      if (gap < bestGap) {
        bestGap = gap;
        best = d;
      }
    }
    // Roughly a degree — beyond that "nearest" stops meaning anything.
    return bestGap < 1 ? best : null;
  };

  const officialItems = official.map((a) => officialRow(a, nearestTo(a.lat, a.lng)));

  // Only districts we flagged where no authority has. Where one has, the
  // official row already carries our agreement and a second row would be the
  // same event listed twice.
  const covered = new Set(
    officialItems.flatMap((o) =>
      o.state && o.place ? [`${o.state}|${o.place}`.toLowerCase()] : [],
    ),
  );
  const modelItems = scan
    .filter((d) => d.score >= 50)
    .filter((d) => {
      const near = officialItems.some(
        (o) =>
          o.lat !== null &&
          o.lng !== null &&
          (o.lat - d.lat) ** 2 + (o.lng - d.lng) ** 2 < 0.5,
      );
      return !near && !covered.has(`${d.state}|${d.district}`.toLowerCase());
    })
    .map(modelRow);

  const incidentItems = incidents.map(incidentRow);

  // One order for the whole board: a person asking for help outranks a warning
  // about people who might need it, then severity, then how many are under it.
  const items = [...incidentItems, ...officialItems, ...modelItems].sort((a, b) => {
    if (a.source === "incident" && b.source !== "incident") return -1;
    if (b.source === "incident" && a.source !== "incident") return 1;
    return COLOUR_RANK[b.severity] - COLOUR_RANK[a.severity] || (b.people ?? 0) - (a.people ?? 0);
  });

  // Distinct people, not the sum — a district under three alerts is one
  // district of people.
  const peopleByPlace = new Map<string, number>();
  for (const o of officialItems) {
    for (const d of exposureFor(official.find((x) => `cap:${x.id}` === o.id)!).districts) {
      const key = `${d.name}|${d.state}`;
      peopleByPlace.set(key, Math.max(peopleByPlace.get(key) ?? 0, d.population));
    }
  }

  return {
    items,
    stats: {
      official: officialItems.length,
      red: officialItems.filter((i) => i.severity === "red").length,
      orange: officialItems.filter((i) => i.severity === "orange").length,
      modelOnly: modelItems.length,
      incidents: incidentItems.length,
      unassigned: incidentItems.filter((i) => i.actions.includes("dispatch")).length,
      peopleCovered: [...peopleByPlace.values()].reduce((a, b) => a + b, 0),
      districtsScanned: scan.length,
      districtsElevated: scan.filter((d) => d.score >= 28).length,
    },
    officialReachable: official.length > 0,
    at: new Date().toISOString(),
  };
}

export { km };
