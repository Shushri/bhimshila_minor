"use client";
import VoiceSettings from "./VoiceSettings";

import { useState, useSyncExternalStore } from "react";
import {
  PROVIDERS,
  readKeys,
  readKeysServer,
  subscribeKeys,
  writeKeys,
  maskKey,
  type ByokKeys,
  type Provider,
} from "@/lib/byok";

/**
 * Bring your own key.
 *
 * The hosted instance shares one set of free-tier keys with everyone who opens
 * it, so on a busy day the assistant is rate-limited and the rest of the
 * product — alerts, the scan, dispatch — carries on without it. Anyone with
 * their own key can put it here and skip the queue.
 *
 * The panel is explicit about what happens to it, because a page that asks for
 * a credential owes the person an answer before they paste it, not in a privacy
 * policy afterwards.
 */
export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  // The keys live in localStorage, not React. Reading them as external state
  // keeps the panel in step with another tab and avoids a setState inside an
  // effect just to load them.
  const keys: ByokKeys = useSyncExternalStore(subscribeKeys, readKeys, readKeysServer);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  function commit(next: ByokKeys) {
    writeKeys(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(4,7,12,0.72)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-4 shadow-2xl"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold">Your own model key</h3>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
              Optional. Everything except the assistant works without one.
            </p>
          </div>
          <button onClick={onClose} className="text-[16px]" style={{ color: "var(--ink-muted)" }}>
            ×
          </button>
        </div>

        {/* Said before the field, not after. */}
        <p
          className="mt-3 rounded-lg px-3 py-2 text-[11.5px] leading-snug"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          The key is stored <strong>in this browser only</strong> — no account, no database, no
          cookie. It is sent with your own questions so the server can call the provider, and it is
          never written down anywhere. Clearing it here removes it completely.
        </p>

        <ul className="mt-3 flex flex-col gap-1.5">
          {PROVIDERS.map((p) => {
            const set = keys[p.id];
            const isEditing = editing === p.id;
            return (
              <li key={p.id} className="rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{p.label}</span>
                  {set && !isEditing && (
                    <code className="shrink-0 text-[10.5px]" style={{ color: "var(--good)" }}>
                      {maskKey(set)}
                    </code>
                  )}
                  <button
                    onClick={() => {
                      setEditing(isEditing ? null : p.id);
                      setDraft("");
                    }}
                    className="shrink-0 rounded-md px-2 py-1 text-[10.5px]"
                    style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
                  >
                    {isEditing ? "cancel" : set ? "replace" : "add"}
                  </button>
                  {set && !isEditing && (
                    <button
                      onClick={() => {
                        const next = { ...keys };
                        delete next[p.id];
                        commit(next);
                      }}
                      className="shrink-0 rounded-md px-2 py-1 text-[10.5px]"
                      style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--serious)" }}
                    >
                      clear
                    </button>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-2 flex gap-1.5">
                    <input
                      autoFocus
                      type="password"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && draft.trim().length > 12) {
                          commit({ ...keys, [p.id]: draft.trim() });
                          setEditing(null);
                        }
                      }}
                      placeholder={p.hint}
                      className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-[11.5px] outline-none"
                      style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
                    />
                    <button
                      onClick={() => {
                        commit({ ...keys, [p.id]: draft.trim() });
                        setEditing(null);
                      }}
                      disabled={draft.trim().length <= 12}
                      className="shrink-0 rounded-md px-3 py-1.5 text-[11.5px] font-medium disabled:opacity-40"
                      style={{ background: "#17508f", color: "#fff" }}
                    >
                      Save
                    </button>
                  </div>
                )}

                {!set && !isEditing && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-[10.5px] underline"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    get one free
                  </a>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[10.5px] leading-snug" style={{ color: "var(--ink-muted)" }}>
          Any one is enough. With more than one set, a rate-limited provider falls through to the
          next instead of failing the question.
        </p>

        {saved && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--good)" }}>
            Saved in this browser.
          </p>
        )}

        <VoiceSettings />
      </div>
    </div>
  );
}
