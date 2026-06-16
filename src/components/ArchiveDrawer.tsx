"use client";

import { useMemo, useState } from "react";
import { useField } from "@/store/field";
import { ARCHIVE, REGIONS, CONCERNS, OBJECTS, PHASES } from "@/data/content";
import type { ConcernKey, PhaseKey } from "@/lib/types";

const MEDIUMS = Array.from(new Set(ARCHIVE.map((a) => a.medium)));

const chipBase: React.CSSProperties = {
  background: "none",
  border: "1px solid rgba(185,136,60,.3)",
  color: "#7B7F80",
  fontFamily: "var(--font-mono)",
  fontSize: ".55rem",
  letterSpacing: ".14em",
  textTransform: "uppercase",
  padding: ".38rem .55rem",
  borderRadius: 2,
  cursor: "pointer",
};

function Chips<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: T[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div style={{ marginBottom: ".55rem" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: ".5rem", letterSpacing: ".24em", textTransform: "uppercase", color: "#7B7F80", margin: "0 0 .3rem" }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: ".3rem" }}>
        {options.map((opt) => {
          const on = value === opt;
          return (
            <button
              key={opt}
              aria-pressed={on}
              onClick={() => onChange(on ? null : opt)}
              style={{
                ...chipBase,
                background: on ? "#1F6F73" : "none",
                color: on ? "#071521" : "#7B7F80",
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ArchiveDrawer() {
  const query = useField((s) => s.archQuery);
  const filter = useField((s) => s.archFilter);
  const facets = useField((s) => s.archFacets);
  const setQuery = useField((s) => s.setArchQuery);
  const setFilter = useField((s) => s.setArchFilter);
  const setFacet = useField((s) => s.setArchFacet);
  const setFlash = useField((s) => s.setFlash);

  const [open, setOpen] = useState<string | null>(null);

  const list = useMemo(() => {
    return ARCHIVE.filter((a) => {
      if (filter && a.medium !== filter) return false;
      if (facets.concern && !a.concerns.includes(facets.concern as ConcernKey)) return false;
      if (facets.object && !(a.objects ?? []).includes(facets.object)) return false;
      if (facets.phase && a.phase !== (facets.phase as PhaseKey)) return false;
      if (query) {
        const hay = `${a.title} ${a.medium} ${a.fn} ${a.phase} ${a.concerns.join(" ")} ${a.year ?? ""} ${a.status ?? ""} ${(a.objects ?? []).join(" ")} ${a.note ?? ""}`.toLowerCase();
        return query.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
      }
      return true;
    });
  }, [query, filter, facets]);

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-mono)", fontSize: ".62rem", letterSpacing: ".26em", textTransform: "uppercase", color: "#D6A84A", margin: ".2rem 0 1rem" }}>
        Archive · open the drawers
      </h2>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search: work under risk, origin, systems…"
        aria-label="Search archive"
        style={{
          width: "100%", background: "rgba(16,24,32,.9)", border: "1px solid rgba(185,136,60,.3)",
          color: "#F7F1E6", fontFamily: "var(--font-mono)", fontSize: ".62rem", padding: ".5rem .6rem",
          borderRadius: 2, letterSpacing: ".08em", marginBottom: ".9rem",
        }}
      />

      <Chips
        label="Medium"
        options={MEDIUMS}
        value={filter}
        onChange={setFilter}
      />
      <Chips
        label="Concern"
        options={CONCERNS.map((c) => c.id)}
        value={facets.concern}
        onChange={(v) => setFacet("concern", v)}
      />
      <Chips
        label="Object"
        options={OBJECTS.map((o) => o.id)}
        value={facets.object}
        onChange={(v) => setFacet("object", v)}
      />
      <Chips
        label="Phase"
        options={PHASES}
        value={facets.phase as PhaseKey | null}
        onChange={(v) => setFacet("phase", v)}
      />

      <div style={{ display: "grid", gap: ".5rem", marginTop: ".4rem" }}>
        {list.length === 0 && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: ".62rem", color: "#7B7F80", letterSpacing: ".1em", textAlign: "center", padding: "1.5rem" }}>
            No drawer holds that. Try: origin · systems · love
          </div>
        )}
        {list.map((a) => {
          const isOpen = open === a.id;
          const reg = REGIONS.find((r) => r.id === a.region);
          return (
            <div
              key={a.id}
              style={{
                border: "1px solid rgba(185,136,60,.18)", borderRadius: 3,
                background: "rgba(16,24,32,.5)",
              }}
            >
              <button
                onClick={() => setOpen(isOpen ? null : a.id)}
                aria-expanded={isOpen}
                style={{
                  width: "100%", padding: ".75rem .9rem", cursor: "pointer",
                  background: "none", border: "none", textAlign: "left", color: "inherit",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: ".5rem" }}>
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: "1.15rem", color: "#EFE5D0" }}>{a.title}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: ".5rem", letterSpacing: ".18em", textTransform: "uppercase", color: "#7B7F80", flex: "none" }}>
                    {a.year ?? ""} {a.status ? `· ${a.status}` : ""}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: ".55rem", letterSpacing: ".14em", textTransform: "uppercase", color: "#7B7F80", margin: ".2rem 0" }}>
                  {a.medium} · {a.phase} · {a.concerns.join(" / ")}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: ".78rem", color: "#F7F1E6", opacity: 0.75 }}>{a.fn}</div>
              </button>
              {isOpen && (
                <div style={{ padding: "0 .9rem .85rem", borderTop: "1px solid rgba(185,136,60,.12)" }}>
                  {a.note && (
                    <p style={{ fontFamily: "var(--font-body)", fontSize: ".82rem", color: "#F7F1E6", opacity: 0.85, margin: ".7rem 0" }}>
                      {a.note}
                    </p>
                  )}
                  {a.objects && a.objects.length > 0 && (
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: ".55rem", letterSpacing: ".14em", textTransform: "uppercase", color: "#7B7F80", margin: ".4rem 0" }}>
                      objects · {a.objects.join(" / ")}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: ".4rem", marginTop: ".4rem", flexWrap: "wrap" }}>
                    <button
                      onClick={() => setFlash(`Routed "${a.title}" → ${reg ? reg.label : a.region}`)}
                      style={{ ...chipBase, color: "#D6A84A", borderColor: "rgba(214,168,74,.6)" }}
                    >
                      Route to {reg ? reg.label : a.region}
                    </button>
                    {a.link && (
                      <a
                        href={a.link}
                        target="_blank"
                        rel="noreferrer"
                        style={{ ...chipBase, color: "#D8A08E", borderColor: "rgba(216,160,142,.5)", textDecoration: "none" }}
                      >
                        Open ↗
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
