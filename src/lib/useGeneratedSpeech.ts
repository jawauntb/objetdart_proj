"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  playBrowserSpeech,
  playGeneratedSpeech,
  type GeneratedSpeechPlayback,
} from "@/lib/speech-playback";

type UseGeneratedSpeechOptions = {
  context: string;
  loadingStatus?: string;
  fallbackStatus?: string;
  doneStatus?: string;
  stoppedStatus?: string;
  unavailableStatus?: string;
};

export function useGeneratedSpeech({
  context,
  loadingStatus = "gemini voice waking",
  fallbackStatus = "browser voice fallback",
  doneStatus = "voice complete",
  stoppedStatus = "speech stopped",
  unavailableStatus = "speech is not available in this browser",
}: UseGeneratedSpeechOptions) {
  const [speaking, setSpeaking] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<string | null>(null);
  const playbackRef = useRef<GeneratedSpeechPlayback | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const disposeSpeech = useCallback(() => {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  const stopSpeech = useCallback((status: string | null = stoppedStatus) => {
    disposeSpeech();
    setSpeaking(false);
    setSpeechStatus(status);
  }, [disposeSpeech, stoppedStatus]);

  const speakText = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;
    if (playbackRef.current || abortRef.current) {
      stopSpeech(stoppedStatus);
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();
    abortRef.current = controller;
    setSpeaking(true);
    setSpeechStatus(loadingStatus);

    try {
      const playback = await playGeneratedSpeech(text, {
        context,
        signal: controller.signal,
      });
      if (requestRef.current !== requestId) {
        playback.stop();
        return;
      }
      playbackRef.current = playback;
      setSpeechStatus(playback.model ? `speaking by ${playback.model}` : "speaking");
      await playback.done;
    } catch (error) {
      if (controller.signal.aborted || requestRef.current !== requestId) return;
      const fallback = playBrowserSpeech(text);
      if (!fallback) {
        setSpeechStatus(unavailableStatus);
        return;
      }
      playbackRef.current = fallback;
      setSpeechStatus(fallbackStatus);
      await fallback.done.catch(() => undefined);
    } finally {
      if (requestRef.current === requestId) {
        playbackRef.current = null;
        abortRef.current = null;
        setSpeaking(false);
        setSpeechStatus((current) => {
          if (!current || current === loadingStatus || current === fallbackStatus || current.startsWith("speaking")) {
            return doneStatus;
          }
          return current;
        });
      }
    }
  }, [
    context,
    doneStatus,
    fallbackStatus,
    loadingStatus,
    stopSpeech,
    stoppedStatus,
    unavailableStatus,
  ]);

  useEffect(() => () => disposeSpeech(), [disposeSpeech]);

  return {
    speaking,
    speechStatus,
    setSpeechStatus,
    speakText,
    stopSpeech,
  };
}
