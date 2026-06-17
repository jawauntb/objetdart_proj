"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useField } from "@/store/field";
import Sigil from "@/components/Sigil";
import Sea from "@/components/Sea";
import PerWordHero from "@/components/PerWordHero";
import KeptConstellation from "@/components/KeptConstellation";

function useLiveClock() {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const update = () => {
      try {
        const d = new Date();
        const day = d
          .toLocaleDateString("en-US", { weekday: "short" })
          .toLowerCase();
        const time = d.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const tz = (
          Intl.DateTimeFormat().resolvedOptions().timeZone || ""
        )
          .split("/")
          .pop()
          ?.replace(/_/g, " ")
          .toLowerCase() ?? "";
        setClock(`${day} · ${time}${tz ? " · " + tz : ""}`);
      } catch {
        /* noop */
      }
    };
    update();
    const i = setInterval(update, 30_000);
    return () => clearInterval(i);
  }, []);
  return clock;
}

export default function Threshold() {
  const clock = useLiveClock();
  const keptCount = useField((s) => s.keptReadings.length);

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const playChart = () => {
    try {
      window.dispatchEvent(
        new CustomEvent("oda:sea-nudge", {
          detail: { direction: 1, source: "threshold" },
        }),
      );
    } catch {
      /* noop */
    }
    goTo("live-chart");
  };

  return (
    <section
      id="threshold"
      style={{
        minHeight: "calc(100vh - 56px)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        paddingTop: "clamp(2rem, 4vw, 3rem)",
      }}
    >
      <div
        className="wrap threshold-topline"
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div className="t-eyebrow">an instrument</div>
        <div className="t-eyebrow" suppressHydrationWarning style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
          {keptCount > 0 && (
            <Link
              href="/kept"
              style={{
                color: "var(--ink)",
                borderBottom: "1px solid var(--candle)",
                display: "inline-block",
                padding: "10px 4px",
                margin: "-10px -4px",
                minHeight: 44,
              }}
            >
              {keptCount} kept
            </Link>
          )}
          <span>{clock || " "}</span>
        </div>
      </div>

      <div
        className="wrap"
        style={{
          width: "100%",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <PerWordHero
          text="Choose a current. Tune the room. Leave by sea."
          className="t-h1"
          style={{ margin: 0, maxWidth: "17ch", pointerEvents: "none" }}
        />

        <div
          className="t-meta"
          style={{
            marginTop: 32,
            color: "var(--ink-2)",
            maxWidth: "58ch",
          }}
        >
          a playable coast for objects, concerns, charts, waves, and whatever
          is already asking to be carried.
        </div>

        <div
          className="threshold-actions"
          style={{
            marginTop: 34,
            display: "grid",
            gap: 10,
            maxWidth: 760,
          }}
          aria-label="departure points"
        >
          <button className="threshold-action" onClick={() => goTo("concern-field")}>
            <span>tune field</span>
            <span aria-hidden="true">↓</span>
          </button>
          <button className="threshold-action" onClick={() => goTo("atlas")}>
            <span>cross atlas</span>
            <span aria-hidden="true">→</span>
          </button>
          <button className="threshold-action" onClick={playChart}>
            <span>play chart</span>
            <span aria-hidden="true">⌁</span>
          </button>
          <Link className="threshold-action" href="/waves">
            <span>open waves</span>
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>

      <div
        id="threshold-sea"
        className="threshold-sea"
        style={{ marginTop: 36, marginInline: "calc(-1 * var(--pad-x))", position: "relative" }}
      >
        <Sea />
        <KeptConstellation />
        <div
          className="threshold-sea__cue t-eyebrow"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "var(--pad-x)",
            bottom: 24,
            maxWidth: "28ch",
            color: "rgba(244, 238, 230, 0.82)",
            pointerEvents: "none",
            textShadow: "0 1px 8px rgba(0,0,0,0.28)",
          }}
        >
          the water is already moving
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 24,
          right: "var(--pad-x)",
          color: "var(--ink-2)",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        <Sigil size={20} flicker />
      </div>

      <style>{`
        .threshold-action {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          background: rgba(242, 238, 230, 0.34);
          border: 1px solid var(--rule);
          color: var(--ink);
          padding: 11px 13px;
          cursor: pointer;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: lowercase;
          text-align: left;
          transition: border-color var(--t), color var(--t), background var(--t);
        }
        .threshold-action:hover,
        .threshold-action:focus-visible {
          border-color: var(--candle);
          color: var(--candle);
          background: rgba(200, 115, 42, 0.07);
        }
        @media (min-width: 721px) {
          .threshold-actions {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        @media (max-width: 720px) {
          #threshold {
            min-height: auto !important;
            padding-top: 1.25rem !important;
          }
          .threshold-topline {
            align-items: flex-start !important;
            gap: 10px;
            flex-wrap: wrap;
          }
          .threshold-actions {
            grid-template-columns: 1fr !important;
            width: 100%;
            max-width: none !important;
          }
          .threshold-action {
            width: 100%;
          }
          .threshold-sea {
            margin-top: 28px !important;
          }
          .threshold-sea__cue {
            left: var(--pad-x) !important;
            right: var(--pad-x) !important;
            bottom: 14px !important;
            max-width: none !important;
          }
        }
      `}</style>
    </section>
  );
}
