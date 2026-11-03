/**
 * Ground-truth feeds — the human-reported side of the picture.
 *
 * All free, all keyless, all verified working:
 *   The Hindu / NDTV / PIB RSS   Indian news, incl. Hindi (PIB)
 *   USGS FDSN                    real-time earthquakes, bbox-filterable
 *   GDACS RSS                    global multi-hazard alerts
 *
 * This exists because a weather model alone cannot tell you whether anything
 * actually happened. Cross-checking the machine signal against reported events
 * is what separates a real alert from a false alarm.
 *
 * (ReliefWeb was the obvious choice and is dead — v1 returns 410 Gone, v2 403.)
 */

export interface NewsItem {
  title: string;
  link: string;
  published: string | null;
  source: string;
}

/**
 * Google News RSS, scoped by query. `when:2d` keeps it to the last 48 hours —
 * this feed exists to carry what is happening NOW, across hundreds of outlets
 * no single masthead covers, including the district papers that report a
 * washed-out bridge before anyone national does.
 */
const gnews = (q: string, lang: "en" | "hi") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:2d`)}&hl=${lang}-IN&gl=IN&ceid=IN:${lang}`;

const SOURCES: { name: string; url: string }[] = [
  // Mastheads first: on a duplicate headline, the named paper beats the
  // aggregator as the attribution.
  { name: "The Hindu", url: "https://www.thehindu.com/news/national/feeder/default.rss" },
  { name: "NDTV", url: "https://feeds.feedburner.com/ndtvnews-india-news" },
  { name: "PIB", url: "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3" },
  { name: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms" },
  { name: "Hindustan Times", url: "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml" },
  {
    name: "Google News",
    url: gnews(
      "(flood OR cyclone OR landslide OR cloudburst OR \"heavy rain\" OR earthquake OR heatwave OR \"IMD alert\" OR NDRF) India",
      "en",
    ),
  },
  // The same sweep in Hindi — half the country's local reporting never
  // appears in English at all.
  { name: "Google News हिन्दी", url: gnews("(बाढ़ OR चक्रवात OR भूस्खलन OR भारी बारिश OR भूकंप OR राहत बचाव)", "hi") },
];

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, "")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocks) {
    const title = /<title>([\s\S]*?)<\/title>/i.exec(b)?.[1];
    if (!title) continue;
    items.push({
      title: strip(title),
      link: strip(/<link>([\s\S]*?)<\/link>/i.exec(b)?.[1] ?? ""),
      published: /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(b)?.[1]?.trim() ?? null,
      source,
    });
  }
  return items;
}

/** Words that mark a headline as disaster-relevant. */
const DISASTER_TERMS = [
  "flood", "flash flood", "cloudburst", "landslide", "rain", "rainfall", "downpour",
  "cyclone", "storm", "earthquake", "quake", "tremor", "drought", "heatwave", "heat wave",
  "avalanche", "washed away", "swept", "stranded", "evacuat", "rescue", "relief",
  "missing", "submerged", "waterlogg", "dam", "river", "alert", "warning", "disaster",
  "बाढ़", "भूस्खलन", "बारिश", "चेतावनी", "राहत",
];

export function isDisasterRelated(title: string) {
  const t = title.toLowerCase();
  return DISASTER_TERMS.some((k) => t.includes(k));
}

/** A stalled feed must not hold up an answer that does not depend on it. */
const FEED_TIMEOUT_MS = 6_000;

/**
 * One source, and it cannot fail.
 *
 * Returning [] rather than rejecting is deliberate. `Promise.allSettled` looks
 * like it makes that unnecessary, and it is not: with `next: { revalidate }`
 * the request runs inside Next's cache machinery, and when DNS for a host
 * fails there the throw escapes the settled boundary entirely. A transient
 * ENOTFOUND on one news feed took down the whole agent response with "failed to
 * pipe response" — the browser got a broken stream and rendered nothing, in the
 * middle of a demo. Nothing this peripheral gets to do that.
 */
async function fetchSource(s: { name: string; url: string }): Promise<NewsItem[]> {
  try {
    const res = await fetch(s.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BhimShila/1.0)" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseRss(await res.text(), s.name);
  } catch {
    // Unreachable, timed out, or malformed. The other sources still answer.
    return [];
  }
}

/**
 * Seven feeds now overlap — the same cloudburst arrives from a masthead and
 * from the aggregator within minutes — so headlines dedupe on a normalised
 * prefix (Google News suffixes " - Publisher", which must not defeat the
 * match), and the merged list sorts newest-first. Undated items sink to the
 * end rather than jumping the queue.
 */
const titleKey = (t: string) =>
  t.toLowerCase().replace(/\s+-\s+[^-]+$/, "").replace(/[^a-z0-9ऀ-ॿ]/g, "").slice(0, 72);

export async function fetchNews(opts: { disasterOnly?: boolean; limit?: number } = {}): Promise<NewsItem[]> {
  const { disasterOnly = false, limit = 40 } = opts;

  const all = (await Promise.all(SOURCES.map(fetchSource))).flat();
  const filtered = disasterOnly ? all.filter((i) => isDisasterRelated(i.title)) : all;

  const seen = new Set<string>();
  const deduped = filtered.filter((i) => {
    const k = titleKey(i.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return deduped
    .sort((a, b) => {
      const ta = a.published ? Date.parse(a.published) : NaN;
      const tb = b.published ? Date.parse(b.published) : NaN;
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    })
    .slice(0, limit);
}

/** Headlines that mention a place — the ground-truth check for one region. */
export async function newsForPlace(place: string, limit = 6): Promise<NewsItem[]> {
  const news = await fetchNews({ limit: 200 });
  const needle = place.toLowerCase();
  return news
    .filter((n) => n.title.toLowerCase().includes(needle))
    .slice(0, limit);
}

export interface Quake {
  magnitude: number;
  place: string;
  time: string;
  lat: number;
  lng: number;
  depthKm: number;
}

/** Recent earthquakes over the Indian subcontinent bounding box. */
export async function fetchQuakes(days = 30, minMagnitude = 4): Promise<Quake[]> {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}` +
    `&minmagnitude=${minMagnitude}&minlatitude=6&maxlatitude=38&minlongitude=68&maxlongitude=98`;

  try {
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.features ?? []).map(
      (f: {
        properties: { mag: number; place: string; time: number };
        geometry: { coordinates: [number, number, number] };
      }) => ({
        magnitude: f.properties.mag,
        place: f.properties.place,
        time: new Date(f.properties.time).toISOString(),
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        depthKm: f.geometry.coordinates[2],
      }),
    );
  } catch {
    return [];
  }
}
