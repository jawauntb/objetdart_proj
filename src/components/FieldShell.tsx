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
            alignItems: "center", justifyContent: "center", textAlign: "center", gap: "1.4rem", zIndex: 40,
            background: "radial-gradient(120% 90% at 50% 60%,rgba(7,21,33,0) 35%,rgba(7,21,33,.85) 100%)",
          }}
        >
          <p style={{ fontFamily: "var(--font-mono)", fontSize: ".7rem", letterSpacing: ".28em", textTransform: "uppercase", color: "#7B7F80" }}>
            a candle inside the command center
          </p>
          <h1
            style={{
              fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: "clamp(1.6rem,4.4vw,3rem)",
              letterSpacing: ".5px", maxWidth: "18ch", lineHeight: 1.18, color: "#EFE5D0",
              textShadow: "0 0 40px rgba(214,168,74,.25)", margin: 0,
            }}
          >
            A candle inside the command center, facing the sea.
          </h1>
          <button
            onClick={enter}
            style={{
              fontFamily: "var(--font-mono)", letterSpacing: ".22em", textTransform: "uppercase",
              fontSize: ".78rem", color: "#071521", background: "#D6A84A", border: "none",
              padding: ".85rem 1.8rem", borderRadius: 2, cursor: "pointer",
              boxShadow: "0 0 50px rgba(214,168,74,.4)",
            }}
          >
            Enter field
          </button>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: ".7rem", letterSpacing: ".28em", textTransform: "uppercase", color: "#7B7F80", opacity: 0.6 }}>
            handle the objects · calibrate concern · route the atlas
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
