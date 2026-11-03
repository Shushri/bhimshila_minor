"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  type AppWindow,
  closeDeck,
  closeTop,
  closeWindow,
  focusWindow,
  getWindows,
  getWindowsServer,
  placeWindow,
  sizeWindow,
  subscribeWindows,
  toggleMinimize,
  togglePin,
} from "@/lib/windows";

/**
 * The layer that renders every floating window.
 *
 * Drag and resize write straight to the DOM node and commit to the store once
 * on release — the same reasoning as the voice orb: geometry changes at
 * pointer speed, and a React render per pointermove makes a heavy window (a
 * map, a chart) stutter exactly when someone is looking hardest at it.
 *
 * Below 1024px the whole idea of floating windows is wrong — there is no desk
 * to arrange them on — so each becomes a full-screen sheet with a tab strip,
 * which is the same information without the pretence of a desktop.
 */

function useIsDesk(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(min-width: 1024px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

function Chrome({ win, desk }: { win: AppWindow; desk: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const size = useRef<{ px: number; py: number; w: number; h: number } | null>(null);

  function onTitleDown(e: React.PointerEvent) {
    if (!desk) return;
    if ((e.target as HTMLElement).closest("button")) return;
    focusWindow(win.id);
    drag.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onTitleMove(e: React.PointerEvent) {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    el.style.left = `${d.x + e.clientX - d.px}px`;
    el.style.top = `${d.y + e.clientY - d.py}px`;
  }
  function onTitleUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (d) placeWindow(win.id, d.x + e.clientX - d.px, d.y + e.clientY - d.py);
  }

  function onGripDown(e: React.PointerEvent) {
    focusWindow(win.id);
    size.current = { px: e.clientX, py: e.clientY, w: win.w, h: win.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }
  function onGripMove(e: React.PointerEvent) {
    const s = size.current;
    const el = ref.current;
    if (!s || !el) return;
    el.style.width = `${Math.max(300, s.w + e.clientX - s.px)}px`;
    el.style.height = `${Math.max(180, s.h + e.clientY - s.py)}px`;
  }
  function onGripUp(e: React.PointerEvent) {
    const s = size.current;
    size.current = null;
    if (s) sizeWindow(win.id, s.w + e.clientX - s.px, s.h + e.clientY - s.py);
  }

  const frame: React.CSSProperties = desk
    ? { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }
    : { inset: 0, zIndex: win.z };

  return (
    <div
      ref={ref}
      className={`panel-in pointer-events-auto fixed flex flex-col overflow-hidden ${desk ? "rounded-xl" : ""}`}
      style={{
        ...frame,
        background: "rgba(20,22,26,0.94)",
        border: "1px solid var(--border)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(127,182,240,0.06)",
        backdropFilter: "blur(10px)",
      }}
      onPointerDown={() => focusWindow(win.id)}
    >
      <header
        className="flex shrink-0 select-none items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--border)", cursor: desk ? "grab" : "default", touchAction: "none" }}
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
      >
        {win.glyph && (
          <span className="text-[12px]" style={{ color: "var(--seq-250)" }} aria-hidden>
            {win.glyph}
          </span>
        )}
        <h3 className="truncate text-[12px] font-semibold tracking-tight">{win.title}</h3>
        {win.source && (
          <span
            className="ml-1 hidden truncate rounded px-1.5 py-0.5 text-[9.5px] sm:inline"
            style={{ background: "var(--surface-2)", color: "var(--ink-muted)" }}
            title={win.source}
          >
            {win.source}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => togglePin(win.id)}
            title={win.pinned ? "Unpin — the next question may replace it" : "Pin — keep this open"}
            aria-pressed={win.pinned}
            className="grid h-6 w-6 place-items-center rounded text-[11px]"
            style={{ color: win.pinned ? "var(--seq-250)" : "var(--ink-muted)", background: win.pinned ? "#17508f33" : "transparent" }}
          >
            ⊙
          </button>
          {desk && (
            <button
              onClick={() => toggleMinimize(win.id)}
              title="Minimise to the tray"
              className="grid h-6 w-6 place-items-center rounded text-[11px]"
              style={{ color: "var(--ink-muted)" }}
            >
              —
            </button>
          )}
          <button
            onClick={() => closeWindow(win.id)}
            title="Close"
            className="grid h-6 w-6 place-items-center rounded text-[13px]"
            style={{ color: "var(--ink-muted)" }}
          >
            ×
          </button>
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">{win.node}</div>

      {desk && (
        <div
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          className="absolute bottom-0 right-0 h-4 w-4"
          style={{ cursor: "nwse-resize", touchAction: "none" }}
          aria-hidden
        >
          <svg viewBox="0 0 16 16" className="h-full w-full" style={{ color: "var(--ink-muted)" }}>
            <path d="M15 9v6H9M15 13v2h-2" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6" />
          </svg>
        </div>
      )}
    </div>
  );
}

export default function WindowLayer() {
  const wins = useSyncExternalStore(subscribeWindows, getWindows, getWindowsServer);
  const desk = useIsDesk();

  // Esc closes the top window. Registered once, window-level — the reflex has
  // to work without any window having focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!wins.length) return null;

  const open = wins.filter((w) => !w.minimized);
  const tray = wins.filter((w) => w.minimized);
  // On a phone only the top sheet shows; the strip below switches between them.
  const sheet = !desk && open.length ? open.reduce((a, b) => (a.z > b.z ? a : b)) : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {desk
        ? open.map((w) => <Chrome key={w.id} win={w} desk />)
        : sheet && <Chrome key={sheet.id} win={sheet} desk={false} />}

      {/* Phone: tab strip across the bottom for every open window. */}
      {!desk && open.length > 1 && (
        <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex gap-1 overflow-x-auto px-2 py-1.5" style={{ background: "rgba(13,13,13,0.92)", borderTop: "1px solid var(--border)" }}>
          {open.map((w) => (
            <button
              key={w.id}
              onClick={() => focusWindow(w.id)}
              className="shrink-0 rounded-md px-2.5 py-1.5 text-[10.5px]"
              style={{
                background: sheet?.id === w.id ? "#17508f" : "var(--surface-2)",
                color: sheet?.id === w.id ? "#fff" : "var(--ink-secondary)",
              }}
            >
              {w.glyph ? `${w.glyph} ` : ""}
              {w.title}
            </button>
          ))}
        </div>
      )}

      {/* Desk: minimised tray, bottom-left. */}
      {desk && tray.length > 0 && (
        <div className="pointer-events-auto fixed bottom-3 left-3 z-50 flex max-w-[60vw] gap-1 overflow-x-auto">
          {tray.map((w) => (
            <button
              key={w.id}
              onClick={() => toggleMinimize(w.id)}
              className="shrink-0 rounded-md px-2.5 py-1.5 text-[10.5px]"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
              title="Restore"
            >
              {w.glyph ? `${w.glyph} ` : ""}
              {w.title}
            </button>
          ))}
        </div>
      )}

      {/* Desk: one act clears the deck. Esc does it one window at a time. */}
      {desk && open.length > 1 && (
        <button
          onClick={() => closeDeck()}
          className="pointer-events-auto fixed bottom-3 right-3 z-50 rounded-md px-2.5 py-1.5 text-[10.5px]"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-muted)" }}
          title="Close every unpinned window (Esc closes one at a time)"
        >
          clear deck · {open.filter((w) => !w.pinned).length}
        </button>
      )}
    </div>
  );
}
