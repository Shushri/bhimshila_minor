import {
  findRegion,
  findLocality,
  getRegion,
  childrenOf,
  localitiesOf,
  rankRegions,
  metricLabel,
  metricOf,
  STATES,
  type Metric,
} from "@/lib/kb/regions";
import {
  getRainfall,
  nearestWaterway,
  nearbyShelters,
  SHELTER_SOURCE,
} from "@/lib/kb/live";
import { scanNation, byState } from "@/lib/kb/national";
import { historyFor } from "@/lib/kb/history";
import { listCamps, teamStocks, alertReach, duplicateCoverage } from "@/lib/campsDb";
import { campsHeadline, supplierFor } from "@/lib/camps";
import { fetchNews, newsForPlace, fetchQuakes, isDisasterRelated } from "@/lib/kb/feeds";
import {
  fetchOfficialAlerts,
  alertsNear,
  alertsMentioning,
  crossCheck,
  colourMeaning,
  hazardKind,
  fetchCapDocument,
  actionable,
  type OfficialAlert,
} from "@/lib/kb/sachet";
import { findDistrict, type DistrictRegion } from "@/lib/kb/districts";
import { rankByExposure, totalExposed } from "@/lib/kb/exposure";
import { scoreRisk, levelLabel } from "@/lib/risk";
import { db, dbReady } from "@/lib/db";
import { listIncidents, nearestTeams, specialistSlackKm } from "@/lib/ops";
import { lookupProtocol, protocolsForHazard } from "@/lib/protocols";
import { audienceFor, placeMatchSql } from "@/lib/audience";
import type { Panel } from "./panels";

const CENSUS = "Census of India 2011";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool definitions handed to the model. Descriptions are prescriptive about
 * WHEN to call each one, not just what it does — smaller open models under-call
 * tools badly without an explicit trigger condition in the description.
 */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: "region_density",
    description:
      "Map a demographic metric across India's states, or across one state's districts. Call for: which region has the most people, most crowded, highest density, compare regions.",
    input_schema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["density", "population", "area", "literacy"],
          description: "Which measure to map. Default to density for 'crowd' or 'crowded'.",
        },
        scope: {
          type: "string",
          description:
            "'india' to compare states, or a state name such as 'Himachal Pradesh' to compare its districts.",
        },
      },
      required: ["metric"],
    },
  },
  {
    name: "region_profile",
    description:
      "Full profile of one place: population, density, area, literacy, hazards. Call whenever the user names a place and asks about it.",
    input_schema: {
      type: "object",
      properties: {
        region: { type: "string", description: "Name of a state, district, or town in India." },
      },
      required: ["region"],
    },
  },
  {
    name: "rank_regions",
    description:
      "Ordered leaderboard of regions by a metric. Call for: top-N, 'which are the most/least X', any ranking.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["density", "population", "area", "literacy"] },
        scope: { type: "string", description: "'india' for states, or a state name for its districts." },
        limit: { type: "integer", description: "How many rows. Default 10." },
      },
      required: ["metric"],
    },
  },
  {
    name: "assess_risk",
    description:
      "Live flash-flood exposure for one place, from current rainfall, ground saturation, terrain and distance to water. Call for: danger, risk, flooding, is it safe right now.",
    input_schema: {
      type: "object",
      properties: {
        place: { type: "string", description: "A town, district, or locality in India." },
      },
      required: ["place"],
    },
  },
  {
    name: "past_weather",
    description:
      "What the weather actually did at a place on any past date, back to 1940, scored by the live risk engine. Call for ANY question about the past: what happened in Wayanad in July 2024, Kerala floods 2018, kitni baarish hui thi, pichle saal, last August, a named historical disaster, a specific date, or comparing now against a past period.",
    input_schema: {
      type: "object",
      properties: {
        place: { type: "string", description: "A town, district, state or locality in India." },
        from: {
          type: "string",
          description: "Start date, YYYY-MM-DD. For a single day, give only this.",
        },
        to: { type: "string", description: "Optional end date, YYYY-MM-DD, for a range." },
      },
      required: ["place", "from"],
    },
  },
  {
    name: "situation_report",
    description:
      "What is happening right now — official alerts plus our own risk scan, ranked. Call for any status question: what's the update, abhi kya chal raha hai, status, brief me, and for 'what is happening in <place>'.",
    input_schema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          description:
            "Optional — narrow to one state OR one district (e.g. 'Madhya Pradesh' or 'Indore'). Omit for all of India.",
        },
      },
    },
  },
  {
    name: "verify_signal",
    description:
      "Cross-check a place's computed risk against officially issued NDMA/IMD/SDMA alerts, news and recent earthquakes, returning a confidence level. Call for: is it real, confirmed, verify, double-check before acting.",
    input_schema: {
      type: "object",
      properties: {
        place: { type: "string", description: "A district, state or town in India." },
      },
      required: ["place"],
    },
  },
  {
    name: "search_news",
    description:
      "Search current Indian news and government releases. Call for: what's in the news, recent events, anything outside the weather data.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword to match, e.g. a place or hazard. Omit for top disaster headlines." },
      },
    },
  },
  {
    name: "official_alerts",
    description:
      "Warnings officially ISSUED right now by NDMA, the IMD, state SDMAs and the Central Water Commission, all India. Call for: official alerts, sarkari chetavni, red/orange/yellow alert, what has the government warned about, is there a warning for <place>. Outranks our own risk estimate — these are issued, not inferred.",
    input_schema: {
      type: "object",
      properties: {
        place: {
          type: "string",
          description: "Optional district or state to filter to. Omit for the whole country.",
        },
        colour: {
          type: "string",
          enum: ["red", "orange", "yellow"],
          description: "Optional minimum severity. 'red' returns only red alerts.",
        },
      },
    },
  },
  {
    name: "find_shelter",
    description:
      "Nearest safe places to go — schools, hospitals, community halls — for one location. Call for: where do I go, kahan jaun, nearest shelter, safe jagah, evacuation point, where to take people. Works with no network.",
    input_schema: {
      type: "object",
      properties: {
        place: { type: "string", description: "A town, district, or locality in India." },
      },
      required: ["place"],
    },
  },
  {
    name: "camp_needs",
    description:
      "Relief camps that are short of supplies, ranked by how many people are waiting and how badly. Call for: which camps need supplies, camp needs, where should the truck go, relief camp status, kaunse camp mein kya chahiye, supply run. Names the team holding that stock.",
    input_schema: {
      type: "object",
      properties: {
        place: {
          type: "string",
          description: "Optional district or town to narrow to. Omit for every open camp.",
        },
      },
    },
  },
  {
    name: "alert_reach",
    description:
      "How far an alert actually got — registered deliveries plus households a volunteer relayed it to by hand. Call for: did that alert get through, how many people did we reach, alert reach, kitne logon tak pahuncha.",
    input_schema: {
      type: "object",
      properties: {
        alert_id: {
          type: "integer",
          description: "Which alert. Omit for the most recent one.",
        },
      },
    },
  },
  {
    name: "duplicate_coverage",
    description:
      "Places where two different teams are working the same ground, which usually means one of them is needed elsewhere. Call for: duplicate effort, overlapping teams, are we doubling up, wasted deployment.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_incidents",
    description:
      "Live citizen emergencies, priority-ranked, with assigned teams. Call for: what's open, who needs help, the priority list, what's unassigned.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "dispatch_team",
    description:
      "Propose sending a rescue team to an incident. Call for: dispatch, send a team, send the nearest team. Returns a confirmation card — it does NOT dispatch.",
    input_schema: {
      type: "object",
      properties: {
        incident_id: {
          type: "integer",
          description: "Which incident. Omit to use the highest-priority unassigned one.",
        },
      },
    },
  },
  {
    name: "prepare_alert",
    description:
      "Propose warning registered people in a region. Call for: send an alert, warn a region, notify people. Returns a confirmation card — it does NOT send.",
    input_schema: {
      type: "object",
      properties: {
        region: { type: "string", description: "State, district or town to alert." },
        message: { type: "string", description: "What to tell people. Plain, actionable, one or two sentences." },
        level: { type: "string", enum: ["advisory", "warning", "severe"] },
      },
      required: ["region"],
    },
  },
  {
    name: "lookup_protocol",
    description:
      "Official procedure or relief entitlement: NDMA guidelines, SDRF compensation, IMD alert colours, camp standards. Call for: what's the protocol, how much compensation, what does an alert colour mean.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "What they want to know, in their own words." },
      },
      required: ["question"],
    },
  },
  {
    name: "resolve_incident",
    description:
      "Close an incident and release its team. Call for: done, handled, rescued, resolved.",
    input_schema: {
      type: "object",
      properties: {
        incident_id: { type: "integer", description: "Which incident to close." },
        outcome: { type: "string", description: "Short note on how it ended." },
      },
      required: ["incident_id"],
    },
  },
  {
    name: "control_ui",
    description:
      "Drive the interface itself: open a state's drill-down deck, switch workspace tabs, open the " +
      "replay theatre, clear all floating windows, or open the SOS panel. Call when the user asks to " +
      "OPEN, SHOW or NAVIGATE somewhere rather than asks a question about data.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["open_state", "close_all", "replay", "tab_overview", "tab_intel", "tab_ops", "tab_orgs", "sos"],
        },
        state: { type: "string", description: "State name, only for open_state." },
      },
      required: ["action"],
    },
  },
  {
    name: "list_hazards",
    description:
      "Which regions face a hazard class (flood, landslide, cyclone, cloudburst, heatwave, earthquake, drought). Call for: where does this kind of disaster happen.",
    input_schema: {
      type: "object",
      properties: {
        hazard: { type: "string", description: "A hazard keyword, e.g. 'landslide' or 'cyclone'." },
      },
      required: ["hazard"],
    },
  },
];

export interface ToolOutcome {
  /** Compact factual summary fed back to the model — this is what it speaks from */
  summary: string;
  panel?: Panel;
  /**
   * An interface action for the client to execute — the AI half of Jarvis.
   * The model still never generates UI; it picks this action from a fixed
   * enum exactly as it picks a panel, and the client runs it.
   */
  ui?: { action: string; state?: string };
}

export async function runTool(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  switch (name) {
    case "region_density":
      return regionDensity(input as { metric: Metric; scope?: string });
    case "region_profile":
      return regionProfile(input as { region: string });
    case "rank_regions":
      return rankTool(input as { metric: Metric; scope?: string; limit?: number });
    case "assess_risk":
      return assessRisk(input as { place: string });
    case "past_weather":
      return pastWeather(input as { place: string; from: string; to?: string });
    case "situation_report":
      return situationReport(input as { state?: string });
    case "verify_signal":
      return verifySignal(input as { place: string });
    case "search_news":
      return searchNews(input as { query?: string });
    case "official_alerts":
      return officialAlertsTool(input as { place?: string; colour?: string });
    case "greet":
      return {
        summary:
          "Greet the user in one short sentence and say what you can do: live official alerts, " +
          "flood risk for any district, what to do in an emergency, where the nearest shelter is, " +
          "and dispatching teams or warning a region on their confirmation. Do not list any current " +
          "incidents or alerts — they did not ask yet.",
        panel: {
          panel: "note",
          title: "BhimShila — disaster intelligence for India",
          subtitle: "757 districts monitored · NDMA Sachet + Open-Meteo, live",
          source: "Ask by voice or type — Hindi, English, or both",
          headline:
            "I am watching every district in India. Ask me what is happening, what the risk is " +
            "somewhere, what to do, or where to go.",
          body:
            "Try: \"abhi kya chal raha hai\" · \"koi official alert hai\" · " +
            "\"Kangra ka flood risk\" · \"paani aa raha hai kya karun\" · \"kahan jaun\"",
        },
      };
    case "find_shelter":
      return shelterTool(input as { place: string });
    case "control_ui": {
      const a = input as { action?: string; state?: string };
      const ACTIONS = new Set(["open_state", "close_all", "replay", "tab_overview", "tab_intel", "tab_ops", "tab_orgs", "sos"]);
      if (!a.action || !ACTIONS.has(a.action)) return { summary: "Unknown interface action." };
      if (a.action === "open_state" && !a.state?.trim()) {
        return { summary: "open_state needs a state name — ask the user which state." };
      }
      return {
        summary: `Done — interface action "${a.action}"${a.state ? ` for ${a.state}` : ""} executed. Confirm to the user in a few words.`,
        ui: { action: a.action, state: a.state?.trim() },
      };
    }
    case "camp_needs":
      return campNeedsTool(input as { place?: string });
    case "alert_reach":
      return alertReachTool(input as { alert_id?: number });
    case "duplicate_coverage":
      return duplicateCoverageTool();
    case "list_incidents":
      return incidentsTool();
    case "dispatch_team":
      return dispatchTool(input as { incident_id?: number });
    case "prepare_alert":
      return alertTool(input as { region: string; message?: string; level?: string });
    case "lookup_protocol":
      return protocolTool(input as { question: string });
    case "resolve_incident":
      return resolveTool(input as { incident_id: number; outcome?: string });
    case "list_hazards":
      return listHazards(input as { hazard: string });
    default:
      return { summary: `Unknown tool: ${name}` };
  }
}

/** One line per alert, for the spoken summary. */
const describeAlert = (a: OfficialAlert) =>
  `${a.source} — ${a.colour} (${colourMeaning[a.colour]}) for ${a.disasterType.toLowerCase()}` +
  (a.areaDescription ? ` over ${a.areaDescription}` : "");

/**
 * Warnings the government has actually issued, nationwide.
 *
 * Everything else this agent reports is inferred from rainfall and scored by
 * us. These are not. They carry the issuer's name because that is the whole
 * value: the answer to "should I believe this?" is "the Kerala SDMA said it".
 */
async function officialAlertsTool({
  place,
  colour,
}: {
  place?: string;
  colour?: string;
}): Promise<ToolOutcome> {
  const all = await fetchOfficialAlerts();
  if (!all.length) {
    return {
      summary:
        "The NDMA Sachet feed returned nothing — either no alerts are live nationwide, or the " +
        "government feed is unreachable. Say that plainly; do not substitute our own risk score " +
        "and present it as official.",
    };
  }

  // A named place is matched two ways because neither alone is enough: the
  // area description names districts but a centroid can sit 200km from the
  // district you asked about, and vice versa.
  let scoped = all;
  let scope = "India";
  /** Set when a named place matched nothing and the answer widened to national. */
  let unmatched: string | null = null;

  // "India" is the whole feed, not a place inside it. Asked "is there any red
  // alert right now", the model passes place="India" — which no region file
  // contains, so the filter matched nothing and the answer came back "no
  // official alert is live for India", immediately followed by "83 alerts are
  // active elsewhere in India". A contradiction, and the wrong half of it is
  // the reassuring one.
  const NATIONAL = /^(india|bharat|desh|nationwide|nationally|country|whole country|all india)$/i;

  if (place && !NATIONAL.test(place.trim())) {
    const region = findRegion(place);
    const loc = region ? null : findLocality(place);
    const center = region?.center ?? loc?.center ?? null;
    const byName = alertsMentioning(all, region?.name ?? place);
    const byPoint = center ? alertsNear(all, center[0], center[1], 80) : [];
    const merged = new Map([...byName, ...byPoint].map((a) => [a.id, a]));
    const hits = [...merged.values()].sort(
      (a, b) => ({ red: 3, orange: 2, yellow: 1, green: 0 })[b.colour] - ({ red: 3, orange: 2, yellow: 1, green: 0 })[a.colour],
    );

    // A place we cannot resolve at all is a vocabulary miss, not an all-clear.
    // Widening and saying so is the honest answer; reporting silence is the
    // same false reassurance the camp lookup used to give.
    if (hits.length || region || loc) {
      scoped = hits;
      scope = region?.name ?? loc?.name ?? place;
    } else {
      unmatched = place;
    }
  }

  const floor = { red: 3, orange: 2, yellow: 1 }[colour ?? ""] ?? 0;
  if (floor) {
    scoped = scoped.filter((a) => ({ red: 3, orange: 2, yellow: 1, green: 0 })[a.colour] >= floor);
  }

  if (!scoped.length) {
    // Name the colour filter, and say where the search actually looked.
    //
    // Without this, "is there any red alert right now" — with no red alert
    // live — answered "No official alert is live for India right now. 83
    // alerts are active elsewhere in India." Both halves are true and together
    // they are nonsense: it read as though the country were clear while
    // simultaneously carrying 83 warnings. What was missing was the word the
    // user actually asked with.
    const band = colour ? `${colour} alert` : "official alert";
    const where = scope === "India" ? "anywhere in India" : `for ${scope}`;

    // A colour search that found nothing still has the rest of the feed to
    // report, and that is the useful half — "no red, but thirty orange" is an
    // answer; "no red" on its own invites exactly the wrong conclusion.
    const others = colour
      ? (() => {
          const rank = { red: 3, orange: 2, yellow: 1, green: 0 };
          const below = all.filter((a) => rank[a.colour] < (rank[colour as keyof typeof rank] ?? 0));
          const byColour = { orange: 0, yellow: 0 };
          for (const a of below) if (a.colour === "orange" || a.colour === "yellow") byColour[a.colour]++;
          const parts = [
            byColour.orange ? `${byColour.orange} orange` : "",
            byColour.yellow ? `${byColour.yellow} yellow` : "",
          ].filter(Boolean);
          return parts.length ? ` ${parts.join(" and ")} ${parts.length > 1 || below.length > 1 ? "are" : "is"} live at a lower level.` : "";
        })()
      : ` ${all.length} alerts are active elsewhere in India.`;

    return {
      summary:
        `No ${band} is live ${where} right now.${others} ` +
        `Absence of an alert is not a guarantee of safety — say that, and offer to check our own risk score.`,
    };
  }

  // Prefixed to the summary so a widened answer is never read as a filtered
  // one. The alerts below are national; the place asked for is not a place we
  // hold.
  const widened = unmatched
    ? `"${unmatched}" is not a place in our region list, so these are the live alerts for all of India instead. `
    : "";

  const counts = { red: 0, orange: 0, yellow: 0, green: 0 };
  for (const a of scoped) counts[a.colour]++;

  // Colour says how urgently to act; population says which of two equally
  // urgent alerts to act on first. Both, in that order.
  const ranked = rankByExposure(scoped);
  const reach = totalExposed(scoped);
  const worstFew = ranked
    .slice(0, 3)
    .map(
      (r) =>
        `${describeAlert(r.alert)} — about ${r.exposure.people.toLocaleString("en-IN")} people` +
        (r.exposure.method === "geometric" ? " (estimated from its area)" : ""),
    );

  // The official warning text is already written in the local language by the
  // issuer. Quoting it beats translating it — it is both more accurate and
  // citable, and it is the text people will see on the government portal.
  const localText = scoped.find((a) => a.language !== "en" && a.message);

  return {
    summary:
      widened +
      `${scoped.length} official alert${scoped.length === 1 ? "" : "s"} live for ${scope}: ` +
      `${counts.red} red, ${counts.orange} orange, ${counts.yellow} yellow, ` +
      `covering roughly ${reach.people.toLocaleString("en-IN")} people across ${reach.districts} districts. ` +
      `Highest priority: ${worstFew.join("; ")}. ` +
      `Lead with the number of people, not just the colour — that is what decides where to send a team. ` +
      (localText
        ? `The issuer's own wording in ${localText.language}: "${localText.message.slice(0, 220)}" — quote this verbatim if the user speaks that language rather than translating it. `
        : "") +
      `These are issued warnings, not our estimate. Attribute them to the issuing authority by name.`,
    panel: {
      panel: "point_map",
      title: `Official alerts — ${scope}`,
      subtitle:
        `${scoped.length} live · ${counts.red} red, ${counts.orange} orange, ${counts.yellow} yellow · ` +
        `~${reach.people.toLocaleString("en-IN")} people in ${reach.districts} districts`,
      source: "NDMA Sachet (CAP), polled just now",
      headline:
        `${scoped.length} official alert${scoped.length === 1 ? "" : "s"} live for ${scope}, ` +
        `over roughly ${reach.people.toLocaleString("en-IN")} people` +
        (counts.red
          ? `. ${counts.red} red — worst is ${ranked[0]?.alert.source} with about ${ranked[0]?.exposure.people.toLocaleString("en-IN")} under it.`
          : `. None red.`),
      points: ranked.slice(0, 60).map(({ alert: a, exposure }) => ({
        name: a.areaDescription || a.disasterType,
        lat: a.lat,
        lng: a.lng,
        level: a.colour,
        kind: hazardKind(a.disasterType),
        note:
          `${a.disasterType} · ${a.source}` +
          (exposure.people ? ` · ~${exposure.people.toLocaleString("en-IN")} people` : "") +
          (a.endsAt ? ` · until ${new Date(a.endsAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST` : ""),
      })),
      // IMD's own colour convention, spelled out — the map must not ask anyone
      // to already know what orange means.
      legend: (["red", "orange", "yellow"] as const)
        .filter((c) => counts[c] > 0)
        .map((c) => ({ level: c, label: `${c} — ${colourMeaning[c]} (${counts[c]})` })),
    },
  };
}

/**
 * Where to go, from the offline bundle.
 *
 * This is the question a person in a flood actually asks, and the one the whole
 * offline bundle exists for — 4,275 places indexed so that "kahan jaun" answers
 * when Overpass is unreachable, which a disaster guarantees. It was reachable
 * only as a side field inside assess_risk, so asking it directly returned a
 * lightning protocol card.
 */
async function shelterTool({ place }: { place: string }): Promise<ToolOutcome> {
  const loc = findLocality(place);
  const region = findRegion(place) ?? findDistrict(place);
  if (!loc && !region) return { summary: `No place matching "${place}".` };

  const center = loc ? loc.center : region!.center;
  const name = loc ? loc.name : region!.name;

  const shelters = await nearbyShelters(center[0], center[1]);
  if (!shelters.length) {
    return {
      summary:
        `No mapped shelter within reach of ${name}. Say so plainly and tell the user to move to ` +
        `higher ground away from streams, and to call the state control room. Do not invent a location.`,
    };
  }

  const km = (m: number) => (m / 1000).toFixed(1);
  const nearest = shelters[0];

  return {
    summary:
      `Nearest safe places to ${name}: ` +
      shelters
        .slice(0, 5)
        .map((s) => `${s.name} (${s.kind}, ${km(s.distanceM)}km)`)
        .join("; ") +
      `. Lead with the closest one and its distance. These are mapped buildings — schools, hospitals, ` +
      `community halls — not confirmed open relief camps, so say "head towards", not "a camp is running there".`,
    panel: {
      panel: "point_map",
      title: `Nearest shelter — ${name}`,
      subtitle: `${shelters.length} within reach · closest ${km(nearest.distanceM)}km`,
      source: `${SHELTER_SOURCE} · available offline`,
      headline: `Closest is ${nearest.name}, ${km(nearest.distanceM)} kilometres away.`,
      points: shelters.slice(0, 12).map((s) => ({
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        kind: "shelter",
        level: "low",
        note: `${s.kind} · ${km(s.distanceM)}km from ${name}`,
      })),
      legend: [{ level: "low", label: "mapped shelter — head towards, not a confirmed open camp" }],
    },
  };
}

/** Official procedure or entitlement, always with its citation. */
function protocolTool({ question }: { question: string }): ToolOutcome {
  const hits = lookupProtocol(question, 2);
  if (!hits.length) {
    return {
      summary:
        "That is not in the protocol set — it covers flood, landslide, cloudburst and heatwave " +
        "procedure, SDRF relief entitlements, IMD alert colours and relief camp standards. " +
        "Say you do not have it rather than guessing.",
    };
  }

  return {
    summary:
      hits
        .map((h) => `${h.title}: ${h.body} [Source: ${h.source}, ${h.reference}]`)
        .join(" ") +
      // A live model turned "₹1,20,000 in plain areas, ₹1,30,000 in hilly areas"
      // into "₹1,20,000 for a pucca house, ₹1,30,000 for a kutcha house" —
      // inventing a distinction and telling anyone in the hills they were owed
      // less than they are. Entitlement figures are the one thing here that
      // decides what money reaches a family, so the condition attached to a
      // number is part of the number.
      " Repeat any figure with the exact condition attached to it in this text — plain versus hilly, " +
      "per hectare versus per family. Never restate a number under a condition of your own. If you are " +
      "not sure which condition applies, give the figures with their conditions and let the coordinator " +
      "choose. Say these are indicative and to confirm against the current SDRF circular before disbursing.",
    panel: {
      panel: "protocol_card",
      title: hits[0].title,
      subtitle: hits[0].source,
      source: hits[0].reference,
      // The deterministic fallback quotes the entry rather than paraphrasing,
      // so the spoken answer is right even with every model unavailable.
      headline: `${hits[0].title}. ${hits[0].body}`,
      entries: hits.map((h) => ({
        title: h.title,
        body: h.body,
        source: h.source,
        reference: h.reference,
      })),
    },
  };
}

/** Recovery — close it out and release the team. */
async function resolveTool({
  incident_id,
  outcome,
}: {
  incident_id: number;
  outcome?: string;
}): Promise<ToolOutcome> {
  await dbReady();
  const inc = await db().execute({
    sql: "SELECT id, title, assigned_team_id, status FROM incidents WHERE id = ?",
    args: [incident_id],
  });
  const row = inc.rows[0];
  if (!row) return { summary: `No incident #${incident_id}.` };
  if (String(row.status) === "resolved") {
    return { summary: `Incident #${incident_id} is already resolved.` };
  }

  return {
    summary:
      `Ready to close incident #${incident_id}: ${String(row.title)}` +
      `${row.assigned_team_id !== null ? ", releasing its team back to available" : ""}. Awaiting confirmation.`,
    panel: {
      panel: "confirm_action",
      title: "Confirm resolve",
      subtitle: `Incident #${incident_id}`,
      source: "Requires human confirmation",
      kind: "resolve",
      request: { action: "resolve", incidentId: incident_id, outcome: outcome ?? "resolved" },
      lines: [
        { label: "Incident", value: `#${incident_id} ${String(row.title)}` },
        { label: "Outcome", value: outcome ?? "resolved" },
        {
          label: "Team",
          value: row.assigned_team_id !== null ? "released back to available" : "none assigned",
        },
      ],
    },
  };
}

/** Live emergencies, priority-ranked. */
/**
 * Which supply run leaves next.
 *
 * The panel is a ranked_list rather than a board because the question this
 * answers is an ordering — a driver needs to know what is first, not to browse
 * every camp. Value is the shortfall, so the bar length is the thing being
 * asked for.
 */
async function campNeedsTool(input: { place?: string }): Promise<ToolOutcome> {
  const [list, stocks] = await Promise.all([listCamps(input.place), teamStocks()]);
  const ranked = list.camps;

  if (!ranked.length) {
    return {
      summary:
        campsHeadline(ranked) +
        (list.unmatched ? ` Nothing is recorded under "${list.unmatched}" either.` : ""),
    };
  }

  // Said out loud when the filter missed, so a widened answer is never
  // mistaken for a filtered one.
  const widened = list.unmatched
    ? `No camp is recorded under "${list.unmatched}", so this is every open camp instead. `
    : "";
  const headline = widened + campsHeadline(ranked);

  return {
    summary:
      headline +
      " " +
      ranked
        .slice(0, 5)
        .map((c) => {
          const supplier = c.worst ? supplierFor(c.worst.item, stocks) : null;
          return `${c.name} (${c.place}): ${c.why}${supplier ? ` ${supplier.team} is carrying ${c.worst!.item}.` : c.worst ? ` No team is carrying ${c.worst.item}.` : ""}`;
        })
        .join(" "),
    panel: {
      panel: "ranked_list",
      title: list.unmatched || !input.place ? "Relief camps short of supplies" : `Camp needs — ${input.place}`,
      subtitle: `${ranked.length} camp${ranked.length === 1 ? "" : "s"} · ranked by people waiting and urgency`,
      source: "Camp reports · team stock from the deployment log",
      headline,
      unit: " short",
      rows: ranked.slice(0, 10).map((c) => {
        const supplier = c.worst ? supplierFor(c.worst.item, stocks) : null;
        return {
          name: `${c.name}, ${c.place}`,
          value: c.worst?.short ?? 0,
          note:
            `${c.people.toLocaleString("en-IN")} people · ${c.worst?.item ?? "—"}` +
            (c.worst?.urgency && c.worst.urgency !== "normal" ? ` · ${c.worst.urgency}` : "") +
            (supplier ? ` · ${supplier.team} has stock` : c.worst ? " · nobody carrying it" : ""),
        };
      }),
    },
  };
}

/**
 * Did the warning actually get anywhere.
 *
 * Reports the two numbers separately and never sums them — see lib/reach.ts
 * for why that separation is the whole point of the feature.
 */
async function alertReachTool(input: { alert_id?: number }): Promise<ToolOutcome> {
  const found = await alertReach(input.alert_id);
  if (!found) {
    return { summary: "No alert has been sent yet, so there is nothing to measure the reach of." };
  }

  const { alert, reach } = found;
  return {
    summary:
      `Alert #${alert.id} (${alert.level}, ${alert.region}): ${reach.headline}` +
      (reach.places.length ? ` Relayed from ${reach.places.join(", ")}.` : ""),
    panel: {
      panel: "ranked_list",
      title: `Reach — alert #${alert.id}, ${alert.region}`,
      subtitle: `${alert.level} · registered delivery versus hand relay`,
      source: "Delivery log and volunteer relay reports",
      headline: reach.headline,
      unit: " people",
      rows: [
        { name: "Delivered to registered users", value: reach.delivered, note: "verified — one row per recipient" },
        {
          name: "Relayed by volunteers",
          value: reach.relayedPeopleEstimate,
          note: `${reach.relayedHouseholds.toLocaleString("en-IN")} households, estimated at 4.9 people each`,
        },
      ],
    },
  };
}

/** Two teams on the same ground. */
async function duplicateCoverageTool(): Promise<ToolOutcome> {
  const overlaps = await duplicateCoverage();

  if (!overlaps.length) {
    return {
      summary:
        "No two teams are working within 15 kilometres of each other right now — no duplicated effort visible in the current deployments.",
    };
  }

  const headline = `${overlaps.length} possible duplicate${overlaps.length === 1 ? "" : "s"} — teams working within 15 kilometres of each other. Closest: ${overlaps[0].a} and ${overlaps[0].b}, ${overlaps[0].km} kilometres apart near ${overlaps[0].place}.`;

  return {
    summary: headline,
    panel: {
      panel: "ranked_list",
      title: "Possible duplicated effort",
      subtitle: `${overlaps.length} pair${overlaps.length === 1 ? "" : "s"} within 15 km · closest first`,
      source: "Live deployments — assignment log",
      headline,
      unit: " km apart",
      rows: overlaps.slice(0, 10).map((o) => ({
        name: `${o.a} + ${o.b}`,
        value: o.km,
        note: `both near ${o.place}`,
      })),
    },
  };
}

async function incidentsTool(): Promise<ToolOutcome> {
  await dbReady();
  const incidents = await listIncidents();
  if (!incidents.length) {
    return { summary: "No open incidents right now. Nobody has raised an SOS." };
  }

  const open = incidents.filter((i) => i.status === "open");
  return {
    summary:
      `${incidents.length} open incidents, ${open.length} still unassigned. ` +
      incidents
        .slice(0, 5)
        .map(
          (i) =>
            `#${i.id} ${i.title} (${i.place ?? "location unknown"}), priority ${i.priority}, ` +
            `${i.reportCount} report(s)${i.assignedTeam ? `, ${i.assignedTeam} dispatched` : ", unassigned"}`,
        )
        .join("; "),
    panel: {
      panel: "incident_board",
      title: "Live incidents",
      subtitle: `${incidents.length} open · ${open.length} unassigned · priority ranked`,
      source: "Citizen SOS reports",
      // Spoken when the model returns nothing. Without it the fallback reached
      // the panel title and said "Live incidents" — two words that answer no
      // question anyone asked.
      headline:
        `${incidents.length} open incident${incidents.length === 1 ? "" : "s"}, ` +
        `${open.length} still unassigned. ` +
        (incidents[0]
          ? `Highest priority is ${incidents[0].title}${incidents[0].place ? ` in ${incidents[0].place}` : ""}.`
          : ""),
      incidents: incidents.slice(0, 8).map((i) => ({
        id: i.id,
        title: i.title,
        category: i.category,
        place: i.place,
        severity: i.severity,
        priority: i.priority,
        reportCount: i.reportCount,
        peopleCount: i.peopleCount,
        status: i.status,
        assignedTeam: i.assignedTeam,
        reasons: i.reasons,
      })),
    },
  };
}

/**
 * Propose a dispatch. Deliberately does not execute — it returns a confirm
 * card, because a mis-heard "send a team to Kollam" should not move an NDRF
 * battalion.
 */
async function dispatchTool({ incident_id }: { incident_id?: number }): Promise<ToolOutcome> {
  await dbReady();
  const incidents = await listIncidents();
  if (!incidents.length) return { summary: "There are no open incidents to dispatch to." };

  const target =
    (incident_id && incidents.find((i) => i.id === incident_id)) ||
    incidents.find((i) => i.status === "open") ||
    incidents[0];

  if (target.lat === null || target.lng === null) {
    return { summary: `Incident #${target.id} has no location, so no team can be routed to it.` };
  }

  const near = await nearestTeams(
    target.lat,
    target.lng,
    target.category === "medical" ? "medical" : undefined,
    3,
    specialistSlackKm(target.severity),
  );
  if (!near.length) return { summary: "No teams are currently available." };

  const best = near[0];
  return {
    summary:
      `Ready to dispatch ${best.name} (${best.place}, ${best.distanceKm}km away) to incident #${target.id}: ` +
      `${target.title}. Awaiting confirmation — say confirm, or press confirm on screen.`,
    panel: {
      panel: "confirm_action",
      title: "Confirm dispatch",
      subtitle: `${best.name} → incident #${target.id}`,
      source: "Requires human confirmation",
      kind: "dispatch",
      request: { action: "prepare_dispatch", incidentId: target.id, teamId: best.id },
      lines: [
        { label: "Incident", value: `#${target.id} ${target.title}` },
        { label: "Location", value: target.place ?? "unknown" },
        { label: "Priority", value: `${target.priority} · severity ${target.severity}/5` },
        { label: "Team", value: `${best.name} (${best.kind})` },
        { label: "Distance", value: `${best.distanceKm} km from ${best.place}` },
        ...(near[1] ? [{ label: "Backup", value: `${near[1].name}, ${near[1].distanceKm} km` }] : []),
      ],
    },
  };
}

/** Propose an alert. Same rule: proposed here, sent only on confirm. */
async function alertTool({
  region,
  message,
  level,
}: {
  region: string;
  message?: string;
  level?: string;
}): Promise<ToolOutcome> {
  await dbReady();

  const loc = findLocality(region);
  const reg = findRegion(region);
  const center = loc ? loc.center : reg?.center;

  let evidence = "";
  if (center) {
    try {
      const rain = await getRainfall(center[0], center[1]);
      const risk = scoreRisk({
        antecedent72h: rain.antecedent72h,
        next24h: rain.next24h,
        peakIntensity: rain.peakIntensity,
        waterwayDistanceM: null,
        elevationM: rain.elevationM,
      });
      evidence = `${risk.score}/100 ${risk.level}. ${risk.evidence}`;
    } catch {
      /* an alert can still go out without a fresh reading */
    }
  }

  // Is an authority already warning this region? If so its wording, not ours,
  // is what should reach people.
  const official = await fetchOfficialAlerts();
  const regional = [
    ...new Map(
      [
        ...alertsMentioning(official, reg?.name ?? region),
        ...(center ? alertsNear(official, center[0], center[1], 80) : []),
      ].map((a) => [a.id, a]),
    ).values(),
  ];
  const basis = regional[0] ?? null;

  // Anything we are about to cite gets checked against its CAP document first.
  // The summary feed cannot distinguish a live warning from a drill or from one
  // already withdrawn, and this is the last point before a broadcast is staged.
  if (basis) {
    const doc = await fetchCapDocument(basis.id);
    const gate = doc ? actionable(doc) : null;
    if (gate && !gate.ok) {
      return {
        summary:
          `Refusing to stage this alert. The official warning for ${reg?.name ?? region} ` +
          `(${basis.source}, CAP ${doc!.identifier}) is not in force: ${gate.reason} ` +
          `Tell the user exactly this. Do not broadcast it, and do not substitute our own risk score ` +
          `and present it as official — offer to check live risk separately instead.`,
        panel: {
          panel: "note",
          title: "Alert not staged",
          subtitle: `${basis.source} · CAP ${doc!.status}/${doc!.msgType}`,
          source: "NDMA Sachet (CAP)",
          headline: `Not staged — ${gate.reason}`,
          body: `${gate.reason}\n\nThe warning referenced was "${basis.disasterType}" over ${basis.areaDescription}, issued by ${basis.source}. Nothing has been sent.`,
        },
      };
    }
  }

  // Same expansion the delivery path uses, so the number on the confirm card
  // is the number who will actually be reached — not a different query that
  // happens to agree most of the time.
  const audience = audienceFor(reg?.name ?? region);
  const match = placeMatchSql(audience);
  const recipients = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM users WHERE ${match.sql}`,
    args: match.args,
  });
  const count = Number(recipients.rows[0].n);

  // Message priority: what the coordinator dictated, else the issuing
  // authority's own wording, else our own line. The middle case is the good
  // one — NDMA writes the warning in the local language itself, so relaying it
  // is both more accurate than translating and citable back to the issuer.
  const localOfficial = regional.find((a) => a.language !== "en" && a.message) ?? null;
  const englishOfficial = regional.find((a) => a.language === "en" && a.message) ?? null;
  const officialBody = (localOfficial ?? englishOfficial)?.message ?? null;

  const body =
    message?.trim() ||
    officialBody ||
    `Heavy rainfall warning for ${reg?.name ?? region}. Move away from streams and low ground tonight.`;

  // What people should actually do, for the hazard the alert is about. Kept as
  // a separate line with its own citation rather than folded into the issuer's
  // words — the authority wrote the warning, NDMA wrote the guidance, and
  // neither should be presented as the other.
  const guidance = basis
    ? protocolsForHazard(hazardKind(basis.disasterType), "citizen").find((p) => p.phase === "during")
    : null;

  const sourcedFrom = message?.trim()
    ? "dictated by the coordinator"
    : officialBody
      ? `official wording from ${(localOfficial ?? englishOfficial)!.source}`
      : "drafted by BhimShila — no official wording available for this region";

  if (basis) {
    evidence =
      `${basis.source}: ${basis.colour} alert for ${basis.disasterType} over ${basis.areaDescription} (CAP ${basis.id}).` +
      (evidence ? ` Our own reading: ${evidence}` : "");
  }

  // An explicit level wins; otherwise a red official alert implies severe.
  const effectiveLevel = level ?? (basis?.colour === "red" ? "severe" : "warning");

  return {
    summary:
      `Ready to alert ${count} registered ${count === 1 ? "person" : "people"} in ${reg?.name ?? region}: "${body}" ` +
      `This text is ${sourcedFrom}. ${evidence ? `Evidence: ${evidence}` : ""} ` +
      (officialBody && !message?.trim()
        ? `Say that the wording is the issuing authority's own, not ours. `
        : "") +
      (guidance
        ? `NDMA's own safety guidance for this hazard is appended to the message: "${guidance.body.slice(0, 180)}" `
        : "") +
      `Awaiting confirmation — nothing has been sent.`,
    panel: {
      panel: "confirm_action",
      title: "Confirm alert",
      subtitle: `${reg?.name ?? region} · ${count} recipient${count === 1 ? "" : "s"}`,
      source: basis ? `Based on ${basis.source} · requires human confirmation` : "Requires human confirmation",
      kind: "alert",
      request: {
        action: "prepare_alert",
        region: reg?.name ?? region,
        message: guidance ? `${body}\n\n${guidance.body}` : body,
        level: effectiveLevel,
        evidence,
      },
      lines: [
        { label: "Region", value: reg?.name ?? region },
        { label: "Level", value: effectiveLevel },
        {
          label: "Recipients",
          value:
            `${count} registered` +
            (audience.scope === "state"
              ? ` across ${audience.places.length - 1} districts of ${audience.resolved}`
              : audience.scope === "district"
                ? ` in ${audience.resolved}`
                : ` matching "${audience.resolved}"`),
        },
        { label: "Message", value: body },
        { label: "Wording", value: sourcedFrom },
        ...(guidance
          ? [{ label: `Safety guidance (${guidance.source})`, value: guidance.body }]
          : []),
        ...(localOfficial && englishOfficial && localOfficial.message !== body
          ? [{ label: `Also issued in ${localOfficial.language}`, value: localOfficial.message.slice(0, 200) }]
          : []),
        ...(evidence ? [{ label: "Evidence", value: evidence }] : []),
      ],
    },
  };
}

/** National sweep — every district, ranked by what needs attention. */
async function situationReport({ state }: { state?: string }): Promise<ToolOutcome> {
  const [all, official] = await Promise.all([scanNation(), fetchOfficialAlerts()]);

  // The argument may name a state or a single district. Asked "Indore mein kya
  // update hai", this used to match nothing on the state filter and fall back
  // to reporting all of Madhya Pradesh — 52 districts, none of them the one
  // that was asked about.
  const needle = state?.toLowerCase().trim() ?? "";
  const asDistrict = needle
    ? all.filter((d) => d.district.toLowerCase() === needle)
    : [];
  const scoped = !needle
    ? all
    : asDistrict.length
      ? asDistrict
      : all.filter((d) => d.state.toLowerCase().includes(needle));

  // An empty scan is the source rate-limiting us, not a country with no
  // districts — and it used to surface here as `No districts matched
  // "undefined"`. The official layer still answers, so the degraded sitrep is
  // the officials-only view with the degradation said out loud.
  if (!all.length) {
    if (official.length) {
      const out = await officialAlertsTool(needle ? { place: needle } : {});
      out.summary = `Our district rainfall scan is rate-limited right now, so this is the official layer alone. ${out.summary}`;
      if (out.panel) {
        out.panel.subtitle = "official alerts only — our rainfall scan is rate-limited, retry in a few minutes";
      }
      return out;
    }
    return {
      summary:
        "Both the rainfall scan and the official alert feed returned nothing just now — " +
        "that is a source outage, not an all-clear. Try again in a few minutes.",
    };
  }
  if (!scoped.length) return { summary: `No districts matched "${state ?? needle}".` };

  const elevated = scoped.filter((d) => d.score >= 28);
  const top = scoped.slice(0, 10);
  const states = byState(scoped);
  const scope = !state
    ? "India"
    : asDistrict.length
      ? `${asDistrict[0].district}, ${asDistrict[0].state}`
      : states[0]?.state ?? state;

  const headline = elevated.length
    ? `${elevated.length} of ${scoped.length} districts are at moderate exposure or above. ` +
      `Highest: ${top
        .slice(0, 3)
        .map((d) => `${d.district} (${d.state}) ${d.score}/100 ${d.level}`)
        .join("; ")}.`
    : `All ${scoped.length} districts are at low exposure. Highest is ${top[0].district} ` +
      `(${top[0].state}) at ${top[0].score}/100.`;

  // Scope the official feed the same way the scan is scoped, so a state-level
  // report doesn't lead with a red alert from the other end of the country.
  const officialScoped = state
    ? [
        ...new Map(
          [
            ...alertsMentioning(official, scope),
            ...scoped
              .slice(0, 12)
              .flatMap((d) => alertsNear(official, d.lat, d.lng, 80)),
          ].map((a) => [a.id, a]),
        ).values(),
      ]
    : official;
  const red = officialScoped.filter((a) => a.colour === "red");
  const orange = officialScoped.filter((a) => a.colour === "orange");
  const reach = totalExposed(officialScoped);
  const worstOfficial = rankByExposure(officialScoped)[0];

  // The official position leads. Our scan is the wide net that fills the gaps
  // between issued warnings, and it is described as exactly that.
  const officialLine = officialScoped.length
    ? `Officially issued right now for ${scope}: ${officialScoped.length} live alerts — ` +
      `${red.length} red, ${orange.length} orange, over roughly ` +
      `${reach.people.toLocaleString("en-IN")} people in ${reach.districts} districts. ` +
      (red.length
        ? `Red: ${red.slice(0, 4).map(describeAlert).join("; ")}. `
        : orange.length
          ? `Most severe: ${orange.slice(0, 3).map(describeAlert).join("; ")}. `
          : "") +
      `Lead with these and name the issuing authority. `
    : `No official alert is currently issued for ${scope}. `;

  return {
    summary:
      `Situation report for ${scope}. ${officialLine}` +
      `Our own continuous scan, which covers the gaps between issued warnings: ${headline} ` +
      `Worst-affected states: ${states.slice(0, 3).map((s) => `${s.state} (${s.elevated} districts elevated)`).join(", ")}.`,
    panel: {
      panel: "ranked_list",
      title: `Situation report — ${scope}`,
      subtitle:
        `${officialScoped.length} official alerts (${red.length} red) · ` +
        `~${reach.people.toLocaleString("en-IN")} people covered · ` +
        `${scoped.length} districts scanned · ${elevated.length} elevated`,
      source: "NDMA Sachet + Open-Meteo, both live",
      headline: red.length
        ? `${red.length} red alert${red.length === 1 ? "" : "s"} out, over about ` +
          `${(worstOfficial?.exposure.people ?? 0).toLocaleString("en-IN")} people at the worst — ` +
          `${[...new Set(red.map((a) => a.source.replace(/ (SDMA|IMD).*$/, "")))].slice(0, 3).join(", ")}. ` +
          `Our scan flags ${elevated.length} districts elevated.`
        : officialScoped.length
          ? `${officialScoped.length} official alerts live, ${orange.length} orange, none red. ` +
            `Our scan flags ${elevated.length} districts elevated.`
          : `No official alert is out. Our scan flags ${elevated.length} of ${scoped.length} districts elevated, ` +
            `highest ${top[0].district} at ${top[0].score} out of 100.`,
      unit: "/100",
      rows: top.map((d) => ({
        name: `${d.district}, ${d.state}`,
        value: d.score,
        note: `${d.level} · ${d.antecedent72h}mm past 72h, ${d.next24h}mm incoming`,
      })),
    },
  };
}

/** First term that yields headlines wins; the feeds are cached, so this is cheap. */
async function newsForTerms(terms: string[], limit: number) {
  for (const t of terms) {
    const hits = await newsForPlace(t, limit);
    if (hits.length) return hits;
  }
  return [];
}

/**
 * The verification step. A machine signal on its own is not evidence — this
 * checks it against what people actually reported.
 */
async function verifySignal({ place }: { place: string }): Promise<ToolOutcome> {
  const loc = findLocality(place);
  const region = findRegion(place);
  if (!loc && !region) return { summary: `No place matching "${place}".` };

  const center = loc ? loc.center : region!.center;
  const name = loc ? loc.name : region!.name;
  const stateName = region?.level === "district" ? getRegion(region.parentId ?? "")?.name : region?.name;

  // Try the place itself, then widen to its state — a district rarely appears
  // in a national headline by name, but its state usually does.
  const searchTerms = stateName && stateName !== name ? [name, stateName] : [name];

  const [rain, water, news, quakes, official] = await Promise.all([
    getRainfall(center[0], center[1]),
    nearestWaterway(center[0], center[1]),
    newsForTerms(searchTerms, 5),
    fetchQuakes(30, 4),
    fetchOfficialAlerts(),
  ]);

  const risk = scoreRisk({
    antecedent72h: rain.antecedent72h,
    next24h: rain.next24h,
    peakIntensity: rain.peakIntensity,
    waterwayDistanceM: water?.distanceM ?? null,
    elevationM: rain.elevationM,
  });

  const nearbyQuakes = quakes.filter(
    (q) => Math.abs(q.lat - center[0]) < 2.5 && Math.abs(q.lng - center[1]) < 2.5,
  );
  const corroborating = news.filter((n) => isDisasterRelated(n.title));

  // Warnings the authorities have already issued for this area, matched both by
  // name and by proximity.
  const nearbyOfficial = [
    ...new Map(
      [
        ...alertsMentioning(official, name),
        ...(stateName ? alertsMentioning(official, stateName) : []),
        ...alertsNear(official, center[0], center[1], 80),
      ].map((a) => [a.id, a]),
    ).values(),
  ];
  const reconciliation = crossCheck(risk.score, nearbyOfficial);

  // Pull the full CAP document for the most severe alert here. The summary feed
  // carries no status or msgType, so on its own it cannot tell a live warning
  // from a drill or from one already withdrawn — and this is the tool people
  // call precisely when they are deciding whether to act. One extra request,
  // ETag-cached per NDMA's integration guide.
  const capDoc = nearbyOfficial.length ? await fetchCapDocument(nearbyOfficial[0].id) : null;
  const gate = capDoc ? actionable(capDoc) : null;

  // Confidence is deliberately simple and explainable: a machine signal plus
  // independent human reporting is what earns a broadcast.
  let confidence: "low" | "medium" | "high";
  let verdict: string;
  if (gate && !gate.ok) {
    // The CAP document says this is a drill, a withdrawal or already expired.
    // The summary feed would have shown it as live, so this is the one place
    // that catch can happen — and it must not be quietly downgraded to medium.
    confidence = "low";
    verdict = `${gate.reason} Do not act on it.`;
  } else if (nearbyOfficial.length > 0) {
    // An issued warning settles it. We are not in a position to second-guess an
    // SDMA that has radar, river gauges and a statutory mandate — so an official
    // alert lifts confidence to high on its own, whatever our own score says,
    // and the reconciliation note carries the disagreement if there is one.
    confidence = "high";
    verdict = gate ? `${reconciliation.note} ${gate.reason}` : reconciliation.note;
  } else if (risk.score >= 28 && corroborating.length > 0) {
    // An elevated signal AND independent reporting is the case that earns a
    // broadcast. Moderate counts: the 26 June Khaniyara cloudburst scored 37.
    confidence = "high";
    verdict = "Corroborated — the machine signal and independent ground reports agree.";
  } else if (risk.score >= 50) {
    confidence = "medium";
    verdict = "Elevated signal, nothing reported on the ground yet. Watch, do not broadcast.";
  } else if (corroborating.length > 0) {
    confidence = "medium";
    verdict = "Reported on the ground but the weather signal is quiet — the cause may be local or non-meteorological.";
  } else {
    confidence = "low";
    verdict = "No elevated signal and nothing reported. Nothing to broadcast.";
  }

  const evidence = [
    // Official first — it is the only line here that is an issued warning
    // rather than something we inferred, so it leads the answer.
    nearbyOfficial.length
      ? `Official (NDMA Sachet): ${nearbyOfficial.length} live alert(s) — ${nearbyOfficial.slice(0, 3).map(describeAlert).join("; ")}. ${reconciliation.note}` +
        (capDoc
          ? ` CAP document ${capDoc.identifier}: ${capDoc.status}/${capDoc.msgType}, ${capDoc.urgency} urgency, ${capDoc.certainty} certainty.` +
            (capDoc.instruction ? ` The issuer's instruction: "${capDoc.instruction}" — relay this wording rather than inventing advice.` : "")
          : "")
      : `Official (NDMA Sachet): no alert issued for this area. ${reconciliation.note}`,
    `Machine: ${risk.score}/100 (${levelLabel[risk.level]}). ${risk.evidence}`,
    corroborating.length
      ? `Ground reports (${corroborating.length}): ${corroborating.map((n) => `"${n.title}" — ${n.source}`).join("; ")}`
      : "Ground reports: none matching in current news feeds.",
    nearbyQuakes.length
      ? `Seismic: ${nearbyQuakes.length} quake(s) M4+ within ~250km in 30 days, strongest M${Math.max(...nearbyQuakes.map((q) => q.magnitude))}.`
      : "Seismic: nothing significant nearby.",
  ];

  return {
    summary: `${name} — confidence ${confidence.toUpperCase()}. ${verdict} ${evidence.join(" ")}`,
    panel: {
      panel: "risk_card",
      title: `${name} — verification`,
      subtitle: `Confidence ${confidence} · ${verdict}`,
      source: "NDMA Sachet + Open-Meteo + The Hindu/NDTV/PIB + USGS",
      place: name,
      score: risk.score,
      level: risk.level,
      evidence: verdict,
      factors: [
        {
          label: "Official alert (NDMA Sachet)",
          detail: nearbyOfficial.length
            ? nearbyOfficial.slice(0, 3).map(describeAlert).join(" · ") +
              (capDoc ? ` · CAP ${capDoc.status}/${capDoc.msgType}, ${capDoc.urgency} urgency, ${capDoc.certainty} certainty` : "")
            : "No warning issued for this area by any authority",
          points: nearbyOfficial.length ? 40 : 0,
        },
        ...risk.factors,
        {
          label: "Ground corroboration",
          detail: corroborating.length
            ? corroborating.map((n) => n.title).join(" · ")
            : "No matching reports in current feeds",
          points: corroborating.length ? 30 : 0,
        },
        {
          label: "Seismic activity",
          detail: nearbyQuakes.length
            ? `${nearbyQuakes.length} events M4+ within ~250km`
            : "None significant nearby",
          points: nearbyQuakes.length ? 15 : 0,
        },
      ],
    },
  };
}

/** Current Indian news, keyword-filtered. */
async function searchNews({ query }: { query?: string }): Promise<ToolOutcome> {
  const news = await fetchNews({ disasterOnly: !query, limit: 120 });
  const hits = query
    ? news.filter((n) => n.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : news.slice(0, 8);

  if (!hits.length) {
    return { summary: `Nothing in current Indian news feeds matching "${query ?? "disasters"}".` };
  }

  return {
    summary:
      `${hits.length} headline(s) from Indian news feeds: ` +
      hits.map((n) => `"${n.title}" (${n.source})`).join("; "),
    panel: {
      panel: "note",
      title: query ? `News — ${query}` : "Disaster headlines — India",
      subtitle: `${hits.length} from The Hindu, NDTV, PIB`,
      source: "Indian news RSS, live",
      body: hits.map((n) => `• ${n.title}  — ${n.source}`).join("\n"),
    },
  };
}

function regionDensity({ metric, scope = "india" }: { metric: Metric; scope?: string }): ToolOutcome {
  const { regions, level, scopeName } = rankRegions(metric, scope, 100);
  const features = regions.map((r) => ({
    id: r.id,
    name: r.name,
    value: metricOf(r, metric),
    center: r.center,
  }));
  const top = features.slice(0, 5);
  return {
    summary:
      `${metricLabel[metric]} across ${features.length} ${level}s of ${scopeName}. ` +
      `Highest: ${top.map((f) => `${f.name} (${f.value.toLocaleString("en-IN")})`).join(", ")}.`,
    panel: {
      panel: "choropleth",
      title: `${metricLabel[metric]} — ${scopeName}`,
      subtitle: `${features.length} ${level}s`,
      source: CENSUS,
      metric: metricLabel[metric],
      unit: metric === "density" ? "/km²" : metric === "literacy" ? "%" : "",
      features,
    },
  };
}

function regionProfile({ region }: { region: string }): ToolOutcome {
  const r = findRegion(region);
  if (!r) return { summary: `No region matching "${region}" in the knowledge base.` };

  const loc = findLocality(region);
  const kids = childrenOf(r.id);
  const towns = localitiesOf(r.id);

  // District rows carry a projection and a vulnerability profile; the curated
  // state rows do not.
  const d = "vulnerability" in r ? (r as DistrictRegion) : null;
  const v = d?.vulnerability;
  const n = (x: number) => x.toLocaleString("en-IN");

  const facts = [
    { label: "Population (2011 census)", value: n(r.population) },
    ...(d?.population2026
      ? [{ label: "Projected 2026", value: `${n(d.population2026)} (×${d.growthFactor})` }]
      : []),
    { label: "Density", value: `${n(r.density)} /km²` },
    { label: "Area", value: `${n(r.areaKm2)} km²` },
    ...(v?.ruralPct != null ? [{ label: "Rural households", value: `${v.ruralPct}%` }] : []),
    ...(v?.fragileHousingPct != null
      ? [{ label: "Fragile housing", value: `${v.fragileHousingPct}%` }]
      : []),
    ...(v?.phoneReachPct != null
      ? [{ label: "Reachable by phone", value: `${v.phoneReachPct}% of households` }]
      : []),
    ...(v?.elderlyPct != null ? [{ label: "Aged 50+", value: `${v.elderlyPct}%` }] : []),
    ...(r.literacyPct ? [{ label: "Literacy", value: `${r.literacyPct}%` }] : []),
    ...(kids.length ? [{ label: "Districts", value: String(kids.length) }] : []),
  ];

  // What a responder does differently because of these numbers, stated once so
  // the model relays the implication rather than reciting percentages.
  const implications = [
    v?.fragileHousingPct != null && v.fragileHousingPct >= 5
      ? `${v.fragileHousingPct}% of homes here are classed dilapidated — structural damage is likely early.`
      : null,
    v?.phoneReachPct != null && v.phoneReachPct < 60
      ? `Only ${v.phoneReachPct}% of households have any phone, so a phone alert will not reach ${100 - v.phoneReachPct}% of them — plan loudspeakers or door-to-door.`
      : null,
    v?.ruralPct != null && v.ruralPct >= 75
      ? `${v.ruralPct}% rural — expect long approach times and scattered settlements.`
      : null,
  ].filter(Boolean);

  return {
    summary:
      `${r.name} (${r.level}): ${n(r.population)} people at the 2011 census` +
      (d?.population2026
        ? `, about ${n(d.population2026)} projected for 2026 using the ${d.growthSource === "state" ? "state's own" : "national"} official growth rate. Say the projected figure is a projection, not a count`
        : "") +
      `. Density ${r.density}/km², area ${n(r.areaKm2)} km². ` +
      (implications.length ? `${implications.join(" ")} ` : "") +
      `Hazards: ${(r.hazards ?? []).join(", ") || "none recorded"}. Source: ${CENSUS}` +
      (d?.population2026 ? " and the National Commission on Population projections" : "") +
      "." +
      (d?.populationNote ? ` ${d.populationNote}` : "") +
      (loc?.note ? ` Local note — ${loc.note}` : "") +
      (towns.length ? ` Localities: ${towns.map((t) => t.name).join(", ")}.` : ""),
    panel: {
      panel: "region_card",
      title: r.name,
      subtitle: loc ? `${loc.name} · ${r.name} ${r.level}` : `${r.level}`,
      source: d?.population2026 ? `${CENSUS} · projected to 2026 (NCP)` : CENSUS,
      region: {
        name: r.name,
        level: r.level,
        population: r.population,
        density: r.density,
        areaKm2: r.areaKm2,
        literacyPct: r.literacyPct,
        hazards: r.hazards ?? [],
        center: loc ? loc.center : r.center,
      },
      facts,
    },
  };
}

function rankTool({ metric, scope = "india", limit = 10 }: { metric: Metric; scope?: string; limit?: number }): ToolOutcome {
  const { regions, level, scopeName } = rankRegions(metric, scope, limit);
  const rows = regions.map((r) => ({
    name: r.name,
    value: metricOf(r, metric),
    note: metric === "density" ? `${r.population.toLocaleString("en-IN")} people` : undefined,
  }));
  return {
    summary:
      `Top ${rows.length} ${level}s of ${scopeName} by ${metricLabel[metric]}: ` +
      rows.map((r, i) => `${i + 1}. ${r.name} ${r.value.toLocaleString("en-IN")}`).join("; "),
    panel: {
      panel: "ranked_list",
      title: `${metricLabel[metric]} — top ${rows.length}`,
      subtitle: scopeName,
      source: CENSUS,
      unit: metric === "density" ? "/km²" : metric === "literacy" ? "%" : "",
      rows,
    },
  };
}

async function assessRisk({ place }: { place: string }): Promise<ToolOutcome> {
  const loc = findLocality(place);
  const region = findRegion(place);
  if (!loc && !region) return { summary: `No place matching "${place}".` };

  const center = loc ? loc.center : region!.center;
  const name = loc ? loc.name : region!.name;

  const [rain, water, shelters] = await Promise.all([
    getRainfall(center[0], center[1]),
    nearestWaterway(center[0], center[1]),
    nearbyShelters(center[0], center[1]),
  ]);

  const risk = scoreRisk({
    antecedent72h: rain.antecedent72h,
    next24h: rain.next24h,
    peakIntensity: rain.peakIntensity,
    waterwayDistanceM: water?.distanceM ?? null,
    elevationM: rain.elevationM,
  });

  return {
    summary:
      `${name}: flash-flood exposure ${levelLabel[risk.level]} (${risk.score}/100). ${risk.evidence} ` +
      `Nearest watercourse: ${water ? `${water.name ?? "unnamed"} at ${water.distanceM}m` : "none mapped nearby"}. ` +
      `Elevation ${rain.elevationM ?? "unknown"}m. Data: Open-Meteo, live.`,
    panel: {
      panel: "risk_card",
      title: `${name} — flash-flood exposure`,
      subtitle: `${levelLabel[risk.level]} · live assessment`,
      source: "Open-Meteo forecast + OpenStreetMap waterways",
      place: name,
      score: risk.score,
      level: risk.level,
      evidence: risk.evidence,
      factors: risk.factors,
      shelters: shelters.map((s: { name: string; kind: string; distanceM: number }) => ({
        name: s.name,
        kind: s.kind,
        distanceM: s.distanceM,
      })),
    },
  };
}

/**
 * What the weather did at a place on any past date, scored by the live engine.
 *
 * Replaces a four-event replay catalogue. That catalogue could answer "would
 * this have caught Khaniyara?" and nothing else — a coordinator asking about
 * the 2018 Kerala floods, or simply about last August in their own district,
 * got nothing back, because their event was not one of four somebody had
 * hardcoded. The archive was never the limit; the dropdown was.
 */
async function pastWeather({
  place,
  from,
  to,
}: {
  place: string;
  from: string;
  to?: string;
}): Promise<ToolOutcome> {
  const loc = findLocality(place);
  const region = loc ? null : findRegion(place);
  if (!loc && !region) {
    return {
      summary:
        `No place in India matches "${place}", so there is nothing to look up. ` +
        `Ask for the district or state name instead — say that plainly rather than guessing at a location.`,
    };
  }

  const center = loc ? loc.center : region!.center;
  const name = loc ? loc.name : region!.name;

  // A date the archive cannot hold is a question worth refusing rather than
  // answering with the nearest thing it does have.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return { summary: `"${from}" is not a date I can look up. Give it as YYYY-MM-DD.` };
  }
  if (Number(from.slice(0, 4)) < 1940) {
    return { summary: `The archive starts in 1940, so ${from} is before anything on record.` };
  }

  let report;
  try {
    report = await historyFor(center[0], center[1], name, from, to);
  } catch (e) {
    // An unreachable archive is an outage, not an all-clear about the past.
    return { summary: e instanceof Error ? e.message : "The weather archive could not be reached." };
  }

  return {
    summary:
      `${report.headline} ${report.caveat}` +
      (loc?.note ? ` Recorded outcome at this location — ${loc.note}` : ""),
    panel: {
      panel: "timeline",
      title: `${name} — ${report.from}${to && to !== from ? ` to ${report.to}` : ""}`,
      subtitle:
        `${report.totalMm}mm total` +
        (report.peak ? ` · peak exposure ${report.peak.score}/100` : "") +
        (report.crossings.high ? " · crossed HIGH" : report.crossings.moderate ? " · crossed MODERATE" : ""),
      source: report.source,
      headline: report.headline,
      unit: "mm/h",
      // Hourly is too dense to read across a long range; a daily total is the
      // shape a person can actually see a storm in.
      points: dailyTotals(report.hours),
      marker: report.crossings.high
        ? { t: report.crossings.high.slice(0, 10), label: "HIGH" }
        : report.crossings.moderate
          ? { t: report.crossings.moderate.slice(0, 10), label: "MODERATE" }
          : undefined,
    },
  };
}

/** Hourly rainfall collapsed to one point per day. */
function dailyTotals(hours: { t: string; mm: number }[]): { t: string; v: number }[] {
  const byDay = new Map<string, number>();
  for (const h of hours) {
    const d = h.t.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + h.mm);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, v]) => ({ t, v: Math.round(v * 10) / 10 }));
}

function listHazards({ hazard }: { hazard: string }): ToolOutcome {
  const h = hazard.toLowerCase();
  const hits = STATES.filter((s) => (s.hazards ?? []).some((x) => x.includes(h) || h.includes(x)));
  if (!hits.length) return { summary: `No regions recorded for hazard "${hazard}".` };
  return {
    summary: `${hits.length} states record "${hazard}": ${hits.map((s) => s.name).join(", ")}.`,
    panel: {
      panel: "point_map",
      title: `Regions facing ${hazard}`,
      subtitle: `${hits.length} states`,
      source: "BhimShila hazard index",
      points: hits.map((s) => ({
        name: s.name,
        lat: s.center[0],
        lng: s.center[1],
        note: (s.hazards ?? []).join(", "),
      })),
    },
  };
}

