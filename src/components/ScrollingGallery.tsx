"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { GALLERY_ROUTES } from "@/lib/routes";

export default function ScrollingGallery() {
  const galleryRef = useRef<HTMLElement | null>(null);
  const frameRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [enteredIndex, setEnteredIndex] = useState<number | null>(null);

  const leaveToy = useCallback(() => {
    setEnteredIndex(null);
    galleryRef.current?.focus({ preventScroll: true });
  }, []);

  const leaveOnEscape = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") leaveToy();
  }, [leaveToy]);

  const connectFrameShortcuts = useCallback((event: SyntheticEvent<HTMLIFrameElement>) => {
    const frameWindow = event.currentTarget.contentWindow;
    frameWindow?.removeEventListener("keydown", leaveOnEscape);
    frameWindow?.addEventListener("keydown", leaveOnEscape);
  }, [leaveOnEscape]);

  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = Number((visible.target as HTMLElement).dataset.roomIndex);
        if (!Number.isFinite(index)) return;
        setActiveIndex(index);
        setEnteredIndex((current) => (current === index ? current : null));
      },
      { root: gallery, threshold: [0.45, 0.6, 0.75] },
    );

    frameRefs.current.forEach((frame) => frame && observer.observe(frame));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", leaveOnEscape);
    return () => window.removeEventListener("keydown", leaveOnEscape);
  }, [leaveOnEscape]);

  const goToRoom = (index: number) => {
    frameRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main
      ref={galleryRef}
      className="scrolling-gallery"
      tabIndex={-1}
      aria-label="scrolling toy gallery"
    >
      <div className="scrolling-intro" aria-hidden="true">
        <span>one page · {GALLERY_ROUTES.length} rooms</span>
        <span>scroll to wander · tap to play</span>
      </div>

      {GALLERY_ROUTES.map((room, index) => {
        const entered = enteredIndex === index;
        const shouldLoad = Math.abs(activeIndex - index) <= 1;

        return (
          <section
            key={room.key}
            ref={(node) => { frameRefs.current[index] = node; }}
            data-room-index={index}
            className={`scrolling-room${entered ? " is-entered" : ""}`}
            aria-label={`${room.key}: ${room.desc}`}
          >
            <div className="scrolling-room__stage">
              {shouldLoad ? (
                <iframe
                  src={room.href}
                  title={`${room.key} interactive toy`}
                  className="scrolling-room__frame"
                  loading="lazy"
                  onLoad={connectFrameShortcuts}
                  tabIndex={entered ? 0 : -1}
                  aria-hidden={!entered}
                  style={{ pointerEvents: entered ? "auto" : "none" }}
                />
              ) : (
                <div className="scrolling-room__sleep" aria-hidden="true">
                  <span>{room.key}</span>
                </div>
              )}

              {!entered ? (
                <button
                  type="button"
                  className="scrolling-room__veil"
                  onClick={() => setEnteredIndex(index)}
                  aria-label={`enter ${room.key} toy`}
                >
                  <span className="scrolling-room__count">
                    {String(index + 1).padStart(2, "0")} / {String(GALLERY_ROUTES.length).padStart(2, "0")}
                  </span>
                  <span className="scrolling-room__name">{room.key}</span>
                  <span className="scrolling-room__desc">{room.desc}</span>
                  <span className="scrolling-room__enter">enter toy ↘</span>
                </button>
              ) : (
                <div className="scrolling-room__controls">
                  <button type="button" onClick={leaveToy}>leave toy · keep scrolling ↓</button>
                  <Link href={room.href}>open alone ↗</Link>
                  <span>esc</span>
                </div>
              )}
            </div>
          </section>
        );
      })}

      <section className="scrolling-end" aria-label="end of the current gallery orbit">
        <p>the cabinet has no real end.</p>
        <button type="button" onClick={() => goToRoom(0)}>
          circle back to {GALLERY_ROUTES[0]?.key ?? "the start"} ↑
        </button>
      </section>

      <aside className="scrolling-position" aria-label="gallery position">
        <button
          type="button"
          aria-label="previous toy"
          onClick={() => goToRoom(Math.max(0, activeIndex - 1))}
          disabled={activeIndex === 0}
        >
          ↑
        </button>
        <span>{String(activeIndex + 1).padStart(2, "0")}</span>
        <i aria-hidden="true" />
        <span>{String(GALLERY_ROUTES.length).padStart(2, "0")}</span>
        <button
          type="button"
          aria-label="next toy"
          onClick={() => goToRoom(Math.min(GALLERY_ROUTES.length - 1, activeIndex + 1))}
          disabled={activeIndex === GALLERY_ROUTES.length - 1}
        >
          ↓
        </button>
      </aside>

      <style jsx>{`
        .scrolling-gallery {
          position: relative;
          height: calc(100vh - 56px - env(safe-area-inset-top, 0px));
          overflow-y: auto;
          overscroll-behavior-y: contain;
          scroll-snap-type: y proximity;
          scrollbar-width: none;
          background: #07101b;
          outline: none;
        }
        .scrolling-gallery::-webkit-scrollbar { display: none; }
        .scrolling-intro {
          position: fixed;
          left: max(18px, env(safe-area-inset-left, 0px));
          bottom: calc(16px + env(safe-area-inset-bottom, 0px));
          z-index: 15;
          display: flex;
          flex-direction: column;
          gap: 3px;
          color: rgba(244, 238, 222, 0.7);
          font: 10px/1.4 var(--font-mono);
          letter-spacing: 0.08em;
          text-transform: lowercase;
          pointer-events: none;
          mix-blend-mode: difference;
        }
        .scrolling-room,
        .scrolling-end {
          height: 100%;
          min-height: 520px;
          scroll-snap-align: start;
          scroll-snap-stop: normal;
          position: relative;
        }
        .scrolling-room__stage {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: #07101b;
        }
        .scrolling-room__frame {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
          background: var(--paper);
        }
        .scrolling-room__sleep {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          background: radial-gradient(circle at center, #142337, #07101b 68%);
          color: rgba(244, 238, 222, 0.18);
          font: italic clamp(48px, 12vw, 160px)/1 var(--font-serif);
        }
        .scrolling-room__veil {
          position: absolute;
          inset: 0;
          z-index: 3;
          width: 100%;
          border: 0;
          padding: clamp(24px, 6vw, 80px);
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-end;
          text-align: left;
          color: rgba(248, 243, 232, 0.96);
          background: linear-gradient(180deg, rgba(4, 9, 15, 0.06) 35%, rgba(4, 9, 15, 0.78));
          cursor: pointer;
          touch-action: pan-y;
        }
        .scrolling-room__veil::before {
          content: "";
          position: absolute;
          inset: 0;
          border: 1px solid rgba(244, 238, 222, 0.16);
          pointer-events: none;
        }
        .scrolling-room__veil::after {
          content: "";
          position: absolute;
          z-index: 0;
          top: 0;
          left: 0;
          right: 0;
          height: 56px;
          background: rgba(5, 11, 18, 0.96);
          border-bottom: 1px solid rgba(244, 238, 222, 0.14);
          pointer-events: none;
        }
        .scrolling-room__veil > span { position: relative; z-index: 1; }
        .scrolling-room__count,
        .scrolling-room__desc,
        .scrolling-room__enter {
          font-family: var(--font-mono);
          text-transform: lowercase;
          letter-spacing: 0.08em;
        }
        .scrolling-room__count {
          position: absolute;
          z-index: 2;
          top: 20px;
          left: clamp(24px, 6vw, 80px);
          font-size: 10px;
          opacity: 0.72;
        }
        .scrolling-room__name {
          font-family: var(--font-serif);
          font-size: clamp(68px, 16vw, 210px);
          font-weight: 300;
          font-style: italic;
          line-height: 0.72;
          letter-spacing: -0.05em;
          text-shadow: 0 2px 30px rgba(0, 0, 0, 0.35);
        }
        .scrolling-room__desc {
          margin-top: clamp(22px, 4vh, 44px);
          font-size: clamp(10px, 1.2vw, 13px);
          opacity: 0.76;
        }
        .scrolling-room__enter {
          align-self: flex-end;
          margin-top: -1.2em;
          font-size: 11px;
          border-bottom: 1px solid rgba(244, 238, 222, 0.6);
          padding-bottom: 5px;
        }
        .scrolling-room__controls {
          position: absolute;
          z-index: 5;
          top: 0;
          left: 0;
          right: 0;
          min-height: 56px;
          padding: 6px max(14px, env(safe-area-inset-right, 0px)) 6px max(14px, env(safe-area-inset-left, 0px));
          display: flex;
          align-items: center;
          gap: 10px;
          color: rgba(244, 238, 222, 0.92);
          background: rgba(5, 11, 18, 0.9);
          border-bottom: 1px solid rgba(244, 238, 222, 0.16);
          backdrop-filter: blur(12px);
        }
        .scrolling-room__controls button,
        .scrolling-room__controls a {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          border: 1px solid rgba(244, 238, 222, 0.25);
          border-radius: 999px;
          padding: 0 14px;
          color: inherit;
          background: transparent;
          font: 10px/1 var(--font-mono);
          letter-spacing: 0.06em;
          text-transform: lowercase;
          cursor: pointer;
        }
        .scrolling-room__controls span {
          margin-left: auto;
          padding-right: 4px;
          font: 9px/1 var(--font-mono);
          letter-spacing: 0.08em;
          opacity: 0.5;
          text-transform: uppercase;
        }
        .scrolling-end {
          display: grid;
          place-content: center;
          gap: 20px;
          text-align: center;
          color: rgba(244, 238, 222, 0.9);
          background: radial-gradient(circle at 50% 45%, #1b2b3f, #07101b 70%);
        }
        .scrolling-end p {
          margin: 0;
          font: italic clamp(36px, 7vw, 88px)/1 var(--font-serif);
        }
        .scrolling-end button {
          justify-self: center;
          min-height: 44px;
          border: 1px solid rgba(244, 238, 222, 0.35);
          border-radius: 999px;
          padding: 0 18px;
          color: inherit;
          background: transparent;
          font: 11px/1 var(--font-mono);
          letter-spacing: 0.06em;
          cursor: pointer;
        }
        .scrolling-position {
          position: fixed;
          z-index: 16;
          right: max(14px, env(safe-area-inset-right, 0px));
          top: 50%;
          transform: translateY(-42%);
          display: grid;
          justify-items: center;
          gap: 8px;
          color: rgba(244, 238, 222, 0.82);
          mix-blend-mode: difference;
        }
        .scrolling-position span {
          font: 9px/1 var(--font-mono);
          letter-spacing: 0.06em;
        }
        .scrolling-position i {
          display: block;
          width: 1px;
          height: clamp(40px, 9vh, 90px);
          background: currentColor;
          opacity: 0.45;
        }
        .scrolling-position button {
          width: 34px;
          height: 34px;
          border: 0;
          color: inherit;
          background: transparent;
          font: 15px/1 var(--font-mono);
          cursor: pointer;
        }
        .scrolling-position button:disabled { opacity: 0.25; cursor: default; }
        .scrolling-room.is-entered + .scrolling-room { scroll-snap-align: none; }

        @supports (height: 100dvh) {
          .scrolling-gallery { height: calc(100dvh - 56px - env(safe-area-inset-top, 0px)); }
        }
        @media (max-width: 700px) {
          .scrolling-intro { display: none; }
          .scrolling-room__name { font-size: clamp(58px, 23vw, 110px); }
          .scrolling-room__desc { max-width: 70%; }
          .scrolling-room__enter { margin-top: 22px; align-self: flex-start; }
          .scrolling-position { right: 4px; }
          .scrolling-room__controls span { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .scrolling-gallery { scroll-behavior: auto; }
        }
      `}</style>
    </main>
  );
}
