"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";

export default function SoundToggle() {
  const [muted, setMuted] = useState<boolean>(false);
  const [armed, setArmed] = useState(false);
  const pathname = usePathname() ?? "/";
  const isSignal = pathname.startsWith("/signal");
  const wakeLabel = isSignal ? "wake sound" : "wake the sea";
  const onLabel = isSignal ? "sound" : "the sea";

  // hydrate from storage and wire a first-gesture starter
  useEffect(() => {
    const a = getFieldAudio();
    setMuted(a.isMuted());

    const arm = async () => {
      await a.start();
      setArmed(true);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  const toggle = async () => {
    const a = getFieldAudio();
    await a.start();
    const next = !muted;
    a.setMuted(next);
    setMuted(next);
    setArmed(true);
  };

  return (
    <>
      <button
        onClick={toggle}
        aria-pressed={!muted}
        aria-label={muted ? "sound is off, click to turn on" : "sound is on, click to mute"}
        title={muted ? "sound off" : "sound on"}
        className="t-mono oda-sound-toggle"
        style={{
          position: "fixed",
          top: isSignal ? "calc(68px + env(safe-area-inset-top, 0px))" : undefined,
          bottom: isSignal ? undefined : "calc(56px + env(safe-area-inset-bottom, 0px))",
          right: `calc(${isSignal ? 12 : 16}px + env(safe-area-inset-right, 0px))`,
          zIndex: isSignal ? 24 : 35,
          background: isSignal ? "rgba(7, 15, 27, 0.86)" : "var(--paper)",
          border: isSignal ? "1px solid rgba(244, 238, 222, 0.24)" : "1px solid var(--rule)",
          padding: "0 14px",
          minHeight: 44,
          minWidth: 44,
          cursor: "pointer",
          fontSize: 11,
          letterSpacing: "0.10em",
          textTransform: "lowercase",
          lineHeight: 1,
          color: isSignal
            ? muted ? "rgba(244, 238, 222, 0.58)" : "rgba(244, 238, 222, 0.92)"
            : muted ? "var(--ink-2)" : "var(--ink)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          whiteSpace: "nowrap",
          transition: "color var(--t), border-color var(--t), background var(--t)",
          backdropFilter: isSignal ? "blur(8px)" : undefined,
          WebkitBackdropFilter: isSignal ? "blur(8px)" : undefined,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 7,
            height: 7,
            flex: "0 0 auto",
            borderRadius: "50%",
            background: muted ? "transparent" : isSignal ? "rgba(120, 200, 235, 0.9)" : "var(--sea)",
            border: muted
              ? isSignal ? "1px solid rgba(244, 238, 222, 0.28)" : "1px solid var(--rule)"
              : isSignal ? "1px solid rgba(120, 200, 235, 0.9)" : "1px solid var(--sea)",
            boxShadow: muted ? "none" : "0 0 6px rgba(120, 200, 235, 0.45)",
          }}
        />
        <span className="oda-sound-toggle__label">
          {!armed ? wakeLabel : muted ? "muted" : onLabel}
        </span>
      </button>
      <style>{`
        @media (max-width: 640px), (pointer: coarse) {
          .oda-sound-toggle {
            width: 44px;
            height: 44px;
            padding: 0 !important;
          }
          .oda-sound-toggle__label {
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip: rect(0 0 0 0);
            white-space: nowrap;
          }
        }
      `}</style>
    </>
  );
}
