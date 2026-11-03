/**
 * The panel contract.
 *
 * The model NEVER generates UI. It picks a `panel` from this fixed set and the
 * frontend renders the matching hand-built component. That is what keeps the
 * generative dashboard fast, reliable, and on-palette.
 */

export type PanelKind =
  | "choropleth"
  | "region_card"
  | "ranked_list"
  | "risk_card"
  | "timeline"
  | "point_map"
  | "incident_board"
  | "confirm_action"
  | "protocol_card"
  | "note";

export interface PanelBase {
  panel: PanelKind;
  title: string;
  subtitle?: string;
  /** Provenance — anything spoken aloud must be attributable */
  source?: string;
  /**
   * The one sentence worth saying out loud about this panel.
   *
   * Set it when the most important fact is not simply the top row — a situation
   * report's headline is the red alerts the government has issued, not whichever
   * district our own scan happened to score highest. Used verbatim by the spoken
   * fallback, so the answer stays right even with every model unavailable.
   */
  headline?: string;
}

export interface ChoroplethPanel extends PanelBase {
  panel: "choropleth";
  metric: string;
  unit: string;
  features: { id: string; name: string; value: number; center: [number, number] }[];
}

export interface RegionCardPanel extends PanelBase {
  panel: "region_card";
  region: {
    name: string;
    level: string;
    population: number;
    density: number;
    areaKm2: number;
    literacyPct?: number;
    hazards: string[];
    center: [number, number];
  };
  facts: { label: string; value: string }[];
}

export interface RankedListPanel extends PanelBase {
  panel: "ranked_list";
  unit: string;
  rows: { name: string; value: number; note?: string }[];
}

export interface RiskCardPanel extends PanelBase {
  panel: "risk_card";
  place: string;
  score: number;
  level: string;
  evidence: string;
  factors: { label: string; detail: string; points: number }[];
  shelters?: { name: string; kind: string; distanceM: number }[];
}

export interface TimelinePanel extends PanelBase {
  panel: "timeline";
  unit: string;
  points: { t: string; v: number }[];
  marker?: { t: string; label: string };
}

export interface PointMapPanel extends PanelBase {
  panel: "point_map";
  points: {
    name: string;
    lat: number;
    lng: number;
    /** Status step, or an IMD alert colour. Drives the fill. */
    level?: string;
    /** Hazard family — drives the glyph, so severity never rests on colour alone. */
    kind?: string;
    note?: string;
  }[];
  /** Rendered under the map when the points carry status. */
  legend?: { label: string; level: string }[];
}

export interface IncidentBoardPanel extends PanelBase {
  panel: "incident_board";
  incidents: {
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
  }[];
}

/**
 * A staged write. The panel renders what is about to happen and the buttons
 * that approve or cancel it — nothing outward-facing fires from a voice parse
 * alone.
 */
export interface ConfirmActionPanel extends PanelBase {
  panel: "confirm_action";
  kind: "alert" | "dispatch" | "resolve";
  request: Record<string, unknown>;
  lines: { label: string; value: string }[];
}

export interface ProtocolCardPanel extends PanelBase {
  panel: "protocol_card";
  entries: { title: string; body: string; source: string; reference: string }[];
}

export interface NotePanel extends PanelBase {
  panel: "note";
  body: string;
}

export type Panel =
  | ChoroplethPanel
  | RegionCardPanel
  | RankedListPanel
  | RiskCardPanel
  | TimelinePanel
  | PointMapPanel
  | IncidentBoardPanel
  | ConfirmActionPanel
  | ProtocolCardPanel
  | NotePanel;
