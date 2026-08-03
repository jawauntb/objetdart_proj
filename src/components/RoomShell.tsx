"use client";

/**
 * RoomShell — the whole stack a room is owed, mounted by default.
 *
 * `RoomTemplate.tsx` showed a room author what to write; every author then
 * wrote it again, and the parts that were tedious (the far half of the gesture
 * grammar, the vessel, the audio register, the glimmer clock, the quiet clear)
 * were the parts that quietly went missing. The template stays — it is how you
 * learn the shape — but the shape is now also a component, so the default is
 * the complete room and the author's edits are additions rather than the
 * difference between complete and incomplete.
 *
 * A room author supplies its material and its laws:
 *
 *   <RoomShell
 *     route="/cells"
 *     voice={{ tap: …, plant: …, wind: … }}   // only what the material means
 *     letGo={{ label: "let the plasm go", onLetGo }}
 *   >
 *     <canvas … />
 *   </RoomShell>
 *
 * and gets, without asking: AxisChrome (ScaleTravel + MetaNavigator, with the
 * room manifest's overrides), the complete gesture binding table with a real
 * answer for every global verb (`lib/gesture/defaults`), the vessel bus, the
 * audio register glided from the route's scale address, haptics, the idle
 * glimmer clock, the keyboard dialect, reduced motion, and the quiet clear.
 *
 * What it deliberately does NOT own: the material. Rooms own their canvas,
 * their physics, and their palette completely — `children` is the room, and
 * the shell never draws.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AxisChrome from "@/components/AxisChrome";
import LetGo from "@/components/LetGo";
import { getFieldAudio, setScaleRegister } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { roomGestureBindings, type RoomVoice } from "@/lib/gesture/defaults";
import { onVessel } from "@/lib/vessel";
import { entryScaleFor } from "@/lib/scale";
import { roomChromeForRoute } from "@/rooms/registry";

export type RoomShellProps = {
  /** The room's route — the scale address, the peer ring, the chrome. */
  route: string;
  /** What this room's material actually means by each verb. */
  voice?: RoomVoice;
  /** The quiet clear, when the room keeps things. */
  letGo?: { label: string; onLetGo: () => void; visible: boolean };
  /** The surface gestures attach to. Defaults to the shell's own wrapper. */
  surfaceRef?: React.RefObject<HTMLElement | null>;
  /** Keyboard dialect — nothing on this site is touch-only. */
  keyboard?: {
    enter?: () => void;
    /** held Enter, once per ~250ms, with the elapsed hold in ms */
    enterHeld?: (elapsedMs: number) => void;
    escape?: () => void;
    arrow?: (dx: number, dy: number) => void;
  };
  /** Fires after ~20s with no contact, then every ~6s. Answer physically. */
  onGlimmer?: () => void;
  /** Reported once and on change, so the room can quiet itself. */
  onReducedMotion?: (reduced: boolean) => void;
  /** The room owns pinch (OrbitControls, its own zoom) — travel stands down. */
  ownsFrame?: boolean;
  /** Skip AxisChrome entirely (reading surfaces). */
  chrome?: boolean;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

const GLIMMER_IDLE_MS = 20000;
const GLIMMER_REPEAT_MS = 6000;

export default function RoomShell({
  route,
  voice,
  letGo,
  surfaceRef,
  keyboard,
  onGlimmer,
  onReducedMotion,
  ownsFrame = false,
  chrome = true,
  children,
  className,
  style,
}: RoomShellProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [reduced, setReduced] = useState(false);

  // Latest callbacks without re-attaching listeners every render — a room that
  // rebinds its gestures each frame drops the hold that was in progress.
  const voiceRef = useRef<RoomVoice | undefined>(voice);
  voiceRef.current = voice;
  const keyboardRef = useRef(keyboard);
  keyboardRef.current = keyboard;
  const glimmerRef = useRef(onGlimmer);
  glimmerRef.current = onGlimmer;

  const manifestChrome = useMemo(() => roomChromeForRoute(route), [route]);
  const travel = manifestChrome.travel && !ownsFrame;

  // The audio register is the scale address made audible: small scales ring
  // high and quick, large ones sink toward sub-bass. Setting it on mount is
  // what makes travelling between rooms a glissando rather than a cut.
  useEffect(() => {
    const s = entryScaleFor(route);
    if (s !== null) setScaleRegister(s);
  }, [route]);

  useEffect(() => {
    const surface = (surfaceRef?.current as HTMLElement | null) ?? wrapRef.current;
    if (!surface) return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyReduced = () => {
      setReduced(media.matches);
      onReducedMotion?.(media.matches);
    };
    applyReduced();
    media.addEventListener?.("change", applyReduced);

    const audio = getFieldAudio();

    // The two senses every unclaimed verb still lands in. Weight bends the
    // voice low and long for heavy acts (ceremony, knock, night) and short and
    // bright for light ones — so even the fallback is a continuous axis.
    const senses = {
      sound: (strength: number, weight: number) => {
        if (strength <= 0.02) return;
        const note = Math.round(72 - weight * 30 + strength * 8);
        audio.playNote(note, 120 + weight * 420);
      },
      touch: (strength: number) => {
        if (strength <= 0.02) return;
        if (strength > 0.75) haptics.bloom();
        else if (strength > 0.4) haptics.ripple(strength);
        else haptics.tap();
      },
    };

    let lastContact = performance.now();
    let lastGlimmer = 0;

    const bindings = roomGestureBindings({
      senses,
      // Read through the ref so a room can change its voice between renders
      // without the engine losing an in-flight hold.
      voice: new Proxy(
        {},
        {
          get: (_t, key: string) => (voiceRef.current as Record<string, unknown> | undefined)?.[key],
          has: (_t, key: string) => !!(voiceRef.current as Record<string, unknown> | undefined)?.[key],
        },
      ) as RoomVoice,
      reducedMotion: media.matches,
      travelOwnsFrame: travel,
      onContact: () => {
        lastContact = performance.now();
      },
    });

    const detachGestures = attachGestures(surface, bindings, { wheelZoom: false });

    // The vessel is passive here on purpose: the candle owns permission, and a
    // room never asks. Until the grant exists these simply never fire.
    const detachVessel = onVessel({
      tilt: (e) => bindings.tilt?.(e),
      shake: (e) => bindings.shake?.(e),
      knock: (e) => bindings.knock?.(e),
      flip: (e) => bindings.flip?.(e),
    });

    // The glimmer: after ~20s idle the room hints physically, never with text.
    const glimmerTimer = window.setInterval(() => {
      const now = performance.now();
      if (now - lastContact < GLIMMER_IDLE_MS) return;
      if (now - lastGlimmer < GLIMMER_REPEAT_MS) return;
      if (media.matches) return;
      lastGlimmer = now;
      glimmerRef.current?.();
    }, 1000);

    // The keyboard dialect. Held Enter mirrors the hold tiers so a keyboard
    // reaches the dwell and ceremony acts too — nothing is touch-only.
    let enterDownAt = 0;
    let enterTimer = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const kb = keyboardRef.current;
      lastContact = performance.now();
      if (e.key === "Enter" && !e.repeat) {
        enterDownAt = performance.now();
        kb?.enter?.();
        if (kb?.enterHeld) {
          enterTimer = window.setInterval(() => {
            kb.enterHeld?.(performance.now() - enterDownAt);
          }, 250);
        }
        return;
      }
      if (e.key === "Escape") kb?.escape?.();
      if (e.key === "ArrowLeft") kb?.arrow?.(-1, 0);
      if (e.key === "ArrowRight") kb?.arrow?.(1, 0);
      if (e.key === "ArrowUp") kb?.arrow?.(0, -1);
      if (e.key === "ArrowDown") kb?.arrow?.(0, 1);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (enterTimer) window.clearInterval(enterTimer);
      enterTimer = 0;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      media.removeEventListener?.("change", applyReduced);
      detachGestures();
      detachVessel();
      window.clearInterval(glimmerTimer);
      if (enterTimer) window.clearInterval(enterTimer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // `travel` is structural (it decides who owns pinch); voice/keyboard flow
    // through refs so changing them never re-attaches the engine.
  }, [route, travel, surfaceRef, onReducedMotion]);

  void reduced;

  return (
    <div ref={wrapRef} className={className} style={style} data-room-shell={route}>
      {children}
      {letGo ? (
        <LetGo label={letGo.label} onLetGo={letGo.onLetGo} visible={letGo.visible} />
      ) : null}
      {chrome ? (
        <AxisChrome route={route} travel={travel} peers={manifestChrome.peers} />
      ) : null}
    </div>
  );
}
