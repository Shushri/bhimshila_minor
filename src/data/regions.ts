/**
 * Region knowledge base — structural layer.
 *
 * Every row carries `source` and `asOf` so any figure the agent speaks aloud can
 * be attributed. Population/area/density are Census 2011 (the last completed
 * Indian census; 2021 was deferred). Verify against censusindia.gov.in before
 * submission — see DATA_SOURCES.md.
 *
 * Live signals (rainfall, elevation, waterways, facilities) are NOT stored here.
 * They are queried on demand — see lib/kb/openmeteo.ts and lib/kb/overpass.ts.
 */

export type RegionLevel = "state" | "district";

export interface Region {
  id: string;
  name: string;
  level: RegionLevel;
  parentId?: string;
  /** [lat, lng] centroid */
  center: [number, number];
  areaKm2: number;
  population: number;
  /** persons per km² */
  density: number;
  literacyPct?: number;
  /** Dominant hazard classes, used to scope protocol lookups */
  hazards?: string[];
  source: string;
  asOf: string;
}

const C = "Census of India 2011";
const Y = "2011";

export const STATES: Region[] = [
  { id: "up", name: "Uttar Pradesh", level: "state", center: [26.85, 80.95], areaKm2: 240928, population: 199812341, density: 829, literacyPct: 67.7, hazards: ["flood", "heatwave", "drought"], source: C, asOf: Y },
  { id: "mh", name: "Maharashtra", level: "state", center: [19.75, 75.71], areaKm2: 307713, population: 112374333, density: 365, literacyPct: 82.3, hazards: ["flood", "drought", "cyclone"], source: C, asOf: Y },
  { id: "br", name: "Bihar", level: "state", center: [25.6, 85.5], areaKm2: 94163, population: 104099452, density: 1106, literacyPct: 61.8, hazards: ["flood", "heatwave"], source: C, asOf: Y },
  { id: "wb", name: "West Bengal", level: "state", center: [22.98, 87.85], areaKm2: 88752, population: 91276115, density: 1028, literacyPct: 76.3, hazards: ["cyclone", "flood"], source: C, asOf: Y },
  { id: "mp", name: "Madhya Pradesh", level: "state", center: [23.47, 77.95], areaKm2: 308252, population: 72626809, density: 236, literacyPct: 69.3, hazards: ["drought", "flood"], source: C, asOf: Y },
  { id: "tn", name: "Tamil Nadu", level: "state", center: [11.13, 78.66], areaKm2: 130058, population: 72147030, density: 555, literacyPct: 80.1, hazards: ["cyclone", "flood", "drought"], source: C, asOf: Y },
  { id: "rj", name: "Rajasthan", level: "state", center: [27.02, 74.22], areaKm2: 342239, population: 68548437, density: 200, literacyPct: 66.1, hazards: ["drought", "heatwave"], source: C, asOf: Y },
  { id: "ka", name: "Karnataka", level: "state", center: [15.32, 75.71], areaKm2: 191791, population: 61095297, density: 319, literacyPct: 75.4, hazards: ["flood", "drought"], source: C, asOf: Y },
  { id: "gj", name: "Gujarat", level: "state", center: [22.26, 71.19], areaKm2: 196244, population: 60439692, density: 308, literacyPct: 78.0, hazards: ["cyclone", "earthquake", "drought"], source: C, asOf: Y },
  { id: "ap", name: "Andhra Pradesh", level: "state", center: [15.91, 79.74], areaKm2: 162968, population: 49577103, density: 304, literacyPct: 67.4, hazards: ["cyclone", "flood"], source: C, asOf: Y },
  { id: "or", name: "Odisha", level: "state", center: [20.95, 85.1], areaKm2: 155707, population: 41974218, density: 270, literacyPct: 72.9, hazards: ["cyclone", "flood"], source: C, asOf: Y },
  { id: "tg", name: "Telangana", level: "state", center: [17.12, 79.02], areaKm2: 112077, population: 35003674, density: 312, literacyPct: 66.5, hazards: ["heatwave", "flood"], source: C, asOf: Y },
  { id: "kl", name: "Kerala", level: "state", center: [10.85, 76.27], areaKm2: 38863, population: 33406061, density: 860, literacyPct: 94.0, hazards: ["flood", "landslide"], source: C, asOf: Y },
  { id: "jh", name: "Jharkhand", level: "state", center: [23.61, 85.28], areaKm2: 79716, population: 32988134, density: 414, literacyPct: 66.4, hazards: ["drought", "flood"], source: C, asOf: Y },
  { id: "as", name: "Assam", level: "state", center: [26.2, 92.94], areaKm2: 78438, population: 31205576, density: 398, literacyPct: 72.2, hazards: ["flood", "landslide", "earthquake"], source: C, asOf: Y },
  { id: "pb", name: "Punjab", level: "state", center: [31.15, 75.34], areaKm2: 50362, population: 27743338, density: 551, literacyPct: 75.8, hazards: ["flood"], source: C, asOf: Y },
  { id: "ct", name: "Chhattisgarh", level: "state", center: [21.28, 81.87], areaKm2: 135192, population: 25545198, density: 189, literacyPct: 70.3, hazards: ["flood", "drought"], source: C, asOf: Y },
  { id: "hr", name: "Haryana", level: "state", center: [29.06, 76.09], areaKm2: 44212, population: 25351462, density: 573, literacyPct: 75.6, hazards: ["flood", "heatwave"], source: C, asOf: Y },
  { id: "dl", name: "Delhi", level: "state", center: [28.65, 77.2], areaKm2: 1483, population: 16787941, density: 11320, literacyPct: 86.2, hazards: ["heatwave", "flood", "earthquake"], source: C, asOf: Y },
  { id: "jk", name: "Jammu & Kashmir", level: "state", center: [33.78, 76.58], areaKm2: 42241, population: 12541302, density: 297, literacyPct: 67.2, hazards: ["earthquake", "flood", "landslide", "avalanche"], source: C, asOf: Y },
  { id: "uk", name: "Uttarakhand", level: "state", center: [30.07, 79.09], areaKm2: 53483, population: 10086292, density: 189, literacyPct: 78.8, hazards: ["landslide", "flash flood", "cloudburst", "earthquake"], source: C, asOf: Y },
  { id: "hp", name: "Himachal Pradesh", level: "state", center: [31.9, 77.17], areaKm2: 55673, population: 6864602, density: 123, literacyPct: 82.8, hazards: ["landslide", "flash flood", "cloudburst", "earthquake"], source: C, asOf: Y },
  { id: "tr", name: "Tripura", level: "state", center: [23.94, 91.99], areaKm2: 10486, population: 3673917, density: 350, literacyPct: 87.2, hazards: ["flood", "earthquake"], source: C, asOf: Y },
  { id: "ml", name: "Meghalaya", level: "state", center: [25.47, 91.37], areaKm2: 22429, population: 2966889, density: 132, literacyPct: 74.4, hazards: ["landslide", "flood"], source: C, asOf: Y },
  { id: "mn", name: "Manipur", level: "state", center: [24.66, 93.91], areaKm2: 22327, population: 2855794, density: 128, literacyPct: 76.9, hazards: ["earthquake", "landslide"], source: C, asOf: Y },
  { id: "nl", name: "Nagaland", level: "state", center: [26.16, 94.56], areaKm2: 16579, population: 1978502, density: 119, literacyPct: 79.6, hazards: ["landslide", "earthquake"], source: C, asOf: Y },
  { id: "ga", name: "Goa", level: "state", center: [15.3, 74.12], areaKm2: 3702, population: 1458545, density: 394, literacyPct: 88.7, hazards: ["flood", "cyclone"], source: C, asOf: Y },
  { id: "ar", name: "Arunachal Pradesh", level: "state", center: [28.22, 94.73], areaKm2: 83743, population: 1383727, density: 17, literacyPct: 65.4, hazards: ["landslide", "earthquake", "flood"], source: C, asOf: Y },
  { id: "py", name: "Puducherry", level: "state", center: [11.94, 79.81], areaKm2: 479, population: 1247953, density: 2605, literacyPct: 85.8, hazards: ["cyclone", "flood"], source: C, asOf: Y },
  { id: "mz", name: "Mizoram", level: "state", center: [23.16, 92.94], areaKm2: 21081, population: 1097206, density: 52, literacyPct: 91.3, hazards: ["landslide", "earthquake"], source: C, asOf: Y },
  { id: "ch", name: "Chandigarh", level: "state", center: [30.73, 76.78], areaKm2: 114, population: 1055450, density: 9258, literacyPct: 86.0, hazards: ["earthquake"], source: C, asOf: Y },
  { id: "sk", name: "Sikkim", level: "state", center: [27.53, 88.51], areaKm2: 7096, population: 610577, density: 86, literacyPct: 81.4, hazards: ["earthquake", "landslide", "glacial lake outburst"], source: C, asOf: Y },
  { id: "dh", name: "Dadra & Nagar Haveli and Daman & Diu", level: "state", center: [20.27, 73.02], areaKm2: 603, population: 586956, density: 973, literacyPct: 76.2, hazards: ["cyclone", "flood"], source: C, asOf: Y },
  { id: "an", name: "Andaman & Nicobar Islands", level: "state", center: [11.74, 92.66], areaKm2: 8249, population: 380581, density: 46, literacyPct: 86.6, hazards: ["tsunami", "earthquake", "cyclone"], source: C, asOf: Y },
  { id: "la", name: "Ladakh", level: "state", center: [34.2, 77.6], areaKm2: 59146, population: 274000, density: 5, literacyPct: 77.2, hazards: ["flash flood", "avalanche", "earthquake"], source: C, asOf: Y },
  { id: "ld", name: "Lakshadweep", level: "state", center: [10.57, 72.64], areaKm2: 32, population: 64473, density: 2013, literacyPct: 91.8, hazards: ["cyclone", "tsunami"], source: C, asOf: Y },
];

/** Pilot district set — Himachal Pradesh, fully enumerated. */
export const DISTRICTS: Region[] = [
  { id: "hp-kangra", name: "Kangra", level: "district", parentId: "hp", center: [32.1, 76.27], areaKm2: 5739, population: 1510075, density: 263, literacyPct: 85.7, hazards: ["flash flood", "cloudburst", "landslide", "earthquake"], source: C, asOf: Y },
  { id: "hp-mandi", name: "Mandi", level: "district", parentId: "hp", center: [31.71, 76.93], areaKm2: 3950, population: 999777, density: 253, literacyPct: 81.5, hazards: ["flash flood", "cloudburst", "landslide"], source: C, asOf: Y },
  { id: "hp-shimla", name: "Shimla", level: "district", parentId: "hp", center: [31.1, 77.17], areaKm2: 5131, population: 814010, density: 159, literacyPct: 84.6, hazards: ["landslide", "cloudburst", "snowstorm"], source: C, asOf: Y },
  { id: "hp-solan", name: "Solan", level: "district", parentId: "hp", center: [30.92, 77.1], areaKm2: 1936, population: 580320, density: 300, literacyPct: 83.7, hazards: ["landslide", "flash flood"], source: C, asOf: Y },
  { id: "hp-sirmaur", name: "Sirmaur", level: "district", parentId: "hp", center: [30.72, 77.51], areaKm2: 2825, population: 529855, density: 188, literacyPct: 78.8, hazards: ["flash flood", "landslide"], source: C, asOf: Y },
  { id: "hp-una", name: "Una", level: "district", parentId: "hp", center: [31.47, 76.27], areaKm2: 1540, population: 521173, density: 338, literacyPct: 86.5, hazards: ["flood", "heatwave"], source: C, asOf: Y },
  { id: "hp-chamba", name: "Chamba", level: "district", parentId: "hp", center: [32.56, 76.13], areaKm2: 6522, population: 519080, density: 80, literacyPct: 72.2, hazards: ["landslide", "flash flood", "avalanche"], source: C, asOf: Y },
  { id: "hp-hamirpur", name: "Hamirpur", level: "district", parentId: "hp", center: [31.68, 76.52], areaKm2: 1118, population: 454768, density: 407, literacyPct: 88.2, hazards: ["flash flood", "landslide"], source: C, asOf: Y },
  { id: "hp-kullu", name: "Kullu", level: "district", parentId: "hp", center: [31.96, 77.11], areaKm2: 5503, population: 437903, density: 80, literacyPct: 79.4, hazards: ["cloudburst", "flash flood", "landslide", "avalanche"], source: C, asOf: Y },
  { id: "hp-bilaspur", name: "Bilaspur", level: "district", parentId: "hp", center: [31.34, 76.76], areaKm2: 1167, population: 381956, density: 327, literacyPct: 84.6, hazards: ["flash flood", "landslide"], source: C, asOf: Y },
  { id: "hp-kinnaur", name: "Kinnaur", level: "district", parentId: "hp", center: [31.58, 78.44], areaKm2: 6401, population: 84121, density: 13, literacyPct: 80.0, hazards: ["landslide", "avalanche", "glacial lake outburst"], source: C, asOf: Y },
  { id: "hp-lahaul", name: "Lahaul & Spiti", level: "district", parentId: "hp", center: [32.57, 77.02], areaKm2: 13835, population: 31564, density: 2, literacyPct: 76.8, hazards: ["avalanche", "flash flood", "glacial lake outburst"], source: C, asOf: Y },
];

/** Named sub-district locations that matter operationally. */
export interface Locality {
  id: string;
  name: string;
  districtId: string;
  center: [number, number];
  note?: string;
}

export const LOCALITIES: Locality[] = [
  /*
   * Places people name when they ask about the past.
   *
   * These used to live in a hardcoded replay catalogue of four disasters. The
   * catalogue is gone — the archive covers every place and every date back to
   * 1940, so the dropdown was the only thing limiting it. What was worth
   * keeping is the names: somebody asking "what happened at Kedarnath in 2013"
   * is naming a temple, not a district, and no census file contains it.
   *
   * The notes are what the archive cannot tell you — what actually happened to
   * people there — and they are quoted back alongside the rainfall so a score
   * is never the whole answer.
   */
  {
    id: "kedarnath",
    name: "Kedarnath",
    districtId: "rudraprayag",
    center: [30.735, 79.067],
    note:
      "Mandakini valley. 16 June 2013 — a moraine-dammed lake above the town burst after days of rain and took most of Kedarnath with it; " +
      "roughly 5,000 dead or missing across Uttarakhand, one of the largest evacuations in Indian history at 108,653 people. " +
      "The temple survived because a boulder came to rest behind it and split the water. This product is named after that rock.",
  },
  {
    id: "mundakkai",
    name: "Mundakkai",
    districtId: "wayanad",
    center: [11.47, 76.13],
    note:
      "Western Ghats, Wayanad. 30 July 2024 — landslides buried Mundakkai and Chooralmala, over 260 dead. " +
      "Rainfall warnings were issued; the villages had been flagged as high-sensitivity landslide zones in official assessments as early as 2020, and no evacuation followed.",
  },
  {
    id: "chooralmala",
    name: "Chooralmala",
    districtId: "wayanad",
    center: [11.46, 76.14],
    note: "Wayanad. Buried alongside Mundakkai in the landslides of 30 July 2024.",
  },
  {
    id: "khaniyara",
    name: "Khaniyara",
    districtId: "hp-kangra",
    center: [32.19, 76.36],
    note:
      "Manuni rivulet catchment. Flash flood 26 June 2025 — labourers in temporary sheds swept away; 2 dead, 6 missing, despite a red alert in force for Kangra district. " +
      "Verified against Open-Meteo archive: the 26 June cloudburst is sub-grid-scale and does not appear in reanalysis (scores 37/100). " +
      "The worst window the engine finds here is 21 July 2025 at 124.7mm antecedent / 93.3mm incoming / 23.4mm-h peak — 91/100, severe. " +
      "That gap is the argument for ground verification, not against the engine.",
  },
  { id: "dharamshala", name: "Dharamshala", districtId: "hp-kangra", center: [32.22, 76.32] },
  { id: "mcleodganj", name: "McLeod Ganj", districtId: "hp-kangra", center: [32.24, 76.32] },
  { id: "palampur", name: "Palampur", districtId: "hp-kangra", center: [32.11, 76.54] },
  { id: "manali", name: "Manali", districtId: "hp-kullu", center: [32.24, 77.19] },
  { id: "thunag", name: "Thunag", districtId: "hp-mandi", center: [31.53, 77.15], note: "Severely affected in the July 2025 Mandi cloudburst cluster." },
];

export const ALL_REGIONS: Region[] = [...STATES, ...DISTRICTS];
