"use client";

import { useField } from "@/store/field";
import { CONCERNS, PRESET_KEYS } from "@/data/content";

export default function ConcernConsole() {
  const concerns = useField((s) => s.concerns);
  const setConcern = useField((s) => s.setConcern);
  const applyPreset = useField((s) => s.applyPreset);

  return (
    <div>
      <h2
        style={{
          fontFamily: "var(--font-mono)", fontSize: ".62rem", letterSpacing: ".26em",
          textTransform: "uppercase", color: "#D6A84A", margin: ".2rem 0 .2rem",
        }}
      >
        Concern field
      </h2>
      <p style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "#D8A08E", fontSize: ".95rem", margin: "0 0 1rem" }}>
        maintained relevance under time
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: ".7rem",
        }}
      >
        {CONCERNS.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: ".7rem" }}>
            <label
              htmlFor={`c-${c.id}`}
              style={{
                fontFamily: "var(--font-mono)", fontSize: ".6rem", letterSpacing: ".16em",
                textTransform: "uppercase", color: "#F7F1E6", width: "5.5em", flex: "none",
              }}
            >
              {c.label}
            </label>
            <input
              id={`c-${c.id}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={concerns[c.id]}
              onChange={(e) => setConcern(c.id, +e.target.value)}
              style={{ flex: 1 }}
              aria-valuetext={`${c.label} ${concerns[c.id]} of 100`}
            />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: ".6rem", color: "#7B7F80", width: "2em", textAlign: "right" }}>
              {Math.round(concerns[c.id])}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: ".35rem", marginTop: "1rem" }}>
        {PRESET_KEYS.map((name) => (
          <button
            key={name}
            onClick={() => applyPreset(name)}
            style={{
              background: "none", border: "1px solid rgba(185,136,60,.3)", color: "#7B7F80",
              fontFamily: "var(--font-mono)", fontSize: ".58rem", letterSpacing: ".16em",
              textTransform: "uppercase", padding: ".45rem .7rem", borderRadius: 2, cursor: "pointer",
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
