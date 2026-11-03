/**
 * Flash-flood exposure scoring — DELIBERATELY DETERMINISTIC.
 *
 * No LLM touches this file. The model handles language and delivery; it never
 * decides whether someone is in danger. A hallucinated risk score in a disaster
 * tool is a harm, not a bug.
 *
 * This is NOT a weather forecast. It translates public forecast data into a
 * point-level exposure score. Meteorology stays with IMD/CWC — we cite them.
 */

export interface RiskInput {
  /** mm of rain in the trailing 72h — saturated ground is the dominant driver */
  antecedent72h: number;
  /** mm forecast over the next 24h */
  next24h: number;
  /** peak hourly intensity in the next 24h, mm/h */
  peakIntensity: number;
  /** metres to the nearest mapped stream/river; null if unknown */
  waterwayDistanceM: number | null;
  elevationM: number | null;
}

export type RiskLevel = "low" | "moderate" | "high" | "severe";

export interface RiskFactor {
  label: string;
  detail: string;
  points: number;
}

export interface RiskResult {
  score: number; // 0-100
  level: RiskLevel;
  factors: RiskFactor[];
  /** Plain-language evidence line — every alert must state why */
  evidence: string;
}

// Explicit, readable weights. Tune these in one place, in the open.
const W = {
  antecedent: 30,
  forecast: 30,
  intensity: 25,
  proximity: 15,
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scoreRisk(input: RiskInput): RiskResult {
  const factors: RiskFactor[] = [];

  // Saturated ground: 0mm → 0, 150mm+ over 72h → full weight
  const antecedentRatio = clamp01(input.antecedent72h / 150);
  factors.push({
    label: "Ground saturation",
    detail: `${input.antecedent72h}mm fell in the past 72 hours`,
    points: Math.round(antecedentRatio * W.antecedent),
  });

  // Incoming volume: 100mm/24h is a serious day in the Himalayas
  const forecastRatio = clamp01(input.next24h / 100);
  factors.push({
    label: "Rain expected",
    detail: `${input.next24h}mm forecast in the next 24 hours`,
    points: Math.round(forecastRatio * W.forecast),
  });

  // Intensity matters more than volume for flash floods: 20mm/h is cloudburst territory
  const intensityRatio = clamp01(input.peakIntensity / 20);
  factors.push({
    label: "Peak intensity",
    detail: `${input.peakIntensity}mm/h at the heaviest hour`,
    points: Math.round(intensityRatio * W.intensity),
  });

  // Proximity to a watercourse: <100m is maximum exposure, >1500m negligible
  if (input.waterwayDistanceM !== null) {
    const d = input.waterwayDistanceM;
    const proximityRatio = d <= 100 ? 1 : d >= 1500 ? 0 : 1 - (d - 100) / 1400;
    factors.push({
      label: "Distance to watercourse",
      detail: `${d}m from the nearest stream or river`,
      points: Math.round(proximityRatio * W.proximity),
    });
  } else {
    factors.push({
      label: "Distance to watercourse",
      detail: "No mapped watercourse found nearby",
      points: 0,
    });
  }

  const score = Math.min(100, factors.reduce((a, f) => a + f.points, 0));
  const level: RiskLevel =
    score >= 70 ? "severe" : score >= 50 ? "high" : score >= 28 ? "moderate" : "low";

  const evidence =
    `${input.antecedent72h}mm has already fallen in the past two days` +
    ` and ${input.next24h}mm more is forecast in the next 24 hours` +
    (input.waterwayDistanceM !== null && input.waterwayDistanceM < 500
      ? `, ${input.waterwayDistanceM}m from a watercourse.`
      : ".");

  return { score, level, factors, evidence };
}

export const levelLabel: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
};
