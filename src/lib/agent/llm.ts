/**
 * Provider-agnostic chat client.
 *
 * Every provider below speaks the OpenAI chat-completions shape, so one plain
 * fetch client covers all of them — no SDK, no lock-in. Set ONE key in
 * .env.local and the right provider is picked automatically.
 *
 * All of these have a genuinely free tier that supports tool calling:
 *
 *   SARVAM_API_KEY      dashboard.sarvam.ai          Indic-tuned, dedicated (not crowd-shared)
 *   GROQ_API_KEY        console.groq.com/keys        fastest — best for voice
 *   CEREBRAS_API_KEY    cloud.cerebras.ai            also very fast
 *   GEMINI_API_KEY      aistudio.google.com/apikey   most generous limits
 *   OPENROUTER_API_KEY  openrouter.ai/keys           widest model choice
 *
 * ANTHROPIC_API_KEY is honoured too if you ever have one — it is not required.
 */

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Free tiers are rate-limited; surface that in errors rather than a raw 429 */
  freeTier: boolean;
  /**
   * The model thinks before it answers, and bills the thinking as latency.
   *
   * Worth knowing because it is not a uniform improvement. On a question that
   * needs judgement it is the reason to pick this provider; on a fixed
   * extraction — "turn this sentence into five JSON fields" — it is strictly
   * worse. Measured on our own triage prompt: 16.3 seconds, and an empty
   * `content` because the reasoning consumed the whole token budget. The same
   * prompt on a non-reasoning model: 850ms and valid JSON.
   *
   * So callers that want extraction rather than judgement can put these last.
   * See sortForExtraction below.
   */
  reasoning?: boolean;
}

const CANDIDATES: {
  env: string;
  name: string;
  baseUrl: string;
  model: string;
  modelEnv: string;
  freeTier: boolean;
  reasoning?: boolean;
}[] = [
  {
    env: "SARVAM_API_KEY",
    name: "Sarvam",
    // chat() and chatStreamText() both append "/chat/completions" — Sarvam's
    // actual path is versioned (.../v1/chat/completions), so the v1 has to
    // live in the base or every request 404s.
    baseUrl: "https://api.sarvam.ai/v1",
    // Indic-tuned, 23 languages, 128K context. Measured against our own tool
    // schema: 1.2s and the correct tool with the correct argument — faster
    // than OpenRouter's free model and, unlike it, not a pool every other team
    // at the same event is also drawing from at once.
    model: "sarvam-105b",
    modelEnv: "SARVAM_MODEL",
    freeTier: false,
    reasoning: true,
  },
  {
    env: "OPENROUTER_API_KEY",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    // Best free model on OpenRouter that supports tool calling: 550B MoE with
    // ~55B active params, 1M context. Swap to nemotron-3-super-120b-a12b:free
    // via OPENROUTER_MODEL if you want lower latency.
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    modelEnv: "OPENROUTER_MODEL",
    freeTier: true,
  },
  {
    env: "GROQ_API_KEY",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    // Was llama-3.3-70b-versatile, which Groq has since retired — every call
    // to this provider was 404ing, so the "four providers" failover chain was
    // really three and nobody noticed, because the layer above it silently
    // moved on to the next key. Checked against their live model list rather
    // than picked from memory: this is the fastest of the ones they serve that
    // still does tool calling, at ~570ms on our own tool schema.
    model: "openai/gpt-oss-20b",
    modelEnv: "GROQ_MODEL",
    freeTier: true,
  },
  {
    env: "CEREBRAS_API_KEY",
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "llama-3.3-70b",
    modelEnv: "CEREBRAS_MODEL",
    freeTier: true,
  },
  {
    env: "GEMINI_API_KEY",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    // An alias, not a pinned version — pinned Gemini models get retired and
    // start 404ing for new keys, which is exactly how this one broke.
    model: "gemini-flash-latest",
    modelEnv: "GEMINI_MODEL",
    freeTier: true,
  },
];

const looksLikeAKey = (v: string | undefined): v is string =>
  !!v && v.trim().length > 12 && !v.trim().startsWith("#");

/**
 * Every configured provider, best first.
 *
 * Free tiers rate-limit, and a 429 mid-demo would take the whole agent down.
 * With a second key present the caller can fail over instead of failing.
 */
/**
 * Keys a visitor brought with them, for this request only.
 *
 * The deployed instance shares one set of free-tier keys across everyone who
 * opens it, so they rate-limit within minutes of being useful. Someone with
 * their own key should be able to use it.
 *
 * It is never written down. It arrives on the request, resolves a provider,
 * makes the call, and goes out of scope — no database row, no log line, no
 * cookie. A key is a credential, and storing someone else's credential to save
 * them re-pasting it is a trade nobody asked for.
 */
export type ByokKeys = Partial<Record<"openrouter" | "groq" | "gemini" | "anthropic", string>>;

const BYOK_ENV: Record<string, keyof ByokKeys> = {
  OPENROUTER_API_KEY: "openrouter",
  GROQ_API_KEY: "groq",
  GEMINI_API_KEY: "gemini",
};

/**
 * Parse the header a browser sends. Malformed input yields no keys rather than
 * an error — a bad paste should degrade to the server's own keys, not break
 * the turn.
 */
export function parseByok(header: string | null): ByokKeys {
  if (!header) return {};
  try {
    const raw = JSON.parse(header) as Record<string, unknown>;
    const out: ByokKeys = {};
    for (const k of ["openrouter", "groq", "gemini", "anthropic"] as const) {
      const v = raw[k];
      if (typeof v === "string" && looksLikeAKey(v.trim())) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function resolveProviders(byok: ByokKeys = {}): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  for (const c of CANDIDATES) {
    // The visitor's own key wins. Theirs has quota left; ours is shared with
    // everyone else who opened the page today.
    const brought = byok[BYOK_ENV[c.env]];
    const key = brought?.trim() || process.env[c.env]?.trim();
    if (looksLikeAKey(key)) {
      out.push({
        name: c.name,
        baseUrl: c.baseUrl,
        model: process.env[c.modelEnv] || c.model,
        apiKey: key,
        freeTier: c.freeTier && !brought,
        reasoning: c.reasoning,
      });
    }
  }
  const anthropic = byok.anthropic?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (looksLikeAKey(anthropic)) {
    out.push({
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5",
      apiKey: anthropic,
      freeTier: false,
    });
  }
  return out;
}

/**
 * Reorder so extraction does not pay for reasoning.
 *
 * The default order is best-first for judgement, which is right for the agent:
 * a question about what to do with a red alert deserves the model that thinks
 * hardest. Turning "paani ghar me ghus gaya, chhat pe phase hain" into five
 * JSON fields deserves the opposite, and the numbers are not close — 16.3
 * seconds and an empty answer against 850ms and valid JSON.
 *
 * Stable within each group, so a caller still gets the intended preference
 * order among providers of the same kind. Nothing is dropped: a reasoning
 * provider is still tried if it is the only one configured, because a slow
 * answer beats none.
 */
export function sortForExtraction(providers: ProviderConfig[]): ProviderConfig[] {
  return [...providers].sort((a, b) => Number(!!a.reasoning) - Number(!!b.reasoning));
}

/**
 * A 400 that is really "this provider wants something the others do not".
 *
 * Gemini rejects a replayed tool conversation with "Function call is missing a
 * thought_signature", a field its own native API adds and the OpenAI-compatible
 * shape has nowhere to carry. Because it is a 400 the rule below refused to
 * fail over, and the whole turn died — no answer, no narration — after the
 * tools had already produced correct panels.
 *
 * These are not malformed requests in the universal sense. A provider saying
 * the request is fine for everyone else deserves to be tried.
 */
const PROVIDER_QUIRK =
  /thought_signature|thought signature|unsupported (?:parameter|field)|not supported for this model/i;

/**
 * Whether to try the next provider.
 *
 * Almost always yes. A rate limit is obvious, but a retired model (404), a
 * rejected key (401) or an unreachable host (0) is just as much a reason to
 * fall through — one bad provider should not take down a chain where another
 * key works. Only a genuinely malformed request fails identically everywhere,
 * and PROVIDER_QUIRK carves out the 400s that merely look that way.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false;
  return err.status !== 400 || PROVIDER_QUIRK.test(err.message);
}

export const SETUP_HINT =
  "No model key found. Put OPENROUTER_API_KEY=sk-or-v1-… on its own line in .env " +
  "(get one free at openrouter.ai/keys) and restart the dev server. " +
  "Keep any comment on a separate line — an inline # comment is read as part of the key.";

// ---------------------------------------------------------------- chat types

export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ChatReply {
  content: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}

export class ProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Reach a provider, turning a network failure into a ProviderError.
 *
 * `fetch` throws a bare TypeError when it cannot connect — DNS, TLS, a provider
 * simply down. That is not a ProviderError, so the failover chain did not
 * recognise it and the whole turn died on the first unreachable provider, which
 * is the exact situation having four of them is supposed to survive. Status 0
 * means "never got an answer", and it fails over like any other transient.
 */
async function reach(provider: ProviderConfig, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new ProviderError(
      `${provider.name} unreachable: ${e instanceof Error ? e.message : "network error"}`,
      0,
    );
  }
}

export async function chat(
  provider: ProviderConfig,
  messages: ChatMessage[],
  tools: ChatTool[],
): Promise<ChatReply> {
  const res = await reach(provider, `${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.2,
      max_tokens: 1200,
      tools: tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: "auto",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      throw new ProviderError(`${provider.name} rejected the API key.`, 401);
    }
    if (res.status === 429) {
      throw new ProviderError(
        `${provider.name} free tier rate limit hit. Wait a moment, or add a different provider key.`,
        429,
      );
    }
    throw new ProviderError(`${provider.name} error ${res.status}: ${body.slice(0, 300)}`, res.status);
  }

  const j = await res.json();
  return toReply(j.choices?.[0]?.message ?? {});
}

/**
 * Stream the final narration token by token.
 *
 * Tool calls are resolved with the non-streaming `chat()` above — streaming
 * tool-argument deltas buys nothing here, because a tool can't run until its
 * arguments are complete anyway. What the user actually sees streaming is the
 * sentence, and that is what this covers.
 */
export async function* chatStreamText(
  provider: ProviderConfig,
  messages: ChatMessage[],
): AsyncGenerator<string> {
  const res = await reach(provider, `${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.2,
      max_tokens: 400,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    throw new ProviderError(`${provider.name} stream error ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        /* keep-alive or partial frame — skip */
      }
    }
  }
}

function toReply(choice: {
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}): ChatReply {

  const toolCalls = (choice.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => {
      let args: Record<string, unknown> = {};
      try {
        // Some open models emit an empty string or already-parsed object
        args =
          typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments || "{}")
            : (tc.function.arguments ?? {});
      } catch {
        args = {};
      }
      return { id: tc.id, name: tc.function.name, args };
    },
  );

  return { content: choice.content ?? "", toolCalls };
}
