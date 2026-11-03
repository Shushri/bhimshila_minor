import { findRegion, findLocality, type Metric } from "@/lib/kb/regions";

/**
 * Deterministic intent router.
 *
 * Asking a model "which tool should I call?" costs ~1,470 tokens of schemas on
 * every turn and is the single reason free tiers rate-limit us mid-demo. But
 * most of these questions are not ambiguous — "abhi kya chal raha hai" is a
 * situation report every single time. Matching those directly is free, instant,
 * and cannot be rate-limited.
 *
 * So the model is not the router. It is the fallback router (for genuinely
 * ambiguous phrasing) and the narrator (for the sentence the user hears). This
 * is the same split already used elsewhere: deterministic where the answer is
 * knowable, model where language is the hard part.
 *
 * A miss here costs nothing — it falls through to the model. So the rules stay
 * conservative: match only when the intent is unmistakable.
 */

export interface RoutedCall {
  name: string;
  args: Record<string, unknown>;
  /** Why it matched — shown in the tool chip and useful when tuning. */
  via: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const any = (t: string, ...ws: string[]) => ws.some((w) => t.includes(w));

/** ISO date, or a natural "21 July 2025" / "26 june 2025". */
function extractDate(t: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return iso[0];

  const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
  const m = /(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3,9})\s+(\d{4})/.exec(t);
  if (m) {
    const mi = months.findIndex((x) => m[2].startsWith(x));
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Pull a place name out of a question.
 *
 * Deliberately narrow: only the words attached to a location preposition, and
 * only when they are Capitalised or the phrasing is unambiguous. Guessing a
 * place wrong is worse than not matching at all, because the wrong district
 * gets assessed.
 */
function extractPlace(raw: string): string | null {
  const cleaned = raw.replace(/[?.,!]/g, " ");

  /**
   * A candidate only counts if it is somewhere real.
   *
   * Without this the patterns below happily returned "Monsoon Patterns",
   * "Climate Change" and "Global Warming" as places, and the router sent them
   * to a region lookup — so a question about climate came back as a district
   * profile. Everything here falls through to the model when it returns null,
   * which is the right home for a question that names no place.
   */
  const real = (name: string | undefined | null): string | null => {
    const t = name?.trim();
    if (!t || isCommandWord(t)) return null;
    return findRegion(t) || findLocality(t) ? t : null;
  };

  // A place the speaker labelled as a district wins over everything else.
  //
  // "Madhya Pradesh ke Indore district mein kya update hai" names two places,
  // and the state comes first — so every other pattern here picked Madhya
  // Pradesh and the answer covered 52 districts without mentioning the one that
  // was asked about. Someone who says "district" has told us which of the two
  // they mean.
  // No `i` flag: it would make [A-Z] match lowercase too, and "Madhya Pradesh
  // ke Indore district" came back as "ke Indore". The label itself is spelled
  // both ways instead.
  const labelled =
    /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+(?:[Dd]istrict|[Zz]ila|[Jj]ila|[Zz]ile|[Jj]ile)\b/.exec(
      cleaned,
    );
  const labelledPlace = real(labelled?.[1]);
  if (labelledPlace) return labelledPlace;

  // "risk in Kerala", "Kangra ka risk", "about Thrissur"
  const patterns = [
    // after a verb that takes a place directly: "replay Khaniyara", "verify Kerala"
    /\b(?:replay|verify|assess|check|rewind)\s+([A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/i,
    /\b(?:in|at|for|about|of|on)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/,
    /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+(?:ka|ki|ke|ko|me|mein|men)\b/,
    /\b(?:tell me about|batao|info about|details of)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
  ];
  for (const p of patterns) {
    const m = p.exec(cleaned);
    // Trim a trailing preposition the pattern may have swallowed:
    // "replay Khaniyara on <date>" must yield "Khaniyara", not "Khaniyara on".
    const candidate = real(m?.[1]?.trim().replace(/\s+(?:on|in|at|for|ka|ki|ke|ko)$/i, ""));
    if (candidate) return candidate;
  }

  // Last resort: a lone capitalised word that is not a command. Only when the
  // query is short, so a long sentence cannot accidentally donate a place.
  if (cleaned.split(/\s+/).length <= 5) {
    const caps = cleaned.match(/\b[A-Z][A-Za-z]{2,}\b/g) ?? [];
    const hit = caps.map(real).find(Boolean);
    if (hit) return hit;
  }
  return null;
}

/** Words that look like places to a regex but are instructions. */
function isCommandWord(w: string): boolean {
  return /^(the|what|which|how|send|show|give|tell|abhi|kya|kaun|kahan|nearest|team|alert|risk|status|update|india|replay|verify|assess|check|dispatch|incident|news|protocol)$/i.test(
    w.trim(),
  );
}

export function route(query: string): RoutedCall | null {
  const t = norm(query);
  if (!t) return null;

  // ── A greeting is not a question
  //
  // The system prompt pushes hard towards calling a tool, and left to itself
  // the model answered "hello" with the incident board — the first thing a
  // demo sees is eight open emergencies it never asked about. There is nothing
  // to look up here; say what this can do and wait.
  if (/^(hi|hey|hello|namaste|namaskar|helo|yo|salaam|hola)\b[\s!.,]*$/.test(t)) {
    return { name: "greet", args: {}, via: "greeting" };
  }

  // ── Situation report: what is happening, here or everywhere
  //
  // A named place is passed through rather than dropped. Asking "Indore mein
  // kya update hai" used to sweep all of India and lead with whichever district
  // scored highest, which could be two states away.
  if (
    any(t, "what's the update", "whats the update", "what is the update", "any update",
      "abhi kya chal raha", "kya chal raha hai", "kya update hai", "update kya hai",
      "status batao", "sitrep", "situation report", "brief me", "anything happening",
      "kya haal hai", "kya ho raha", "what is happening", "whats happening")
  ) {
    const place = extractPlace(query);
    return {
      name: "situation_report",
      args: place ? { state: place } : {},
      via: place ? `status question · ${place}` : "status question",
    };
  }

  // ── The past: a date is decisive on its own
  //
  // It used to need a replay word alongside it — "replay Kerala on 2018-08-16"
  // — which is not how anyone asks. A date plus a place is already an
  // unambiguous question about the past, and the archive covers every one of
  // them back to 1940 rather than the four events that used to be hardcoded.
  const date = extractDate(t);
  if (date) {
    const place = extractPlace(query);
    if (place) return { name: "past_weather", args: { place, from: date }, via: "date + place" };
  }

  // ── Dispatch — but only when it reads as a command, not a question
  //
  // "bhej do" used to be enough to match here, which meant "Himachal ke logon
  // ko alert bhej do" — warn the people of Himachal — routed to dispatch and
  // returned a card offering to send NDRF to an unrelated incident in Patna.
  // Sending a team where a broadcast was asked for is not a near miss; it is
  // the wrong action taken confidently. So a bare "send" now needs something
  // team-shaped next to it, and any mention of an alert disqualifies it
  // outright.
  const mentionsAlert = any(t, "alert", "chetavni", "warn", "warning");
  if (
    !mentionsAlert &&
    any(t, "dispatch", "send the nearest", "send nearest", "nearest team", "team bhejo",
      "team bhej", "rescue team", "team bhej do", "teams bhejo", "ndrf", "sdrf", "rescue bhejo")
  ) {
    const id = /(?:incident\s*#?|#)(\d+)/.exec(t);
    return {
      name: "dispatch_team",
      args: id ? { incident_id: Number(id[1]) } : {},
      via: "dispatch command",
    };
  }

  // ── Incidents / SOS board
  if (
    any(t, "incident", "sos", "emergenc", "who needs help", "kaun madad",
      "priority list", "unassigned", "open cases")
    && !any(t, "resolve", "close", "band kar", "ho gaya")
  ) {
    return { name: "list_incidents", args: {}, via: "incident board" };
  }


  // ── Alert: reading what authorities have issued, vs. sending one of our own.
  //
  // These two share almost every keyword, and confusing them is the expensive
  // mistake: "sarkari chetavni dikhao" is a question, but if it lands on
  // prepare_alert the user gets a staged broadcast instead of an answer. So the
  // send command is recognised first and narrowly — an explicit imperative —
  // and everything else about alerts is treated as a question.
  const sendCommand = any(t, "send alert", "alert bhejo", "alert bhej", "bhejo", "bhej do",
    "notify people", "broadcast", "warn ");
  // "chetavni" is not an authority cue — it is simply the Hindi for "warning",
  // and it appears in both "sarkari chetavni dikhao" (a question) and "chetavni
  // bhej do" (a command). What marks the question is who issued it: sarkari,
  // NDMA, an SDMA. Treating the bare word as a cue routed "Kerala ke logon ko
  // chetavni bhej do" to a lookup instead of staging the broadcast.
  const authorityCue = any(t, "official", "sarkari", "ndma", "sachet", "imd alert",
    "government warning", "govt warning", "issued", "authority", "sdma");
  const existenceCue = any(t, "koi alert", "any alert", "alert hai", "alert issued",
    "warning hai", "kya alert", "which alert", "alerts live", "live alert", "active alert",
    "alert list", "alert kahan", "alert kaha");
  // A bare colour is ambiguous — "red alert kya hota hai" asks what the colour
  // MEANS (protocol), "red alert kahan hai" asks which are LIVE. Only the
  // second reading routes here; the first falls through to the protocol rule.
  const colourMatch = /\b(red|orange|yellow)\s+alert/.exec(t);
  const colourIsLocational =
    !!colourMatch && any(t, "kahan", "kaha", "where", "kaun", "which", "list", "abhi", "live", "now");

  if (sendCommand && !authorityCue && !existenceCue) {
    const place = extractPlace(query);
    return { name: "prepare_alert", args: place ? { region: place } : {}, via: "alert command" };
  }

  if (authorityCue || existenceCue || colourIsLocational) {
    const place = extractPlace(query);
    return {
      name: "official_alerts",
      args: {
        ...(place ? { place } : {}),
        ...(colourMatch ? { colour: colourMatch[1] } : {}),
      },
      via: "official alert query",
    };
  }

  // ── Where to go
  //
  // Above protocol on purpose: "paani aa raha hai kahan jaun" is both a hazard
  // question and a destination question, and the destination is the urgent
  // half. Until this existed the entire offline shelter bundle was unreachable
  // by voice — asking where to go returned a lightning protocol card.
  if (
    any(t, "kahan jaun", "kaha jaun", "kahan jau", "where do i go", "where should i go",
      "nearest shelter", "shelter kahan", "shelter kaha", "safe jagah", "safe place",
      "evacuat", "kahan jana", "sharan", "shivir kahan", "closest shelter", "shelter")
  ) {
    const place = extractPlace(query);
    if (place) return { name: "find_shelter", args: { place }, via: "shelter question" };
  }

  // ── Protocol, entitlements, and "what do I do"
  //
  // The second half of this is the one that was missing. A coordinator asks
  // about procedure and compensation in those words; a person in the middle of
  // it asks "kya karun" and never says "protocol" at all. Both land here — the
  // lookup decides which audience's answer to return.
  if (
    any(t, "protocol", "sop", "procedure", "prakriya", "guideline",
      "muavza", "muaawza", "compensation", "entitle", "kitna milta", "kitna milega",
      "alert colour", "alert color", "orange alert", "red alert", "yellow alert",
      "camp standard", "relief norm") ||
    any(t, "kya karun", "kya karein", "kya karna", "kya karoon", "what should i do",
      "what do i do", "how do i", "what to do", "should i", "safe hoon", "bachne ke liye",
      "kaise bachu", "kaise bachein", "madad kaise", "how to stay safe", "precaution",
      "savdhani", "do's and don'ts", "dos and donts")
  ) {
    return { name: "lookup_protocol", args: { question: query }, via: "protocol question" };
  }

  // ── Verification
  if (any(t, "verify", "confirm", "is it real", "sach hai", "actually happening", "double check")) {
    const place = extractPlace(query);
    if (place) return { name: "verify_signal", args: { place }, via: "verification request" };
  }

  // ── News
  if (any(t, "news", "khabar", "headline", "media", "report kar raha")) {
    return { name: "search_news", args: {}, via: "news question" };
  }

  // ── Hazard map
  const hazards = ["landslide", "flood", "cyclone", "cloudburst", "heatwave", "earthquake", "drought"];
  const hazard = hazards.find((h) => t.includes(h));
  if (hazard && any(t, "which state", "which region", "kaun se state", "kahan hota", "where do")) {
    return { name: "list_hazards", args: { hazard }, via: "hazard map" };
  }

  // ── Live risk for a named place
  if (any(t, "risk", "khatra", "danger", "safe hai", "flood risk", "exposure")) {
    const place = extractPlace(query);
    if (place) return { name: "assess_risk", args: { place }, via: "risk question" };
  }

  // ── Density / ranking
  const wantsRanking = any(t, "top ", "rank", "sabse zyada", "sabse kam", "most ", "highest", "lowest");
  const metric: Metric | null = any(t, "densit", "bheed", "crowd", "ghani")
    ? "density"
    : any(t, "population", "abadi", "aabadi", "log rehte")
      ? "population"
      : any(t, "literac", "padhe", "saakshar")
        ? "literacy"
        : null;

  if (metric) {
    return wantsRanking
      ? { name: "rank_regions", args: { metric }, via: "ranking question" }
      : { name: "region_density", args: { metric }, via: "metric map" };
  }

  // ── Profile of a named place, as a last resort before deferring
  if (any(t, "tell me about", "batao", "info about", "details of", "ke baare me")) {
    const place = extractPlace(query);
    if (place) return { name: "region_profile", args: { region: place }, via: "place profile" };
  }

  return null; // ambiguous — let the model decide
}
