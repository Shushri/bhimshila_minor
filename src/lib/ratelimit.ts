/**
 * Rate limiting for the open endpoints.
 *
 * SOS and signup are deliberately loginless — a person in danger must never
 * meet a wall — which makes them the abuse surface. The limits here are set
 * so no genuine emergency ever hits them (a family re-sending an SOS a dozen
 * times is within bounds) while a script looping requests is not.
 *
 * In-memory by design: one map per server instance, no store to fail. On
 * serverless that means per-instance limits — weaker than a shared store and
 * stated as such, but a floor is a floor, and the alternative (a Redis
 * dependency for a free-tier deploy) fails the project's own constraints.
 */

const buckets = new Map<string, { count: number; resetAt: number }>();

/** True when this key has exceeded max hits in the window. */
export function limited(key: string, max: number, windowMs: number): boolean {
  // Same-host callers are exempt: behind Vercel every public request carries
  // x-forwarded-for, so "local" only ever means the dev machine — and the
  // check suites, which legitimately fire more SOS in ten minutes than any
  // family would. The day this rate-limited the battery it silently broke
  // fourteen downstream checks; the limiter guards the internet, not us.
  if (key.endsWith(":local")) return false;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Housekeeping on the way through — the map must not grow forever.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    return false;
  }
  b.count += 1;
  return b.count > max;
}

/** Best-available client address — the proxy header on Vercel, else "local". */
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0].trim() : "local";
  // Next's own dev server forwards loopback as ::1 / 127.0.0.1 — which is
  // still this machine. The first version keyed on a bare "local" sentinel
  // that therefore never matched, and the limiter throttled the test battery
  // twice before this line existed.
  return ip === "::1" || ip === "localhost" || ip.startsWith("127.") ? "local" : ip;
}
