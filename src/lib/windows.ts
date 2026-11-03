"use client";

import type { ReactNode } from "react";

/**
 * The floating-window layer — the Jarvis half of the command centre.
 *
 * A tiny module-level store rather than context, because windows are opened
 * from everywhere: a map click, the assistant streaming a panel, a keyboard
 * shortcut. Threading a context through all of those couples every caller to
 * the React tree; a store with useSyncExternalStore couples them to nothing.
 *
 * Two kinds of window live here and the difference matters. Deck windows
 * (state drill-down) are an arrangement the operator returns to, so their
 * geometry persists per window id. Transient windows (assistant panels) are
 * a response — they appear, get read, and are replaced by the next question —
 * so persisting their layout would only replay a stale arrangement.
 */

export interface AppWindow {
  id: string;
  title: string;
  /** Provenance chip — every layer names its source and its age in the chrome. */
  source?: string;
  glyph?: string;
  node: ReactNode;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  pinned: boolean;
  /** Windows opened by one gesture share a deck tag, so one act clears them. */
  deck?: string;
  /** Transient windows skip layout persistence. */
  transient?: boolean;
}

export interface OpenSpec {
  id: string;
  title: string;
  node: ReactNode;
  source?: string;
  glyph?: string;
  w?: number;
  h?: number;
  x?: number;
  y?: number;
  deck?: string;
  transient?: boolean;
}

const LAYOUT_KEY = "bhimshila.windows.v1";

let windows: AppWindow[] = [];
let zTop = 10;
let cascade = 0;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function readLayout(): Record<string, { x: number; y: number; w: number; h: number; minimized: boolean }> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function persist(w: AppWindow) {
  if (w.transient || typeof window === "undefined") return;
  try {
    const all = readLayout();
    all[w.id] = { x: w.x, y: w.y, w: w.w, h: w.h, minimized: w.minimized };
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch {
    /* a lost arrangement is a shrug, not a failure */
  }
}

const vw = () => (typeof window === "undefined" ? 1440 : window.innerWidth);
const vh = () => (typeof window === "undefined" ? 900 : window.innerHeight);

const clampX = (x: number, w: number) => Math.max(8 - w + 120, Math.min(x, vw() - 56));
const clampY = (y: number) => Math.max(52, Math.min(y, vh() - 48));

export function openWindow(spec: OpenSpec): void {
  const existing = windows.find((w) => w.id === spec.id);
  if (existing) {
    // Re-opening refreshes content and brings it forward — it never spawns a twin.
    windows = windows.map((w) =>
      w.id === spec.id
        ? { ...w, node: spec.node, title: spec.title, source: spec.source ?? w.source, minimized: false, z: ++zTop }
        : w,
    );
    emit();
    return;
  }

  const saved = spec.transient ? undefined : readLayout()[spec.id];
  const w = spec.w ?? 440;
  const h = spec.h ?? 400;
  // Cascade from the top-left of the work area; each new window steps down-right
  // so nothing opens exactly on top of the last.
  const step = cascade++ % 9;
  const x = saved?.x ?? spec.x ?? Math.min(72 + step * 36, vw() - w - 24);
  const y = saved?.y ?? spec.y ?? Math.min(86 + step * 30, vh() - 220);

  windows = [
    ...windows,
    {
      id: spec.id,
      title: spec.title,
      source: spec.source,
      glyph: spec.glyph,
      node: spec.node,
      x: clampX(x, saved?.w ?? w),
      y: clampY(y),
      w: saved?.w ?? w,
      h: saved?.h ?? h,
      z: ++zTop,
      minimized: saved?.minimized ?? false,
      pinned: false,
      deck: spec.deck,
      transient: spec.transient,
    },
  ];
  emit();
}

export function closeWindow(id: string): void {
  windows = windows.filter((w) => w.id !== id);
  emit();
}

/** Clear a deck — the next question, or "close all". Pinned windows stay. */
export function closeDeck(deck?: string): void {
  windows = windows.filter((w) => w.pinned || (deck !== undefined && w.deck !== deck));
  emit();
}

export function focusWindow(id: string): void {
  windows = windows.map((w) => (w.id === id ? { ...w, z: ++zTop } : w));
  emit();
}

export function placeWindow(id: string, x: number, y: number): void {
  windows = windows.map((w) => {
    if (w.id !== id) return w;
    const next = { ...w, x: clampX(x, w.w), y: clampY(y) };
    persist(next);
    return next;
  });
  emit();
}

export function sizeWindow(id: string, wpx: number, hpx: number): void {
  windows = windows.map((w) => {
    if (w.id !== id) return w;
    const next = { ...w, w: Math.max(300, wpx), h: Math.max(180, hpx) };
    persist(next);
    return next;
  });
  emit();
}

export function toggleMinimize(id: string): void {
  windows = windows.map((w) => {
    if (w.id !== id) return w;
    const next = { ...w, minimized: !w.minimized, z: w.minimized ? ++zTop : w.z };
    persist(next);
    return next;
  });
  emit();
}

export function togglePin(id: string): void {
  windows = windows.map((w) => (w.id === id ? { ...w, pinned: !w.pinned } : w));
  emit();
}

/** Esc closes the top unpinned window — the reflex for "get this off my screen". */
export function closeTop(): boolean {
  const open = windows.filter((w) => !w.pinned && !w.minimized);
  if (!open.length) return false;
  const top = open.reduce((a, b) => (a.z > b.z ? a : b));
  closeWindow(top.id);
  return true;
}

export function subscribeWindows(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const getWindows = () => windows;
const EMPTY: AppWindow[] = [];
export const getWindowsServer = () => EMPTY;
