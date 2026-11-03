import { clientKey, limited } from "@/lib/ratelimit";
import { parseByok } from "@/lib/agent/llm";

/**
 * Neural text-to-speech.
 *
 * The browser's speechSynthesis is the floor, not the goal — see
 * lib/voice/voices.ts for picking well among the voices actually installed.
 * A neural provider is still worth more: consistent across every visitor's
 * machine, and it can speak Hinglish and Devanagari with one voice instead of
 * whatever the OS happened to ship.
 *
 * Any ONE of these keys turns it on:
 *   SARVAM_API_KEY      dashboard.sarvam.ai         trained specifically on
 *                                                   Indian languages and
 *                                                   code-mixed Hinglish
 *   FISH_API_KEY        fish.audio                  paid, multilingual, lowest
 *                                                   time-to-first-byte of the four
 *   GEMINI_API_KEY      aistudio.google.com/apikey  instant, no card, good Hindi,
 *                                                   and doubles as the LLM provider
 *   ELEVENLABS_API_KEY  elevenlabs.io               10k chars/month, best quality
 *   DEEPGRAM_API_KEY    deepgram.com                $200 credit, lowest latency
 *
 * With none set this returns 204 and the client falls back to the browser voice.
 */

export const maxDuration = 10;

const usable = (k?: string) => !!k && k.trim().length > 12 && !k.trim().startsWith("#");

/**
 * Speech cache.
 *
 * Free TTS tiers are rate-limited per minute, and a demo repeats itself — the
 * same suggestion chips, the same answers. Re-synthesising identical text is
 * both the slowest and the most rate-limit-expensive thing this route can do,
 * so identical text is served from memory. Bounded, because a long session
 * should not grow without limit.
 */
const CACHE_MAX = 40;
const cache = new Map<string, { body: ArrayBuffer; type: string; via: string }>();

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;
  // Refresh recency so the phrases actually being used survive eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cachePut(key: string, body: ArrayBuffer, type: string, via: string) {
  cache.set(key, { body, type, via });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

function audioResponse(body: ArrayBuffer, type: string, via: string, cached: boolean) {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-TTS": via,
      "X-TTS-Cache": cached ? "hit" : "miss",
    },
  });
}

/** Gemini returns raw PCM; browsers need a container. */
function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function POST(request: Request) {
  // A visitor who brought their own key is spending their own quota, so the
  // shared rate limit is not theirs to hit.
  const byok = parseByok(request.headers.get("x-byok"));

  // Neural TTS burns third-party quota; the browser voice is the fallback the
  // client already handles on any non-200, so limiting degrades, never breaks.
  if (!byok.gemini && limited(`tts:${clientKey(request)}`, 40, 10 * 60_000)) {
    return new Response(null, { status: 204, headers: { "X-TTS-Tried": "rate-limited" } });
  }
  const { text, lang } = (await request.json()) as { text: string; lang?: string };
  if (!text?.trim()) return new Response("Empty text", { status: 400 });
  const say = text.slice(0, 900);
  const key = `${lang ?? ""}|${process.env.GEMINI_VOICE ?? ""}|${say}`;

  const cached = cacheGet(key);
  if (cached) return audioResponse(cached.body, cached.type, cached.via, true);

  // Why a provider was skipped or failed. Silently falling through to the
  // browser voice makes a rate limit indistinguishable from a missing key.
  const tried: string[] = [];

  // 1. Sarvam Bulbul — first because it is trained on exactly this language
  // mix, not adapted onto it. Measured against our own clauses: hi-IN 1.25s,
  // en-IN 2.23s, both well under the per-clause budget this route works to.
  //
  // Response is base64 in `audios[0]`, one string per input, and the audio is
  // WAV — no container conversion needed the way Gemini's raw PCM required.
  const sarvam = process.env.SARVAM_API_KEY?.trim();
  if (!usable(sarvam)) tried.push("sarvam:no-key");
  else {
    try {
      const res = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: { "api-subscription-key": sarvam!, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: say,
          target_language_code: lang ?? "hi-IN",
          model: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
          speaker: process.env.SARVAM_VOICE || "shubh",
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const j = (await res.json()) as { audios?: string[] };
        const b64 = j.audios?.[0];
        if (b64) {
          const body = Buffer.from(b64, "base64");
          const buf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
          cachePut(key, buf, "audio/wav", "sarvam");
          return audioResponse(buf, "audio/wav", "sarvam", false);
        }
        tried.push("sarvam:no-audio-in-response");
      } else {
        tried.push(`sarvam:${res.status}`);
        console.warn(`[tts] sarvam ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      tried.push(`sarvam:${e instanceof Error ? e.name : "error"}`);
    }
  }

  // 2. Fish Audio — the paid fallback if Sarvam's key is missing or down.
  //
  // Fish also lets a voice be chosen by id, so the same voice speaks Hindi and
  // English rather than switching timbre mid-answer the way a per-language
  // voice table does.
  //
  // `latency: low` on purpose: this synthesises one clause at a time while the
  // previous one plays, so a shorter time-to-first-byte matters more here than
  // the last few percent of quality.
  const fish = process.env.FISH_API_KEY?.trim();
  if (!usable(fish)) tried.push("fish:no-key");
  else {
    try {
      const res = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fish!}`,
          "Content-Type": "application/json",
          // Header, not a body field — see their OpenAPI. s1 is the multilingual one.
          model: process.env.FISH_MODEL || "s1",
        },
        body: JSON.stringify({
          text: say,
          // Optional: a specific cloned/preset voice. Without it Fish uses its
          // default speaker, which is fine and keeps this working with no setup.
          ...(process.env.FISH_VOICE_ID ? { reference_id: process.env.FISH_VOICE_ID } : {}),
          format: "mp3",
          mp3_bitrate: 128,
          latency: "low",
          normalize: true,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const body = await res.arrayBuffer();
        // A 200 with an empty body is not audio. Caching it would make every
        // later request return silence instantly, which is worse than failing.
        if (body.byteLength > 512) {
          cachePut(key, body, "audio/mpeg", "fish");
          return audioResponse(body, "audio/mpeg", "fish", false);
        }
        tried.push("fish:empty-audio");
      } else {
        tried.push(`fish:${res.status}`);
        console.warn(`[tts] fish ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      tried.push(`fish:${e instanceof Error ? `${e.name}` : "error"}`);
    }
  }

  // 3. Gemini — one free key covers both the model and the voice
  const gemini = byok.gemini?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!usable(gemini)) tried.push("gemini:no-key");
  else {
    try {
      const model = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";
      const voice = process.env.GEMINI_VOICE || "Kore";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": gemini! },
          body: JSON.stringify({
            contents: [{ parts: [{ text: say }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
          }),
        },
      );
      if (res.ok) {
        const j = await res.json();
        const b64 = j?.candidates?.[0]?.content?.parts?.find(
          (p: { inlineData?: { data?: string } }) => p.inlineData?.data,
        )?.inlineData?.data;
        if (b64) {
          const wav = pcmToWav(Buffer.from(b64, "base64"));
          const body = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
          cachePut(key, body, "audio/wav", "gemini");
          return audioResponse(body, "audio/wav", "gemini", false);
        }
        tried.push("gemini:no-audio-in-response");
      } else {
        // 429 here is the common one — the free TTS preview tier is only a few
        // requests per minute, and it looks identical to a missing key unless
        // it is reported.
        tried.push(`gemini:${res.status}`);
        console.warn(`[tts] gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      tried.push(`gemini:${e instanceof Error ? `${e.name}: ${e.message}` : "error"}`);
    }
  }

  // 4. ElevenLabs — best quality, strongest Hindi and Hinglish code-switching
  const eleven = process.env.ELEVENLABS_API_KEY?.trim();
  if (!usable(eleven)) tried.push("elevenlabs:no-key");
  else {
    try {
      const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": eleven!, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: say,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.45, similarity_boost: 0.75 },
          }),
        },
      );
      if (res.ok && res.body) {
        const body = await res.arrayBuffer();
        cachePut(key, body, "audio/mpeg", "elevenlabs");
        return audioResponse(body, "audio/mpeg", "elevenlabs", false);
      }
      tried.push(`elevenlabs:${res.status}`);
    } catch (e) {
      tried.push(`elevenlabs:${e instanceof Error ? e.name : "error"}`);
    }
  }

  // 5. Deepgram — English only, but the lowest latency of the three
  const deepgram = process.env.DEEPGRAM_API_KEY?.trim();
  if (!usable(deepgram)) tried.push("deepgram:no-key");
  else {
    try {
      const res = await fetch("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en", {
        method: "POST",
        headers: { Authorization: `Token ${deepgram!}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: say }),
      });
      if (res.ok && res.body) {
        const body = await res.arrayBuffer();
        cachePut(key, body, "audio/mpeg", "deepgram");
        return audioResponse(body, "audio/mpeg", "deepgram", false);
      }
      tried.push(`deepgram:${res.status}`);
    } catch (e) {
      tried.push(`deepgram:${e instanceof Error ? e.name : "error"}`);
    }
  }

  // No neural voice available — the client falls back to the browser voice.
  // X-TTS-Tried says why, so a rate limit is distinguishable from a missing key.
  console.warn(`[tts] falling back to browser voice — ${tried.join(", ")}`);
  return new Response(null, {
    status: 204,
    headers: { "X-TTS": "none", "X-TTS-Tried": tried.join(","), "X-Lang": lang ?? "" },
  });
}
