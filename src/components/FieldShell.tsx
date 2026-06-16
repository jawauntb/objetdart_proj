"use client";

import { useEffect, useState } from "react";
import { useField } from "@/store/field";
import { PRESET_KEYS } from "@/data/content";
import type { SymbolObject, FieldTrace } from "@/lib/types";

import RoomScene from "@/components/RoomScene";
import ObjectTable from "@/components/ObjectTable";
import ConcernConsole from "@/components/ConcernConsole";
import ConcernAtlas from "@/components/ConcernAtlas";
import ArchiveDrawer from "@/components/ArchiveDrawer";
import { TopBar, ModeNav, TideScrub, Panel, Scrim, Flash } from "@/components/Chrome";
import { SymbolCard, CommandChapel, FieldReading } from "@/components/Dialogs";

export default function FieldShell() {
  const entered = useField((s) => s.entered);
  const enter = useField((s) => s.enter);
  const mode = useField((s) => s.mode);
  const setMode = useField((s) => s.setMode);
  const applyPreset = useField((s) => s.applyPreset);
  const cycleLens = useField((s) => s.cycleLens);
  const loadTraces = useField((s) => s.loadTraces);
  const generateReading = useField((s) => s.generateReading);

  const [card, setCard] = useState<{ object: SymbolObject; rect: DOMRect } | null>(null);
  const [reading, setReading] = useState<FieldTrace | null>(null);

  useEffect(() => { loadTraces(); }, [loadTraces]);

  useEffect(() => {
    const openReading = async () => {
      const t = useField.getState().traces.slice(-1)[0];
      if (t) setReading(t);
    };
    window.addEventListener("open-reading", openReading);
    return () => window.removeEventListener("open-reading", openReading);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      if (e.key === "Escape") { setCard(null); setReading(null); setMode("table"); return; }
      if (!entered) { if (e.key === "Enter") enter(); return; }
      if (e.key.toLowerCase() === "c") setMode("command");
      if (e.key.toLowerCase() === "a") setMode("atlas");
      if (e.key.toLowerCase() === "r") { generateReading().then((t) => setReading(t)); }
      if (/^[1-8]$/.test(e.key)) applyPreset(PRESET_KEYS[+e.key - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, enter, setMode, applyPreset, generateReading]);

  const panelOpen = mode === "console" || mode === "atlas" || mode === "archive";
  const overlayOpen = panelOpen || mode === "command" || !!reading;

  const closeOverlays = () => {
    setReading(null);
    if (panelOpen || mode === "command") setMode("table");
  };

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <RoomScene />
      <TopBar />

      <ObjectTable
        onInspect={(o, el) => setCard({ object: o, rect: el.getBoundingClientRect() })}
      />

      <TideScrub />

      {/* threshold */}
      {!entered && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", textAlign: "center",
            gap: "2rem", zIndex: 40,
            background: "radial-gradient(140% 90% at 50% 55%, rgba(7,21,33,0) 30%, rgba(5,13,21,.92) 100%)",
          }}
        >
          <p style={{
            fontFamily: "var(--font-mono)", fontSize: ".58rem", letterSpacing: ".42em",
            textTransform: "uppercase", color: "rgba(155,160,165,.6)", margin: 0,
          }}>
            an instrument
          </p>
          <h1
            style={{
              fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400,
              fontSize: "clamp(2.2rem, 6.4vw, 4.6rem)",
              letterSpacing: "-.005em", maxWidth: "16ch", lineHeight: 1.02,
              color: "#F0E3CD", margin: 0,
              textShadow: "0 0 60px rgba(226,185,104,.18)",
            }}
          >
            A candle inside the command center, facing the sea.
          </h1>
          <button
            onClick={enter}
            style={{
              fontFamily: "var(--font-mono)", letterSpacing: ".28em", textTransform: "uppercase",
              fontSize: ".62rem", color: "#E2B968", background: "none",
              border: "none", padding: ".4rem 0", cursor: "pointer",
              borderBottom: "1px solid rgba(226,185,104,.7)",
            }}
          >
            enter
          </button>
          <p style={{
            fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400,
            fontSize: ".95rem", color: "rgba(216,160,142,.55)", margin: 0,
            maxWidth: "28ch", lineHeight: 1.4,
          }}>
            handle the objects, calibrate concern, route the atlas, leave a reading.
          </p>
        </div>
      )}

      <SymbolCard
        object={card?.object ?? null}
        anchor={card?.rect ?? null}
        onClose={() => setCard(null)}
      />

      <Scrim show={overlayOpen} onClose={closeOverlays} />

      <Panel open={mode === "console"} label="Concern console"><ConcernConsole /></Panel>
      <Panel open={mode === "atlas"} label="Atlas"><ConcernAtlas /></Panel>
      <Panel open={mode === "archive"} label="Archive"><ArchiveDrawer /></Panel>

      <CommandChapel open={mode === "command"} onClose={() => setMode("table")} />
      <FieldReading trace={reading} onClose={() => setReading(null)} />

      <Flash />
      <ModeNav />
    </div>
  );
}
