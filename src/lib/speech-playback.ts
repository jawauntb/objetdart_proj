"use client";

export type GeneratedSpeechPlayback = {
  model: string | null;
  voice: string | null;
  done: Promise<void>;
  stop: () => void;
};

type PlayGeneratedSpeechOptions = {
  context?: string;
  signal?: AbortSignal;
};

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function createAudioPlayback(audio: HTMLAudioElement, url: string, model: string | null, voice: string | null): GeneratedSpeechPlayback {
  let settled = false;
  let resolveDone: () => void = () => undefined;
  let rejectDone: (error: Error) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const cleanup = () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveDone();
  };

  const fail = () => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectDone(new Error("speech playback failed"));
  };

  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", fail, { once: true });

  return {
    model,
    voice,
    done,
    stop: finish,
  };
}

export async function playGeneratedSpeech(
  text: string,
  options: PlayGeneratedSpeechOptions = {},
): Promise<GeneratedSpeechPlayback> {
  const res = await fetch("/api/generate-speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      text,
      context: options.context,
    }),
  });

  if (!res.ok) {
    const details = await res.json().catch(() => ({}));
    throw new Error(typeof details?.error === "string" ? details.error : "speech generation failed");
  }

  const json = await res.json();
  const encoded = json?.audio?.data;
  if (typeof encoded !== "string") throw new Error("speech generation returned no audio");

  const mimeType = typeof json?.audio?.mimeType === "string" ? json.audio.mimeType : "audio/wav";
  const url = URL.createObjectURL(base64ToBlob(encoded, mimeType));
  const audio = new Audio(url);
  const playback = createAudioPlayback(
    audio,
    url,
    typeof json?.model === "string" ? json.model : null,
    typeof json?.voice === "string" ? json.voice : null,
  );

  try {
    await audio.play();
  } catch (error) {
    playback.stop();
    throw error;
  }

  return playback;
}

export function playBrowserSpeech(text: string): GeneratedSpeechPlayback | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;

  let settled = false;
  let resolveDone: () => void = () => undefined;
  let rejectDone: (error: Error) => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.86;
  utterance.pitch = 0.82;
  utterance.volume = 0.9;
  utterance.onend = () => {
    if (settled) return;
    settled = true;
    resolveDone();
  };
  utterance.onerror = () => {
    if (settled) return;
    settled = true;
    rejectDone(new Error("browser speech failed"));
  };

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);

  return {
    model: "browser-speech",
    voice: null,
    done,
    stop: () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.cancel();
      resolveDone();
    },
  };
}
