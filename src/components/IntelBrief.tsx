"use client";

import { useEffect, useState } from "react";
import { byokHeader } from "@/lib/byok";
import PanelHost from "./PanelHost";
import type { Panel } from "@/lib/agent/panels";

/**
 * The intelligence tab — what the AI makes of the country right now.
 *
 * The board shows everything; this shows what matters. On open it asks the
 * agent for a situation report and renders the answer the way the agent
 * thinks: one spoken-register sentence up top, then the panels it chose,
 * with the live disaster press and seismic feed alongside.
 *
 * Same rules as everywhere else: the model narrates, it never produces the
 * numbers — the panels carry sourced figures, the sitrep leads with what
 * authorities have issued, and with no model key the deterministic router
 * still builds all of it.
 */

interface Overview {
  scanned: number;
  elevatedCount: number;
  states: { state: string; worst: number; level: string; elevated: number }[];
  news: { title: string; link: string; published: string | null; source: string }[];
  quakes: { magnitude: number; place: string; time: string }[];
  updatedAt?: string;
}

const SUGGESTED = [
  "Kerala mein kya chal raha hai?",
  "Kitne SOS pending hain?",
  "Sabse zyada log kis alert ke neeche hain?",
  "Flash flood ka protocol kya hai?",
  "Assam ka risk kya bol raha hai?",
];

const muted = { color: "var(--ink-muted)" } as const;
const secondary = { color: "var(--ink-secondary)" } as const;

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
};

/**
 * The streamed read. A fresh ask is a fresh mount (the parent keys this by a
 * counter), so every piece of state starts at its default and nothing needs
 * resetting inside an effect.
 */
function BriefStream({ onRefresh }: { onRefresh: () => void }) {
  const [text, setText] = useState("");
  const [panels, setPanels] = useState<Panel[]>([]);
  const [via, setVia] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...byokHeader() },
          body: JSON.stringify({ query: "situation report for India right now" }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error ?? `unreachable (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
        const handle = (line: string) => {
          if (!line.trim()) return;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          if (ev.type === "meta") setProvider(String(ev.provider ?? ""));
          if (ev.type === "tool_start" && ev.via) setVia(String(ev.via));
          if (ev.type === "panel") setPanels((p) => [...p, ev.panel as Panel]);
          if (ev.type === "text") {
            acc = ev.replaces ? String(ev.delta ?? "") : acc + String(ev.delta ?? "");
            setText(acc.trim());
          }
          if (ev.type === "done") setText(String(ev.text ?? acc).trim());
          if (ev.type === "error") setError(String(ev.message ?? "failed"));
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handle);
        }
        if (buffer) handle(buffer);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(e instanceof Error ? e.message : "The assistant is unreachable.");
        }
      } finally {
        setBusy(false);
      }
    })();

    return () => ac.abort();
  }, []);

  const ask = (q: string) => window.dispatchEvent(new CustomEvent("bhimshila:ask", { detail: q }));

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {/* The read itself. */}
        <section className="rounded-xl p-4" style={card}>
          <header className="flex flex-wrap items-baseline gap-2">
            <span className="text-[13px] font-semibold" style={{ color: "var(--seq-250)" }}>
              ◈ The AI&rsquo;s read
            </span>
            <span className="text-[9.5px] uppercase tracking-wider" style={muted}>
              {via ? `routed · ${via}` : busy ? "asking…" : "situation report"}
              {provider ? ` · ${provider}` : " · no model needed"}
            </span>
            <button
              onClick={onRefresh}
              className="ml-auto rounded-md px-2 py-1 text-[10.5px]"
              style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
              title="Ask again"
            >
              ↻ refresh
            </button>
          </header>

          {error ? (
            <p className="mt-2.5 rounded-lg px-3 py-2 text-[12px]" style={{ background: "#3a1a1a", color: "var(--serious)" }}>
              ■ {error}
            </p>
          ) : (
            <p className="mt-2.5 text-[15px] leading-relaxed" style={{ color: "var(--ink)" }}>
              {text || (
                <span className="inline-block h-5 w-64 animate-pulse rounded" style={{ background: "var(--surface-2)" }} />
              )}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="rounded-full px-2.5 py-1 text-[10.5px]"
                style={{ background: "var(--surface-2)", color: "var(--ink-secondary)", border: "1px solid var(--border)" }}
                title="Ask the command deck"
              >
                {q}
              </button>
            ))}
          </div>
        </section>

        {/* The panels the agent chose, inline rather than as windows — this
            tab IS the answer surface. */}
        {busy && !panels.length && (
          <div className="grid animate-pulse gap-2.5 lg:grid-cols-2">
            <div className="h-64 rounded-xl" style={{ background: "var(--surface)" }} />
            <div className="h-64 rounded-xl" style={{ background: "var(--surface)" }} />
          </div>
        )}
        <div className="grid items-start gap-2.5 lg:grid-cols-2">
          {panels.map((p, i) => (
            <div key={`${p.panel}-${i}`} className={p.panel === "point_map" || p.panel === "choropleth" ? "lg:col-span-2" : ""}>
              <PanelHost panel={p} />
            </div>
          ))}
        </div>
    </div>
  );
}

export default function IntelBrief() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/overview")
      .then((r) => r.json())
      .then(setOverview)
      .catch(() => {});
  }, [refreshKey]);

  const worstStates = (overview?.states ?? []).slice(0, 8);
  const maxWorst = Math.max(1, ...worstStates.map((s) => s.worst));

  return (
    <div className="grid gap-2.5 xl:grid-cols-[1fr_22rem]">
      {/* A fresh ask is a fresh mount — see BriefStream. */}
      <BriefStream key={refreshKey} onRefresh={() => setRefreshKey((k) => k + 1)} />

      <aside className="flex min-w-0 flex-col gap-2.5">
        <section className="rounded-xl p-3.5" style={card}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={muted}>
            Risk surface · top states
          </h3>
          {worstStates.length ? (
            <ol className="flex flex-col gap-1.5">
              {worstStates.map((s) => (
                <li key={s.state} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-[11px]">
                  <span className="truncate">{s.state}</span>
                  <span className="h-2 overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
                    <span
                      className="block h-full rounded-sm"
                      style={{ width: `${(s.worst / maxWorst) * 100}%`, background: "var(--seq-400)" }}
                    />
                  </span>
                  <span className="text-right tabular-nums" style={secondary}>{s.worst}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[11px]" style={secondary}>
              The scan source is rate-limiting right now — this fills in when the next sweep lands.
            </p>
          )}
          <p className="mt-2 text-[9.5px]" style={muted}>
            Worst district per state, 0–100 — our estimate, not an official warning.
            {overview ? ` ${overview.elevatedCount} of ${overview.scanned} districts elevated.` : ""}
          </p>
        </section>

        <section className="rounded-xl p-3.5" style={card}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={muted}>
            Live disaster press
          </h3>
          <ol className="flex flex-col gap-1.5">
            {(overview?.news ?? []).map((n) => (
              <li key={n.link}>
                <a
                  href={n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg p-2 text-[11.5px] leading-snug hover:underline"
                  style={{ background: "var(--surface-2)" }}
                >
                  {n.title}
                  <span className="mt-0.5 block text-[9.5px]" style={muted}>
                    {n.source} ↗
                  </span>
                </a>
              </li>
            ))}
            {!overview?.news?.length && (
              <li className="py-3 text-center text-[11px]" style={muted}>
                No disaster-related headline right now.
              </li>
            )}
          </ol>
        </section>

        {(overview?.quakes ?? []).length > 0 && (
          <section className="rounded-xl p-3.5" style={card}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={muted}>
              Seismic · USGS, 30 days
            </h3>
            <ol className="flex flex-col gap-1 text-[11px]" style={secondary}>
              {overview!.quakes.slice(0, 5).map((q) => (
                <li key={q.time} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-semibold tabular-nums" style={{ color: q.magnitude >= 5.5 ? "var(--serious)" : undefined }}>
                    ◈ M{q.magnitude.toFixed(1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{q.place}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </aside>
    </div>
  );
}
