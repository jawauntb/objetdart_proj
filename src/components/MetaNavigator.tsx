"use client";

/**
 * MetaNavigator — same-scale peer ring.
 *
 * Pinch owns the quark→manifold axis. Twist owns the lens. This overlay owns
 * the *lateral* doors at one scale: drop ↔ seed, flowers ↔ birds, the shore
 * family, mountain ↔ clouds.
 *
 * Discovery: two-finger hold to the dwell tier opens the ring; while open,
 * twist cycles beads and a ceremony-hold (or two-finger tap) travels. Escape
 * or a one-finger tap closes. No instructions, no chrome until asked.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attachGestures } from "@/lib/gesture";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { peerCircleForRoute, type PeerRoom } from "@/lib/peers";
import { SCALE_BANDS, spectralRegisterFor } from "@/lib/scale";

type Props = {
  /** Current route, e.g. "/drop". */
  route: string;
};

export default function MetaNavigator({ route }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const openRef = useRef(false);
  const focusRef = useRef(0);
  const twistAcc = useRef(0);
  const circle = peerCircleForRoute(route);

  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);

  useEffect(() => {
    if (!circle || circle.rooms.length < 2) return;
    const audio = getFieldAudio();
    const rooms = circle.rooms;
    const selfIdx = Math.max(
      0,
      rooms.findIndex((r) => route === r.href || route.startsWith(`${r.href}/`)),
    );

    const chime = (room: PeerRoom) => {
      const band = SCALE_BANDS.find((b) => b.id === room.band);
      const s = band ? (band.sMin + band.sMax) / 2 : 0;
      const { baseHz } = spectralRegisterFor(s);
      const hz = Math.max(60, Math.min(1250, 220 * Math.pow(baseHz / 220, 0.62)));
      try {
        audio.playTone(hz, 0.16);
      } catch {
        /* audio may be locked until a gesture */
      }
    };

    const travel = (room: PeerRoom) => {
      if (room.href === route || route.startsWith(`${room.href}/`)) {
        setOpen(false);
        return;
      }
      haptics.crossing();
      chime(room);
      setOpen(false);
      router.push(room.href);
    };

    const detach = attachGestures(
      document.body,
      {
        hold: ({ fingers, phase, tier }) => {
          if (fingers !== 2) return;
          if (!openRef.current && phase === "enter" && tier >= 2) {
            setOpen(true);
            setFocus(selfIdx);
            focusRef.current = selfIdx;
            haptics.detent();
            const here = rooms[selfIdx];
            if (here) chime(here);
            return;
          }
          if (!openRef.current) return;
          if (phase === "enter" && tier >= 2) {
            const room = rooms[focusRef.current];
            if (room) {
              haptics.detent();
              chime(room);
            }
          }
          if (phase === "release" && tier >= 3) {
            const room = rooms[focusRef.current];
            if (room) travel(room);
          }
        },
        twist: ({ phase, angle, velocity }) => {
          if (!openRef.current) return;
          if (phase === "start") {
            twistAcc.current = 0;
            return;
          }
          if (phase === "end") return;
          twistAcc.current += angle;
          if (Math.abs(velocity) > 0.002 && Math.abs(twistAcc.current) > 0.4) {
            const step = twistAcc.current > 0 ? 1 : -1;
            twistAcc.current = 0;
            setFocus((f) => {
              const n = rooms.length;
              const next = ((f + step) % n + n) % n;
              focusRef.current = next;
              const room = rooms[next];
              if (room) {
                haptics.tap();
                chime(room);
              }
              return next;
            });
          }
        },
        tap: ({ fingers }) => {
          if (!openRef.current) return;
          if (fingers === 2) {
            const room = rooms[focusRef.current];
            if (room) travel(room);
            return;
          }
          if (fingers === 1) setOpen(false);
        },
      },
      { noCapture: true, manageStyle: false, wheelZoom: false },
    );

    const onKey = (e: KeyboardEvent) => {
      if (!openRef.current) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const step = e.key === "ArrowRight" ? 1 : -1;
        setFocus((f) => {
          const n = rooms.length;
          const next = ((f + step) % n + n) % n;
          focusRef.current = next;
          const room = rooms[next];
          if (room) {
            haptics.tap();
            chime(room);
          }
          return next;
        });
      }
      if (e.key === "Enter") {
        const room = rooms[focusRef.current];
        if (room) travel(room);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      detach();
      window.removeEventListener("keydown", onKey);
    };
  }, [circle, route, router]);

  if (!circle || circle.rooms.length < 2 || !open) return null;

  const n = circle.rooms.length;
  const cx = 50;
  const cy = 50;
  const radius = 28;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        pointerEvents: "none",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: "min(72vw, 320px)",
          aspectRatio: "1",
          position: "relative",
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 50% 45%, rgba(255,255,255,0.1), rgba(8,12,18,0.55) 62%, rgba(4,6,10,0.72))",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 24px 80px rgba(0,0,0,0.45)",
          backdropFilter: "blur(10px)",
        }}
      >
        {circle.rooms.map((room, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * radius;
          const y = cy + Math.sin(a) * radius;
          const active = i === focus;
          const here = route === room.href || route.startsWith(`${room.href}/`);
          return (
            <div
              key={room.key}
              style={{
                position: "absolute",
                left: `${x}%`,
                top: `${y}%`,
                transform: "translate(-50%, -50%)",
                color: active ? "rgba(255,248,230,0.95)" : "rgba(230,236,244,0.62)",
                fontFamily: "var(--font-serif, Georgia, serif)",
                fontSize: active ? 15 : 12,
                letterSpacing: "0.04em",
                textTransform: "lowercase",
                textShadow: active
                  ? "0 0 18px rgba(255,220,160,0.45)"
                  : "0 1px 8px rgba(0,0,0,0.5)",
                opacity: here && !active ? 0.45 : 1,
                transition: "font-size 160ms ease, color 160ms ease",
              }}
            >
              {room.label}
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "rgba(255,236,200,0.75)",
            boxShadow: "0 0 16px rgba(255,210,140,0.55)",
          }}
        />
      </div>
    </div>
  );
}
