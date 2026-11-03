import { TOOL_DEFS, runTool } from "@/lib/agent/tools";
import { route } from "@/lib/agent/router";
import type { Panel } from "@/lib/agent/panels";
import {
  chat,
  chatStreamText,
  resolveProviders,
  isTransient,
  ProviderError,
  SETUP_HINT,
  parseByok,
  type ChatMessage,
  type ChatTool,
  type ProviderConfig,
} from "@/lib/agent/llm";

export const maxDuration = 10;

const SYSTEM = `You are BhimShila, a disaster intelligence assistant for India, operated by voice in a control room.

Answer with DATA, not prose. For almost every question, call a tool — the tool renders a visual panel the user is already looking at, and your words only narrate it.

Rules:
- Call a tool whenever the question touches a SPECIFIC place, number or live condition — population, density, a region, a hazard there, risk, current news, a past event. Never answer those from memory; the tools carry sourced figures.
- A broad question that names no place and asks for no live figure — "how is climate change affecting India", "what causes cloudbursts", "why does India flood every year" — is general knowledge, not a lookup. Answer it in one or two plain sentences from what you know, say plainly that it is background rather than a live reading, and then offer the thing this system can actually show: the live official alerts, the risk scan, or this fortnight's rainfall against the 86-year archive for a named place. Do NOT force a tool call on these — searching the news for "climate change" returns nothing and tells the user nothing.
- ALWAYS write a sentence after a tool returns. Never reply with nothing.
- Reply in ONE OR TWO SHORT SENTENCES, maximum 35 words. The panel carries the detail — do not restate its rows.
- Your words are read aloud by a speech synthesiser. Write plain prose only: no markdown, no asterisks, no bullet points, no headings. Write "68 out of 100", not "**68/100**".
- Lead with the answer: "Bihar is the most crowded — 1,106 people per square kilometre." Not "I looked at the data and found...".
- The user may speak Hindi, English, or a mix (Hinglish). Reply in whichever they used. Never apologise for language.
- Attribute figures: census numbers are Census 2011, live weather is Open-Meteo, headlines are Indian news feeds.
- Officially ISSUED alerts outrank everything else. NDMA, the IMD, state SDMAs and the Central Water Commission publish real warnings through Sachet; our own risk score is an estimate that fills the gaps between them. When a tool returns official alerts, lead with them and name the issuing authority ("Kerala SDMA has a red alert out"). Never present our estimate as official, and never contradict a live official alert — if our signal is quiet where an authority has warned, the authority is right.
- You never decide whether someone is in danger — the risk engine does. Report its score and its stated evidence. Never invent a risk number.
- You do not forecast weather. You translate existing public data. If asked to predict, say IMD forecasts and you interpret.
- You can act, not just report: list_incidents shows live citizen emergencies, dispatch_team proposes sending a rescue team, prepare_alert proposes warning a region. Both of those return a confirmation card — a human approves before anything happens. Say what is about to happen and that it needs confirmation. Never claim an alert was sent or a team was dispatched; you only propose it.`;

const TOOLS: ChatTool[] = TOOL_DEFS.map((t) => ({
  name: t.name,
  description: t.description ?? "",
  parameters: t.input_schema as Record<string, unknown>,
}));

/** Spoken fallback built from the panel itself, when the model stays silent. */
function narrate(p: Panel): string {
  // A panel that states its own headline knows better than any rule here which
  // of its facts matters most.
  if (p.headline) return p.headline;
  switch (p.panel) {
    case "risk_card":
      return `${p.place} is at ${p.level} flash-flood exposure — ${p.score} out of 100. ${p.evidence}`;
    case "ranked_list": {
      const top = p.rows[0];
      return top ? `${top.name} leads at ${top.value.toLocaleString("en-IN")}${p.unit}.` : p.title;
    }
    case "region_card": {
      const r = p.region;
      return `${r.name}: ${r.population.toLocaleString("en-IN")} people, ${r.density.toLocaleString("en-IN")} per square kilometre.`;
    }
    case "choropleth":
      return `Showing ${p.metric.toLowerCase()} across ${p.features.length} regions.`;
    case "timeline":
      return `${p.title}. ${p.subtitle ?? ""}`;
    case "point_map":
      return `${p.points.length} regions match.`;
    default:
      return p.title;
  }
}

/**
 * Tool calls emitted as plain text rather than in the tool_calls field.
 *
 * Several open models do this, and one of them streamed
 * `<toolcall><function=preparealert><parameter=region>Himachal Pradesh…` straight
 * into the narration, where the speech synthesiser read the angle brackets
 * aloud. Anything shaped like machine syntax is stripped before a word of it
 * can be spoken.
 */
const TOOL_SYNTAX =
  /<\/?(?:tool_?call|function|parameter|invoke|antml:[a-z]+)[^>]*>|<\|[^|]*\|>|\[\/?(?:TOOL_CALL|FUNCTION)[^\]]*\]/gi;

/**
 * The same failure in JSON rather than angle brackets.
 *
 * Asked for "Madhya Pradesh ka saara data", a model emitted
 * `{"tool": "riskscan", "args": {"district": "Madhya Pradesh"}}` seventeen
 * times in a row as plain text — a name that is not even one of our tools —
 * and the synthesiser read every one of them aloud. The guard above only knew
 * about tags, so none of it was caught.
 *
 * Two shapes, because a loop like that gets truncated: a complete object, and
 * an object that opened and never closed.
 */
const JSON_TOOL_SYNTAX =
  /\{\s*"(?:tool|tool_name|name|function|action|args|arguments|parameters)"\s*:[\s\S]*?(?:\}\s*\}|\}|$)/gi;

/**
 * Strip markup without touching word boundaries.
 *
 * Deliberately does NOT trim: this runs on every streamed token, and trimming
 * each one removes the single leading space that separates it from the last —
 * the whole answer arrives as "Himachalke9registereduserskeliye". Trim at the
 * point the complete string is used, not here.
 */
const clean = (s: string) =>
  s
    .replace(TOOL_SYNTAX, " ")
    .replace(JSON_TOOL_SYNTAX, " ")
    .replace(/\*\*/g, "")
    .replace(/[*_`#]/g, "")
    .replace(/[ \t]+/g, " ");

/**
 * Whether a reply is machine syntax rather than an answer.
 *
 * Once the brackets are stripped from `<function=prepare_alert><parameter=region>
 * Himachal Pradesh` what remains is "prepare_alert region Himachal Pradesh" —
 * technically words, and nonsense to hear. Better to fall back to narrating the
 * panel than to say it.
 */
const looksLikeToolSyntax = (s: string) => {
  // `test` on a /g regex is stateful — lastIndex carries between calls and the
  // second call on the same string returns false. Fresh instances each time.
  if (new RegExp(TOOL_SYNTAX.source, "i").test(s)) return true;
  if (new RegExp(JSON_TOOL_SYNTAX.source, "i").test(s)) return true;
  if (/\b(?:function|parameter)\s*=/.test(s)) return true;
  // A brace-quote pair anywhere is machine output; narration never contains one.
  return /\{\s*"/.test(s);
};

/**
 * Streams newline-delimited JSON events so the UI can build the answer as it
 * arrives rather than waiting for the whole turn:
 *
 *   {type:"tool_start", name}   a tool is running — show a chip
 *   {type:"panel", panel}       a panel is ready — pop it in immediately
 *   {type:"text", delta}        narration, token by token
 *   {type:"done" | "error"}
 */
export async function POST(request: Request) {
  const { query, history } = (await request.json()) as {
    query: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };

  if (!query?.trim()) return Response.json({ error: "Empty query" }, { status: 400 });

  // A key the visitor pasted into settings travels on the request and is used
  // for it alone — see parseByok. It is never persisted.
  const providers = resolveProviders(parseByok(request.headers.get("x-byok")));
  // A routed query needs no model to pick its tool, so a missing key is only
  // fatal when the router has nothing to offer.
  const routed = route(query);
  if (!providers.length && !routed) {
    return Response.json({ error: SETUP_HINT }, { status: 503 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // The stream is closed exactly once, in `finally`. Enqueuing after close
      // throws ERR_INVALID_STATE and fails the whole response, so guard both.
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM },
        ...(history ?? []).slice(-6).map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: query },
      ];

      const panels: Panel[] = [];
      const seen = new Map<string, string>();
      // Some tools answer in a sentence with no panel — "No open incidents
      // right now." With no model to narrate, that sentence IS the answer,
      // and ending the turn silent instead of saying it reads as a failure.
      let lastSummary = "";

      // Free tiers rate-limit. Rather than fail the turn, fall through to the
      // next configured provider and tell the client which one actually ran.
      let provider: ProviderConfig = providers[0];
      const withFailover = async <T>(fn: (p: ProviderConfig) => Promise<T>): Promise<T> => {
        for (const p of providers) {
          try {
            const out = await fn(p);
            if (p !== provider) {
              provider = p;
              send({ type: "meta", provider: p.name, model: p.model, failover: true });
            }
            return out;
          } catch (err) {
            if (!isTransient(err)) throw err;
          }
        }
        // Every provider is exhausted — say that, rather than surfacing whichever
        // one happened to fail last. "Gemini rate limit" is confusing when the
        // user only ever configured OpenRouter.
        throw new ProviderError(
          providers.length > 1
            ? `All ${providers.length} providers are rate-limited right now (${providers
                .map((p) => p.name)
                .join(", ")}). Wait a minute, or add another free key — Groq is the most generous.`
            : `${providers[0].name} is rate-limited. Add a second free key (Groq or Gemini) so BhimShila can fail over.`,
          429,
        );
      };

      try {
        if (providers.length) {
          send({ type: "meta", provider: provider.name, model: provider.model });
        }

        // Fast path: the router recognised the intent, so run the tool directly.
        // No schemas in the prompt, no round trip, and it works when every
        // provider is rate-limited.
        if (routed) {
          send({ type: "tool_start", name: routed.name, via: routed.via });
          try {
            const outcome = await runTool(routed.name, routed.args);
            if (outcome.panel) {
              panels.push(outcome.panel);
              send({ type: "panel", panel: outcome.panel });
            }
            if (outcome.ui) send({ type: "ui", ...outcome.ui });
            messages.push({
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "routed",
                type: "function" as const,
                function: { name: routed.name, arguments: JSON.stringify(routed.args) },
              }],
            });
            messages.push({ role: "tool", tool_call_id: "routed", content: outcome.summary });
            seen.set(`${routed.name}:${JSON.stringify(routed.args)}`, outcome.summary);
            lastSummary = outcome.summary;
          } catch (err) {
            // A failed source must not become a fabricated answer.
            //
            // Handing the model an empty turn after a tool error is how "Open-Meteo
            // 429" became the spoken sentence "news headlines are showing heavy rain
            // in Mumbai" — no panel, no data, complete invention. There is nothing to
            // narrate when the source is down, so nothing narrates it: the outage is
            // reported and the turn ends here.
            const reason = err instanceof Error ? err.message : String(err);
            send({ type: "tool_error", name: routed.name, message: reason });

            const panel: Panel = {
              panel: "note",
              title: "Source unavailable",
              subtitle: routed.name.replace(/_/g, " "),
              source: reason,
              headline: `I could not reach the data for that — ${reason}. Nothing is being reported rather than guessed.`,
              body:
                `The ${routed.name.replace(/_/g, " ")} lookup failed: ${reason}.\n\n` +
                `No figures are shown because none were retrieved. This is a source outage, ` +
                `not an all-clear — conditions may have changed. Try again shortly.`,
            };
            panels.push(panel);
            send({ type: "panel", panel });
            send({ type: "done", text: clean(narrate(panel)).trim(), panels: panels.length });
            return;
          }
        }

        // Resolve tool calls first, emitting each panel the moment it is ready.
        for (let turn = 0; routed ? false : turn < 3; turn++) {
          const reply = await withFailover((p) => chat(p, messages, TOOLS));
          if (!reply.toolCalls.length) {
            // No tools wanted — the model answered directly. `finally` closes.
            if (reply.content) {
              const t = clean(reply.content).trim();
              send({ type: "text", delta: t });
              send({ type: "done", text: t, panels: panels.length });
              return;
            }
            break;
          }

          messages.push({
            role: "assistant",
            content: reply.content || null,
            tool_calls: reply.toolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          });

          for (const call of reply.toolCalls) {
            const sig = `${call.name}:${JSON.stringify(call.args)}`;
            if (seen.has(sig)) {
              messages.push({ role: "tool", tool_call_id: call.id, content: seen.get(sig)! });
              continue;
            }

            send({ type: "tool_start", name: call.name });
            let content: string;
            try {
              const outcome = await runTool(call.name, call.args);
              if (outcome.panel) {
                panels.push(outcome.panel);
                send({ type: "panel", panel: outcome.panel });
              }
              if (outcome.ui) send({ type: "ui", ...outcome.ui });
              content = outcome.summary;
              lastSummary = outcome.summary;
            } catch (err) {
              content = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
              send({ type: "tool_error", name: call.name, message: content });
            }
            seen.set(sig, content);
            messages.push({ role: "tool", tool_call_id: call.id, content });
          }
        }

        // Now stream the narration over the tool results.
        let text = "";
        try {
          if (!providers.length) throw new Error("no provider");
          const stream = await withFailover(async (p) => {
            // Probe the provider before committing to it, so a rate-limited
            // stream falls over to the next key instead of ending the turn.
            const it = chatStreamText(p, messages);
            const first = await it.next();
            return { it, first };
          });

          // Cleaning each delta on its own is not enough: a tag split across two
          // deltas — "<func" then "tion=prepare_alert" — matches neither half,
          // and that is exactly how `<function=preparealert>` reached the
          // speech synthesiser. So the moment anything tag-shaped opens, the
          // stream stops emitting and only accumulates. A model that has begun
          // writing tool syntax is not producing an answer anyway, and the
          // panel-derived fallback below gives a real one.
          let poisoned = false;
          const push = (raw: string) => {
            if (poisoned) {
              text += raw;
              return;
            }
            // Tag-shaped or JSON-object-shaped. Only tags were checked, so a
            // model that answered in JSON streamed straight through to speech.
            const openTag = raw.search(/<[a-z/|]|\{\s*"/i);
            if (openTag >= 0) {
              poisoned = true;
              const safe = clean(raw.slice(0, openTag));
              if (safe) {
                text += safe;
                send({ type: "text", delta: safe });
              }
              text += raw.slice(openTag);
              return;
            }
            const piece = clean(raw);
            if (!piece) return;
            text += piece;
            send({ type: "text", delta: piece });
          };

          if (!stream.first.done && stream.first.value) push(stream.first.value);
          for await (const delta of { [Symbol.asyncIterator]: () => stream.it }) push(delta);
        } catch {
          /* fall through to the panel-derived fallback */
        }

        // If every provider is down, the panel still answers the question —
        // narrate it from its own data rather than showing the user an error.
        //
        // The same fallback catches a model that answered in tool syntax
        // instead of words: the panel is already correct and carries its own
        // headline, so there is a real answer to give rather than reading
        // "function equals prepare alert" aloud.
        if ((!text.trim() || looksLikeToolSyntax(text)) && panels.length) {
          text = clean(narrate(panels[panels.length - 1])).trim();
          send({ type: "text", delta: text, replaces: true });
        } else if (!text.trim() && lastSummary) {
          // No panel and no narrator, but the tool already answered in words.
          text = clean(lastSummary).trim();
          send({ type: "text", delta: text, replaces: true });
        }

        send({ type: "done", text: text.trim(), panels: panels.length });
      } catch (err) {
        const message =
          err instanceof ProviderError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error";

        // A panel already on screen is a real answer. Failing the turn because
        // the model that would have narrated it is rate-limited throws away
        // work that succeeded — and it is the exact case the deterministic
        // router exists for. Every panel carries enough to speak from, so the
        // error only surfaces when there is genuinely nothing to say.
        if (panels.length) {
          const text = clean(narrate(panels[panels.length - 1])).trim();
          send({ type: "text", delta: text, replaces: true });
          send({ type: "done", text, panels: panels.length, degraded: message });
        } else if (lastSummary) {
          const text = clean(lastSummary).trim();
          send({ type: "text", delta: text, replaces: true });
          send({ type: "done", text, panels: 0, degraded: message });
        } else {
          send({ type: "error", message });
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
