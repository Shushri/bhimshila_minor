/**
 * The mark: Bhim Shila, and the water going around it.
 *
 * Drawn from the brand scene — the boulder with the sacred threads wrapped
 * round it, the temple behind. That scene is 900×640 and reads beautifully at
 * poster size and as grey mush at 32 pixels, which is where a product mark
 * actually lives: a rail icon, a browser tab, a favicon on a phone.
 *
 * So this keeps only what survives being small and stays meaningful:
 *
 *   the boulder      the silhouette, wide-based and domed, unmistakably a rock
 *   the threads      three wraps in red and saffron — the detail that makes it
 *                    a venerated stone rather than a generic pebble
 *   the parted water two arcs sweeping past either side
 *
 * The water is the one addition to the source artwork, and it is the reason
 * the name means anything: the rock did not stop the flood, it split it, and
 * the temple behind survived because the water went around. A boulder alone
 * says "rock". A boulder with the water parting says what happened.
 */

export function Mark({ size = 28, title = "BhimShila" }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      style={{ display: "block" }}
    >
      <title>{title}</title>

      {/* Water, parting. Behind the rock so the rock reads as splitting it. */}
      <g fill="none" strokeLinecap="round" opacity="0.85">
        <path d="M4 40 C14 40 18 46 20 53" stroke="#3f92e8" strokeWidth="3" />
        <path d="M60 40 C50 40 46 46 44 53" stroke="#3f92e8" strokeWidth="3" />
        <path d="M6 31 C13 31 16 34 18 38" stroke="#7fb6f0" strokeWidth="2" opacity="0.7" />
        <path d="M58 31 C51 31 48 34 46 38" stroke="#7fb6f0" strokeWidth="2" opacity="0.7" />
      </g>

      {/* The boulder. Same proportions as the scene: wide base, domed top. */}
      <path
        d="M13 53 C13 33 22 22 32 22 C42 22 51 33 51 53 Z"
        fill="#a79d92"
        stroke="#403a34"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Lit face, top-left, as in the scene. */}
      <path d="M19 40 C21 30 26 25 32 24 C27 28 23 34 21 44 Z" fill="#bcb3a8" />

      {/* The threads. Two red, one saffron, in the source's own colours. */}
      <g fill="none" strokeWidth="2.4" strokeLinecap="round">
        <path d="M22 27 C18 34 18 44 21 53" stroke="#c0392b" />
        <path d="M27 24 C23 32 23 44 26 53" stroke="#e07b2c" />
        <path d="M32 22.5 C29 31 29 44 31 53" stroke="#c0392b" />
      </g>
    </svg>
  );
}

/**
 * The wordmark as the brand sets it: name, rule, spaced caps tagline.
 *
 * `stacked` is for a splash or an about panel. Inline is for a header, where
 * the tagline would crowd the search box and is dropped instead of shrunk to
 * something nobody can read.
 */
export function Wordmark({
  stacked = false,
  tagline = "Intelligent Disaster Response",
}: {
  stacked?: boolean;
  tagline?: string;
}) {
  return (
    <span className={stacked ? "flex flex-col items-center gap-3" : "flex items-baseline gap-2"}>
      <span
        className={stacked ? "text-[38px] font-semibold leading-none" : "text-[15px] font-semibold tracking-tight"}
        style={{
          letterSpacing: stacked ? "0.02em" : undefined,
          background: "linear-gradient(135deg, #bcd9f8 20%, #3f92e8 80%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          filter: "drop-shadow(0 0 12px rgba(63,146,232,0.45))",
        }}
      >
        BhimShila
      </span>

      {stacked && (
        <span className="flex items-center gap-3">
          <span style={{ width: 36, height: 1, background: "var(--seq-400)" }} />
          <span
            className="text-[11px] uppercase"
            style={{ letterSpacing: "0.32em", color: "var(--seq-250)" }}
          >
            {tagline}
          </span>
          <span style={{ width: 36, height: 1, background: "var(--seq-400)" }} />
        </span>
      )}
    </span>
  );
}
