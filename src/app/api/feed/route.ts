import { buildFeed } from "@/lib/feed";

/**
 * Everything the system knows, ranked, in one call.
 *
 * The dashboard renders from this alone. Splitting it across endpoints would
 * put the merge and the ranking in the browser, where two of the three sources
 * would arrive at different times and the board would reorder itself under the
 * coordinator's cursor.
 */
export const dynamic = "force-dynamic";
/**
 * Vercel Hobby kills a function at 10 seconds, so that is the real ceiling and
 * declaring more would only hide it from the next person reading this file.
 * Measured against it: the national scan is 1.1s, the state deck 0.8s, a routed
 * agent turn under 2s. The one that runs close is neural speech, which is why
 * the client asks for a clause at a time rather than a whole reply.
 */
export const maxDuration = 10;

export async function GET() {
  const feed = await buildFeed();
  return Response.json(feed, {
    headers: { "Cache-Control": "no-store" },
  });
}
