"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Streaming voice input via the Web Speech API.
 *
 * Chosen over a server round-trip because it is real-time, free, needs no API
 * key, and supports hi-IN / en-IN. Interim results stream as you speak, which
 * is what makes it feel like ChatGPT/Claude voice rather than record-then-send.
 *
 * Hinglish: Indian speakers code-switch mid-sentence. hi-IN handles embedded
 * English words far better than en-IN handles Hindi, so hi-IN is the default.
 */

import { replyLanguage, type VoiceLang } from "./language";
import { byokHeader } from "../byok";
import { pickVoice, slotFor } from "./voices";
import { readVoicePrefs } from "./mode";

export type { VoiceLang };

interface SpeechRecognitionAlt { transcript: string }
interface SpeechRecognitionRes { readonly length: number; isFinal: boolean; [i: number]: SpeechRecognitionAlt }
interface SpeechRecognitionResList { readonly length: number; [i: number]: SpeechRecognitionRes }
interface SpeechRecognitionEvt { resultIndex: number; results: SpeechRecognitionResList }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvt) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

/** Capability never changes for the life of the page, so nothing to subscribe to. */
const subscribeNever = () => () => {};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * How long a pause means "I have finished talking".
 *
 * Chrome ends a recognition session on its own silence timer, which is several
 * seconds and feels like the app is ignoring you. Submitting on our own shorter
 * pause is most of what separates this from record-then-send. Too short and it
 * cuts people off mid-thought; 1.1s survives the pause someone takes while
 * recalling a district name.
 */
const SILENCE_MS = 1_100;

export function useVoice(opts: {
  lang: VoiceLang;
  onFinal: (text: string) => void;
  /** Called the moment speech is detected — used for barge-in */
  onSpeechStart?: () => void;
  /**
   * Keep the mic open after each turn, so a conversation does not need a click
   * per sentence. The caller pauses it while the agent is speaking.
   */
  conversational?: boolean;
}) {
  const { lang, onFinal, onSpeechStart, conversational = false } = opts;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** True while the user is actually making sound — drives the orb. */
  const [voiced, setVoiced] = useState(false);

  // A browser capability, not React state — reading it through
  // useSyncExternalStore avoids both a setState-in-effect cascade and the
  // hydration mismatch a lazy initialiser would cause (the server has no
  // window, so it must assume supported and let the client correct).
  const supported = useSyncExternalStore(
    subscribeNever,
    () => getRecognitionCtor() !== null,
    () => true,
  );

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const wantRef = useRef(false);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * True while the agent is speaking and the mic is deliberately down.
   *
   * Without it, pause() aborted the recogniser, abort fired onend, and onend's
   * conversational auto-restart saw wantRef still true and brought the mic
   * straight back — where it heard the agent's own voice, fired barge-in, and
   * cut the sentence off partway through. Every reply ended mid-word.
   */
  const pausedRef = useRef(false);

  // Keep callbacks fresh without re-creating the recognizer
  const onFinalRef = useRef(onFinal);
  const onSpeechStartRef = useRef(onSpeechStart);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  useEffect(() => { onSpeechStartRef.current = onSpeechStart; }, [onSpeechStart]);

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => { setListening(true); setError(null); };

    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const txt = res[0]?.transcript ?? "";
        if (res.isFinal) finalRef.current += txt + " ";
        else live += txt;
      }
      // Any sound at all interrupts playback — this is the barge-in trigger
      if (live || finalRef.current) {
        onSpeechStartRef.current?.();
        setVoiced(true);
      }
      setInterim(live);

      // Submit on our own pause rather than waiting for Chrome's, which is
      // several seconds long and reads as the app having missed you.
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => {
        setVoiced(false);
        const text = (finalRef.current + " " + live).trim();
        if (!text) return;
        finalRef.current = "";
        setInterim("");
        onFinalRef.current(text);
      }, SILENCE_MS);
    };

    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" ? "Microphone permission denied" : e.error);
      wantRef.current = false;
      setListening(false);
    };

    rec.onend = () => {
      // Anything the silence timer has not already submitted — Chrome can end
      // the session before our pause elapses.
      const text = finalRef.current.trim();
      finalRef.current = "";
      setInterim("");
      setVoiced(false);
      if (text) onFinalRef.current(text);

      // Chrome ends the session on silence; restart if the user is still
      // holding the mic open AND we did not put it down ourselves.
      if (wantRef.current && !pausedRef.current) {
        try { rec.start(); } catch { setListening(false); }
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;
    return () => {
      wantRef.current = false;
      if (silenceRef.current) clearTimeout(silenceRef.current);
      try { rec.abort(); } catch { /* already dead */ }
    };
  }, [lang]);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    wantRef.current = true;
    finalRef.current = "";
    try { rec.start(); } catch { /* already running */ }
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    pausedRef.current = false;
    if (silenceRef.current) clearTimeout(silenceRef.current);
    setVoiced(false);
    try { recRef.current?.stop(); } catch { /* not running */ }
  }, []);

  /**
   * Pause without ending the conversation.
   *
   * Used while the agent is talking. In conversational mode `resume()` brings
   * the mic straight back, so the user never clicks between turns — that
   * click is most of what makes voice UIs feel like a walkie-talkie.
   */
  const pause = useCallback(() => {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    pausedRef.current = true;
    setVoiced(false);
    try { recRef.current?.abort(); } catch { /* not running */ }
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    if (!conversational || !wantRef.current) return;
    finalRef.current = "";
    try { recRef.current?.start(); } catch { /* already running */ }
  }, [conversational]);

  const toggle = useCallback(() => {
    if (listening) stop(); else start();
  }, [listening, start, stop]);

  return { listening, interim, voiced, supported, error, start, stop, pause, resume, toggle };
}

/**
 * Speech output. Tries the server's neural voice first and falls back to the
 * browser's built-in synthesiser, so the app talks with zero configuration but
 * sounds properly good once a TTS key is present.
 *
 * The language is read off the sentence being spoken rather than a setting.
 * There used to be a Hindi/English switch in the header; a single Indian
 * sentence runs "Kerala mein red alert hai, kitne log affected hain" and having
 * to flip a mode mid-thought is exactly the friction that makes a voice UI feel
 * like a machine. See voice/language.ts.
 *
 * Cancel is instant in both paths — a talking agent must shut up the moment it
 * is spoken to.
 */
/**
 * When the last /api/tts call came back with nothing, and how long to believe
 * it. Module scope on purpose: the verdict is about the server's providers, not
 * about one component, and it must survive a remount mid-conversation.
 */
let neuralOutUntil = 0;
const NEURAL_COOLDOWN_MS = 90_000;

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [neural, setNeural] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const genRef = useRef(0);

  const cancel = useCallback(() => {
    genRef.current += 1; // invalidate any in-flight fetch
    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src.startsWith("blob:")) URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  /**
   * The browser voice list is populated asynchronously.
   *
   * `getVoices()` returns an empty array on the first call in Chrome and only
   * fills in when `voiceschanged` fires. Picking from the empty list left the
   * utterance on whatever the OS defaults to for the tag, and for hi-IN that is
   * frequently nothing at all — which is silence, not a fallback.
   */
  const voicesReady = useCallback(async (): Promise<SpeechSynthesisVoice[]> => {
    const now = window.speechSynthesis.getVoices();
    if (now.length) return now;
    return new Promise((resolve) => {
      const done = () => resolve(window.speechSynthesis.getVoices());
      window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
      // Some builds never fire the event when the list is already warm.
      setTimeout(done, 400);
    });
  }, []);

  /**
   * `decideFrom` is the whole reply; `text` may be only the part still unsaid.
   *
   * The voice must be chosen from the whole answer, because the choice is made
   * from the script and the script can differ between one sentence and the
   * next — an answer that opens in Hindi and ends on an English clause would
   * otherwise change speaker halfway through. One reply, one voice.
   */
  const speakBrowser = useCallback(
    async (text: string, lang: VoiceLang, decideFrom?: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();

      const voices = await voicesReady();

      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 1;

      // Ranked in voices.ts, from the script rather than the language tag —
      // and overridden by whoever listened to them. See lib/voice/voices.ts.
      const basis = decideFrom ?? text;
      const prefs = readVoicePrefs();
      const chosen = prefs[slotFor(basis)];
      const pick = (chosen && voices.find((v) => v.name === chosen)) ?? pickVoice(voices, basis);

      // Set the tag from the voice we actually got, not from the one we wanted.
      // Asking for hi-IN on a machine with no Hindi voice makes some engines
      // decline the utterance outright rather than substitute one, and a
      // declined utterance is indistinguishable from a broken app.
      if (pick) {
        u.voice = pick;
        u.lang = pick.lang;
      } else {
        // No voice matched at all — keep the requested tag and let the engine
        // do whatever it does, which is still better than asserting en-US.
        u.lang = voices.length ? voices[0].lang : lang;
      }

      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);

      // Chrome drops an utterance queued in the same tick as cancel(). The
      // await above usually covers that, but not when the voice list was
      // already warm, so the gap is made explicit rather than incidental.
      setTimeout(() => window.speechSynthesis.speak(u), 60);
    },
    [voicesReady],
  );

  /** One clause's audio, or null if the provider had nothing to give. */
  const fetchClip = useCallback(
    async (text: string, lang: VoiceLang, gen: number): Promise<HTMLAudioElement | null> => {
      // Chosen in Settings. On `device` the network is not touched at all —
      // the point of that mode is that the voice starts before a request could
      // even have left.
      if (readVoicePrefs().mode !== "neural") return null;

      // Every provider being out is a state that lasts minutes — a quota resets
      // on the hour, not between two sentences. Asking again before each reply
      // spends a round trip to be told the same thing, and that round trip is
      // pure silence in front of the user. Remember the answer briefly.
      if (Date.now() < neuralOutUntil) return null;

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...byokHeader() },
        body: JSON.stringify({ text, lang }),
      });
      if (gen !== genRef.current) return null;
      if (res.status === 204 || !res.ok) {
        neuralOutUntil = Date.now() + NEURAL_COOLDOWN_MS;
        return null;
      }
      neuralOutUntil = 0;
      const blob = await res.blob();
      if (gen !== genRef.current) return null;
      return new Audio(URL.createObjectURL(blob));
    },
    [],
  );

  /**
   * Speak, starting as soon as the first sentence is ready.
   *
   * Neural synthesis scales with length — measured against Gemini, 25
   * characters took 3.3s and 145 took 9.1s. Sending the whole reply and waiting
   * meant nine seconds of silence after the panels had already appeared, which
   * reads as the app having crashed.
   *
   * So the reply is split on sentence boundaries and only the first clause is
   * synthesised before playback begins; the next is fetched while the current
   * one plays, so every gap after the first is hidden behind audio. First sound
   * arrives in about the time the shortest clause takes.
   *
   * Splitting on sentences rather than a character count is what keeps it from
   * sounding chopped — a clause break is a place a person would pause anyway.
   */
  const speak = useCallback(
    async (text: string) => {
      const full = text.trim();
      if (!full) return;
      cancel();
      const gen = genRef.current;
      const lang = replyLanguage(full);
      setSpeaking(true);

      // Devanagari danda as well as the Latin stops — a Hindi reply ends its
      // sentences with "।" and splitting only on "." would treat the whole
      // thing as one clause and lose the entire benefit.
      const sentences = full
        .split(/(?<=[.!?।])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      // Only the FIRST clause is cut short, at a comma if there is one.
      //
      // Synthesis time tracks length, so the opening clause is the entire
      // waiting cost — every later one is fetched while its predecessor plays
      // and costs nothing. Measured: 91 characters took 6.0s, 25 took 3.3s. A
      // short opener is the difference between an answer that starts and one
      // that appears to have hung. Later clauses stay whole, because chopping
      // them buys nothing and makes the delivery sound clipped.
      const FIRST_MAX = 45;
      const clauses = sentences.flatMap((s, i) => {
        if (i > 0 || s.length <= FIRST_MAX) return [s];
        const cut = s.slice(0, FIRST_MAX).lastIndexOf(",");
        return cut > 12 ? [s.slice(0, cut + 1).trim(), s.slice(cut + 1).trim()] : [s];
      });

      /**
       * Hand the rest of the answer to the device voice.
       *
       * From `i` onward, never from the start. The fallback used to re-speak
       * the whole reply, so a provider that died after the opening clause gave
       * you the first sentence in one voice and then the entire answer again in
       * another — which is what it sounds like when an app is broken, and it is
       * exactly what happened when Gemini's quota ran out mid-sentence.
       */
      const handOver = (from: number) => {
        const rest = clauses.slice(from).join(" ").trim();
        if (rest) speakBrowser(rest, lang, full);
      };

      try {
        let current = await fetchClip(clauses[0], lang, gen);
        if (gen !== genRef.current) return;

        // Nothing came back at all — no key, rate limited, provider down.
        if (!current) {
          setNeural(false);
          handOver(0);
          return;
        }
        setNeural(true);

        for (let i = 0; i < clauses.length; i++) {
          if (gen !== genRef.current) return;
          const audio = current;
          // The provider stopped answering partway through. Finish the sentence
          // in the device voice rather than going quiet in the middle of it.
          if (!audio) {
            setNeural(false);
            handOver(i);
            break;
          }

          // Start the next fetch before awaiting this clip, so the network
          // round trip overlaps with playback instead of following it.
          const nextPromise =
            i + 1 < clauses.length ? fetchClip(clauses[i + 1], lang, gen).catch(() => null) : null;

          audioRef.current = audio;
          await new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            audio.play().catch(() => resolve());
          });

          current = nextPromise ? await nextPromise : null;
        }
      } catch {
        if (gen === genRef.current) handOver(0);
      } finally {
        if (gen === genRef.current) setSpeaking(false);
      }
    },
    [cancel, speakBrowser, fetchClip],
  );

  useEffect(() => cancel, [cancel]);

  return { speak, cancel, speaking, neural };
}
