"use client";

/**
 * A visitor's own model key, kept on their device.
 *
 * The deployed instance shares one set of free-tier keys with everyone who
 * opens it, so they rate-limit within minutes of being useful. Anyone with
 * their own key should be able to use it — and the honest way to allow that is
 * to never take custody of it.
 *
 * So it lives in this browser's localStorage and nowhere else. It travels on
 * the request that needs it, the server uses it for that call, and it is gone.
 * No database row, no cookie, no log line. Storing someone else's credential to
 * save them a paste is a trade nobody asked for, and it turns a hackathon
 * project into something that has to be trusted with secrets.
 *
 * The tradeoff, stated plainly in the settings panel: the key does cross our
 * server, because our server is what talks to the provider. Anyone who is not
 * comfortable with that should run this locally, which is what the README is
 * for.
 */

const KEY = "bhimshila.byok";

export type Provider = "openrouter" | "groq" | "gemini" | "anthropic";

export const PROVIDERS: { id: Provider; label: string; hint: string; url: string }[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "sk-or-v1-…",
    url: "https://openrouter.ai/keys",
  },
  { id: "groq", label: "Groq", hint: "gsk_…", url: "https://console.groq.com/keys" },
  { id: "gemini", label: "Google Gemini", hint: "AIza…", url: "https://aistudio.google.com/apikey" },
  { id: "anthropic", label: "Anthropic", hint: "sk-ant-…", url: "https://console.anthropic.com/settings/keys" },
];

export type ByokKeys = Partial<Record<Provider, string>>;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/**
 * Cached so the parsed object keeps its identity between reads.
 *
 * useSyncExternalStore compares snapshots by reference: returning a freshly
 * parsed object every call makes React see a change on every render and spin
 * forever. The raw string is the real snapshot; this only re-parses when it
 * actually differs.
 */
let rawSnapshot: string | null = null;
let parsed: ByokKeys = {};

export function readKeys(): ByokKeys {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== rawSnapshot) {
    rawSnapshot = raw;
    try {
      parsed = raw ? (JSON.parse(raw) as ByokKeys) : {};
    } catch {
      parsed = {};
    }
  }
  return parsed;
}

/** One frozen empty object, so the server snapshot is reference-stable too. */
const EMPTY: ByokKeys = Object.freeze({});
export const readKeysServer = () => EMPTY;

export function writeKeys(keys: ByokKeys) {
  try {
    // An empty string means "cleared", and storing it would keep sending an
    // empty header forever.
    const clean = Object.fromEntries(
      Object.entries(keys).filter(([, v]) => typeof v === "string" && v.trim().length > 12),
    );
    if (Object.keys(clean).length) {
      window.localStorage.setItem(KEY, JSON.stringify(clean));
    } else {
      window.localStorage.removeItem(KEY);
    }
  } catch {
    /* private mode or storage full — the session still works, just not next time */
  }
  notify();
}

export function subscribeKeys(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** How many are set — the only thing the UI ever needs to render. */
export function keyCount(): number {
  return Object.keys(readKeys()).length;
}
export const keyCountServer = () => 0;

/**
 * The header to attach to a request that will reach a model.
 *
 * Returns an empty object when nothing is set, so callers can spread it
 * unconditionally and the server simply falls back to its own keys.
 */
export function byokHeader(): Record<string, string> {
  const keys = readKeys();
  return Object.keys(keys).length ? { "x-byok": JSON.stringify(keys) } : {};
}

/**
 * Show enough to recognise a key, never enough to use one.
 *
 * A settings panel that renders the whole secret is a shoulder-surfing hazard
 * and puts it in every screenshot of the page.
 */
export function maskKey(v: string): string {
  const t = v.trim();
  return t.length <= 12 ? "•".repeat(t.length) : `${t.slice(0, 6)}${"•".repeat(10)}${t.slice(-4)}`;
}
