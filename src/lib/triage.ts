/**
 * SOS triage — the deterministic core of intake.
 *
 * Split out from ops.ts on purpose. Everything here is pure: no database, no
 * network, no model. That is what lets it be exercised directly by the checks,
 * and it is the part that must keep working when nothing else does.
 *
 * The division of labour with the model is set out in reconcileSos below.
 */

export type SosCategory = "rescue" | "medical" | "food_water" | "shelter" | "missing" | "other";

export interface ParsedSos {
  category: SosCategory;
  severity: number; // 1..5
  peopleCount: number | null;
  place: string | null;
  summary: string;
}

export const CATEGORIES: SosCategory[] = ["rescue", "medical", "food_water", "shelter", "missing", "other"];

/**
 * Keyword fallback — an SOS must never be lost because a model was unavailable.
 *
 * This is not a nice-to-have: it is what runs when the network is strained,
 * which is exactly when the real emergencies arrive. Two things it has to get
 * right, both learned from misclassifying real phrasing:
 *
 *  - Transliteration varies wildly. फंसे is written phans, phase, phanse,
 *    fanse; डूब is doob or dub. Matching one spelling silently drops the rest.
 *  - "paani" means drowning far more often than thirst. Water *intruding*
 *    ("paani ghar me ghus gaya", "paani bhar gaya") is a rescue; water being
 *    *absent* ("paani nahi mila", "pine ka paani") is a supply need. Treating
 *    every mention as food_water downgrades a drowning to a supply drop.
 */
export function parseHeuristically(message: string): ParsedSos {
  const t = message.toLowerCase();
  const has = (...ws: string[]) => ws.some((w) => t.includes(w));

  const trapped = has(
    "trapped", "stuck", "phans", "phase", "phanse", "fanse", "fase",
    "chhat pe", "chhat par", "chat pe", "roof", "छत", "फंस",
  );
  const drowning = has(
    "drown", "doob", "dub ", "beh gaya", "bah gaya", "beh gayi", "swept",
    "बह", "बाढ़", "डूब",
  );
  // Water arriving, not water needed.
  const waterRising = has(
    "paani bhar", "pani bhar", "paani ghus", "pani ghus", "paani aa gaya",
    "water rising", "water entered", "flood", "baadh", "badh gaya",
  );
  // Water asked for.
  const waterNeeded = has(
    "paani nahi", "pani nahi", "pine ka paani", "drinking water", "no water",
    "khana nahi", "food nahi", "bhookh", "भूख", "hungry", "ration", "supplies",
  );

  const category: SosCategory = trapped || drowning || waterRising
    ? "rescue"
    : has("injur", "chot", "bleed", "khoon", "medicine", "dawa", "hospital", "doctor", "ambulance", "घायल")
      ? "medical"
      : has("missing", "lapata", "गुम", "not found", "nahi mil raha")
        ? "missing"
        : waterNeeded
          ? "food_water"
          : has("shelter", "camp", "makan", "ghar tut", "roof gone")
            ? "shelter"
            : "other";

  // Water arriving is as life-threatening as being trapped in it — treating it
  // as merely urgent buries a drowning below an injury.
  const severity =
    drowning || trapped || waterRising || has("dying", "critical", "serious", "khoon beh")
      ? 5
      : has("injur", "urgent", "jaldi", "turant", "chot", "ambulance")
        ? 4
        : category === "rescue" || category === "medical" || category === "missing"
          ? 4
          : 2;

  const num = /(\d+)\s*(?:log|people|persons|bacche|children|families|parivar|aadmi)/i.exec(message);

  return {
    category,
    severity,
    peopleCount: num ? Number(num[1]) : null,
    place: null,
    summary: message.slice(0, 140),
  };
}

/** Categories where being wrong costs a life, so keywords get the final word. */
export const LIFE_SAFETY: SosCategory[] = ["rescue", "medical", "missing"];

/**
 * Merge the model's reading with the keyword parser's.
 *
 * The model is better at free text — pulling a place name out of a sentence,
 * counting people, writing a clean English summary. It is not better at
 * deciding urgency, and it does not get to. Asked to structure "paani ghar me
 * ghus gaya, chhat pe phase hain" it answered `shelter`, severity 4: people
 * trapped on a roof by rising water, filed as a request for accommodation. In
 * the priority queue that buries a drowning below a supply run.
 *
 * So category and severity resolve deterministically. The keyword parser is a
 * floor, not a tiebreak: when it positively recognises a life-safety case the
 * model cannot downgrade it, and severity only ever moves up. Where the
 * keywords have nothing to say, the model's reading stands.
 */
export function reconcileSos(keywords: ParsedSos, model: ParsedSos): ParsedSos {
  const keywordIsCertain = LIFE_SAFETY.includes(keywords.category);
  return {
    category: keywordIsCertain ? keywords.category : model.category,
    severity: Math.max(keywords.severity, model.severity),
    // Free text is the model's job — fall back only when it returns nothing.
    peopleCount: model.peopleCount ?? keywords.peopleCount,
    place: model.place ?? keywords.place,
    summary: model.summary || keywords.summary,
  };
}
