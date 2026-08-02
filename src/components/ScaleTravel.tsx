"use client";

/**
 * ScaleTravel — a room's membership card in the scale manifold.
 *
 * Mount once in any full-canvas room and the room joins the quark→manifold
 * axis: a two-finger pinch pushes the scale position toward the band's walls;
 * the wall answers with a felt detent; 320ms of sustained push breaks through
 * and the site travels to the neighboring band's room. Neighbors that aren't
 * built yet simply hold — the world ends there, quietly, for now.
 *
 * Renders nothing until the hand is at a wall: then a vignette deepens with
 * edge pressure and the neighbor's name surfaces. No buttons, no chrome.
 * See lib/scale.ts for the physics and docs/gesture-grammar.md for the verb.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attachGestures } from "@/lib/gesture";
import {
  SCALE_BANDS,
  bandAt,
  bandIndexAt,
  entryScaleFor,
  initialScaleState,
  stepScale,
  type ScaleState,
} from "@/lib/scale";
import { detent as hapticDetent, crossing as hapticCrossing } from "@/lib/haptics";

const STORAGE_KEY = "objetdart:scale:s";

type EdgeUI = {
  pressure: number;
  towardLabel: string | null;
  crossing: boolean;
};

export default function ScaleTravel({ route }: { route: string }) {
  const router = useRouter();
  const [ui, setUi] = useState<EdgeUI>({ pressure: 0, towardLabel: null, crossing: false });
  const stateRef = useRef<ScaleState | null>(null);
  const inputRef = useRef({ zoomVel: 0, active: false });
  const lastPinchAtRef = useRef(0);
  const rafRef = useRef(0);
  const leavingRef = useRef(false);

  useEffect(() => {
    const entry = entryScaleFor(route);
    if (entry === null) return; // room has no scale address; nothing to mount

    const home = bandAt(entry);
    let s = entry;
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        const v = Number(stored);
        if (Number.isFinite(v) && bandAt(v).id === home.id) s = v;
      }
    } catch {
      /* storage unavailable — enter at band center */
    }
    stateRef.current = initialScaleState(s);

    let lastT = performance.now();
    let uiPressure = -1;

    const loop = (now: number) => {
      const st = stateRef.current;
      if (!st || leavingRef.current) return;
      const dt = now - lastT;
      lastT = now;
      // Wheel/trackpad pinches arrive as discrete ticks with no "end" —
      // without this decay a single tick would push forever and self-travel.
      if (inputRef.current.active && now - lastPinchAtRef.current > 150) {
        inputRef.current = { zoomVel: 0, active: false };
      }
      const { state, events, edgePressure } = stepScale(st, inputRef.current, dt);
      stateRef.current = state;

      let toward: string | null = null;
      for (const e of events) {
        if (e.type === "detent") hapticDetent();
        if (e.type === "edge") {
          const band = SCALE_BANDS.find((b) => b.id === e.toward);
          // An unbuilt neighbor holds forever: show nothing, promise nothing.
          toward = band?.route ? band.label : null;
          if (band && !band.route) {
            stateRef.current = { ...state, intentMs: Math.min(state.intentMs, 200) };
          }
        }
        if (e.type === "crossing") {
          const dest = SCALE_BANDS.find((b) => b.id === e.to);
          if (dest?.route && dest.route !== route) {
            leavingRef.current = true;
            hapticCrossing();
            try {
              window.sessionStorage.setItem(STORAGE_KEY, String(e.s));
            } catch {
              /* noop */
            }
            setUi({ pressure: 1, towardLabel: dest.label, crossing: true });
            window.setTimeout(() => router.push(dest.route as string), 380);
            return;
          }
        }
      }

      if (edgePressure !== uiPressure) {
        uiPressure = edgePressure;
        // Which wall is closer decides the whispered destination while idle.
        if (toward === null && edgePressure > 0) {
          const i = bandIndexAt(state.s);
          const band = SCALE_BANDS[i];
          const nearUpper = band.sMax - state.s < state.s - band.sMin;
          const n = SCALE_BANDS[i + (nearUpper ? 1 : -1)];
          toward = n?.route ? n.label : null;
        }
        setUi({ pressure: edgePressure, towardLabel: toward, crossing: false });
      }

      const resting =
        !inputRef.current.active && Math.abs(state.v) < 0.01 && state.intentMs === 0;
      if (!resting) rafRef.current = requestAnimationFrame(loop);
      else rafRef.current = 0;
    };

    const wake = () => {
      if (!rafRef.current && !leavingRef.current) {
        lastT = performance.now();
        rafRef.current = requestAnimationFrame(loop);
      }
    };

    const detach = attachGestures(
      document.body,
      {
        pinch: (e) => {
          if (e.phase === "end") {
            inputRef.current = { zoomVel: 0, active: false };
          } else {
            // Spreading fingers = zoom in = toward smaller scales (s falls).
            inputRef.current = { zoomVel: -e.velocity, active: true };
            lastPinchAtRef.current = performance.now();
          }
          wake();
        },
      },
      { noCapture: true, manageStyle: false, wheelZoom: false },
    );

    return () => {
      detach();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const st = stateRef.current;
      if (st) {
        try {
          window.sessionStorage.setItem(STORAGE_KEY, String(st.s));
        } catch {
          /* noop */
        }
      }
    };
  }, [route, router]);

  if (ui.pressure <= 0 && !ui.crossing) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 60,
        background: ui.crossing
          ? "rgba(9, 11, 14, 0.96)"
          : `radial-gradient(ellipse at center, transparent 52%, rgba(9, 11, 14, ${
              0.55 * ui.pressure
            }) 100%)`,
        transition: ui.crossing ? "background 360ms ease-in" : "none",
      }}
    >
      {ui.towardLabel && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "12vh",
            textAlign: "center",
            fontFamily: "var(--font-serif, Cormorant Garamond, serif)",
            fontStyle: "italic",
            fontSize: 18,
            letterSpacing: "0.04em",
            color: `rgba(242, 238, 230, ${ui.crossing ? 0.9 : 0.35 + 0.55 * ui.pressure})`,
          }}
        >
          toward {ui.towardLabel}
        </div>
      )}
    </div>
  );
}
