"use client";

/**
 * LatticeVisitors — the lattice animals, recurring in every room.
 *
 * The animals of jawauntb/lattice-animal (consciousmachine.me) already walk
 * this universe headlessly through the MCP (docs/universe-mcp.md): each unit
 * of a field has a world of its own, and a body can inhabit a room with its
 * real polyomino. This is where a person sees them. In whatever room they
 * open, the animals that live there drift about it, and now and then one
 * wanders through from elsewhere in the commons — wearing the form of the
 * room it came from, becoming the form of the room it crosses (a star in
 * /stars, a membrane and nucleus in /cells, a ripple in /quanta), its cells
 * never leaving their lattice.
 *
 * It is chrome, not a room: it binds no gesture (pointer-events none, the
 * room underneath keeps every touch), writes no copy, and draws nothing when
 * there is nothing to draw. One canvas, one instanced draw
 * (`lattice-forms-layer.ts`) for every visitor in every form, paused when the
 * tab is hidden or the gallery holds the room, no frame loop at all between
 * visits, DPR capped. With no GPU it shows nothing. With reduced motion the
 * visitors hold still where they are.
 *
 * Nondeterminism, named: one session number from `crypto.getRandomValues`
 * picks *when* this visit's wanderers come, so two people do not see the same
 * crossing at the same second. Everything after that is a function of it.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isEmbeddedFrame } from "@/lib/room-runtime";

export default function LatticeVisitors() {
  const pathname = usePathname();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isEmbeddedFrame()) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    // The engine (the form atlas, the shader) arrives when the page is idle,
    // never on a room's first load; the first wanderer is seconds away anyway.
    const go = () => {
      void import("@/lib/lattice-visitors").then((m) => {
        if (!cancelled) stop = m.runVisitors(canvas, pathname);
      });
    };
    const idle = "requestIdleCallback" in window;
    const handle = idle ? window.requestIdleCallback(go, { timeout: 2500 }) : window.setTimeout(go, 1200);
    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      stop?.();
    };
  }, [pathname]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-lattice-visitors=""
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 22 }}
    />
  );
}
