"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useField } from "@/store/field";
import { ARCHIVE, CONCERNS, OBJECTS, PHASES, REGIONS } from "@/data/content";
import { entrySlug } from "@/lib/slug";
import ConcernSigil from "@/components/ConcernSigil";
import WaterText from "@/components/WaterText";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import type { ConcernKey, PhaseKey, ArchiveEntry } from "@/lib/types";
import type { ImaginedEntry } from "@/store/field";

// Synthesize a concern weights map for an archive entry from its tags.
// Tagged concerns get a high weight, untagged get a low baseline.
function entryWeights(a: ArchiveEntry): Record<ConcernKey, number> {
  return entryWeightsFromConcerns(a.concerns);
}
function entryWeightsFromConcerns(concerns: ConcernKey[]): Record<ConcernKey, number> {
  const map = Object.fromEntries(CONCERNS.map((c) => [c.id, 26])) as Record<ConcernKey, number>;
  concerns.forEach((c) => { map[c] = 82; });
  return map;
}

const MEDIUMS = Array.from(new Set(ARCHIVE.map((a) => a.medium)));

const STATUS_COLOR: Record<string, string> = {
  kept: "var(--kept)",
  open: "var(--open)",
  closed: "var(--closed)",
};

type ArchiveFilterKind = "medium" | "concern" | "object" | "phase";
type ArchiveMarkTone = "paper" | "candle" | "ink" | "kept";
type ArchiveMark = {
  id: number;
  label: string;
  tone: ArchiveMarkTone;
  strength: number;
};

const MARK_COLOR: Record<ArchiveMarkTone, string> = {
  paper: "var(--ink-2)",
  candle: "var(--candle)",
  ink: "var(--ink)",
  kept: "var(--kept)",
};

export default function Archive() {
  const archMedium = useField((s) => s.archMedium);
  const archConcern = useField((s) => s.archConcern);
  const archObject = useField((s) => s.archObject);
  const archPhase = useField((s) => s.archPhase);
  const archQuery = useField((s) => s.archQuery);
  const archSort = useField((s) => s.archSort);
  const toggle = useField((s) => s.toggleArchFilter);
  const setQuery = useField((s) => s.setArchQuery);
  const setSort = useField((s) => s.setArchSort);
  const imaginedEntries = useField((s) => s.imaginedEntries);
  const addImaginedEntry = useField((s) => s.addImaginedEntry);
  const forgetImaginedEntry = useField((s) => s.forgetImaginedEntry);
  const recordTape = useField((s) => s.recordTape);

  // imagine-a-drawer form state
  const [imagineTitle, setImagineTitle] = useState("");
  const [imagineConcerns, setImagineConcerns] = useState<ConcernKey[]>([]);
  const [imagining, setImagining] = useState(false);
  const [imagineError, setImagineError] = useState<string | null>(null);
  const [openImagined, setOpenImagined] = useState<string | null>(null);
  const [archiveMarks, setArchiveMarks] = useState<ArchiveMark[]>([]);
  const markId = useRef(0);

  const addArchiveMark = (
    label: string,
    tone: ArchiveMarkTone = "paper",
    strength = 0.42,
  ) => {
    const id = ++markId.current;
    const trimmed = label.trim().slice(0, 26) || "drawer";
    const mark = { id, label: trimmed, tone, strength };
    setArchiveMarks((prev) => [mark, ...prev.filter((m) => m.label !== trimmed)].slice(0, 7));
    window.setTimeout(() => {
      setArchiveMarks((prev) => prev.filter((m) => m.id !== id));
    }, 2600);
  };

  const touchArchive = (
    label: string,
    tone: ArchiveMarkTone = "paper",
    intensity = 0.4,
    kind: "object" | "imagine" | "reading" | "kept" = "object",
  ) => {
    addArchiveMark(label, tone, intensity);
    recordTape(kind, intensity, `archive/${label.toLowerCase().replace(/\s+/g, "-")}`);
  };

  const handleFilterToggle = (kind: ArchiveFilterKind, value: string) => {
    haptics.tap();
    toggle(kind, value);
    touchArchive(`${kind}:${value}`, "paper", 0.32);
  };

  const toggleImagineConcern = (c: ConcernKey) => {
    haptics.tap();
    touchArchive(c, "candle", 0.3);
    setImagineConcerns((cs) => cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c].slice(0, 3));
  };

  const imagine = async () => {
    if (!imagineTitle.trim() || imagining) return;
    haptics.roll();
    touchArchive("writing drawer", "candle", 0.58, "imagine");
    setImagining(true);
    setImagineError(null);
    try {
      const res = await fetch("/api/imagine-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: imagineTitle.trim(),
          concerns: imagineConcerns,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setImagineError(j?.hint ?? j?.error ?? "the room could not write this one.");
      } else {
        const j = await res.json();
        const id = "im-" + Math.random().toString(36).slice(2, 10);
        const region = REGIONS.find((r) =>
          r.concerns.some((c) => imagineConcerns.includes(c)),
        )?.id ?? "archive";
        const entry: ImaginedEntry = {
          id,
          title: imagineTitle.trim(),
          fn: String(j?.entry?.fn ?? "—"),
          note: String(j?.entry?.note ?? ""),
          body: Array.isArray(j?.entry?.body) ? j.entry.body.map(String) : [],
          concerns: imagineConcerns,
          medium: "writing",
          region,
          imaginedAt: Date.now(),
        };
        addImaginedEntry(entry);
        setImagineTitle("");
        setImagineConcerns([]);
        setOpenImagined(id);
        getFieldAudio().bell();
        haptics.roll();
        touchArchive("drawer kept", "kept", 0.86, "imagine");
      }
    } catch {
      setImagineError("the field is unreachable right now.");
      haptics.chop();
      touchArchive("field closed", "ink", 0.36);
    } finally {
      setImagining(false);
    }
  };

  const items = useMemo(() => {
    let list = ARCHIVE.filter((a) => {
      if (archMedium.size && !archMedium.has(a.medium)) return false;
      if (archConcern.size && !a.concerns.some((c) => archConcern.has(c))) return false;
      if (archObject.size && !(a.objects ?? []).some((o) => archObject.has(o))) return false;
      if (archPhase.size && !archPhase.has(a.phase)) return false;
      if (archQuery.trim()) {
        const hay = `${a.title} ${a.medium} ${a.fn} ${a.phase} ${a.concerns.join(" ")} ${a.year ?? ""} ${a.status ?? ""} ${(a.objects ?? []).join(" ")} ${a.note ?? ""}`.toLowerCase();
        if (!archQuery.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    list = list.slice();
    if (archSort === "recent") list.sort((a, b) => (b.year ?? "").localeCompare(a.year ?? ""));
    if (archSort === "oldest") list.sort((a, b) => (a.year ?? "").localeCompare(b.year ?? ""));
    if (archSort === "phase") list.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
    if (archSort === "medium") list.sort((a, b) => a.medium.localeCompare(b.medium));
    return list;
  }, [archMedium, archConcern, archObject, archPhase, archQuery, archSort]);

  const activeFilterCount = archMedium.size + archConcern.size + archObject.size + archPhase.size;
  const queryTrimmed = archQuery.trim();

  return (
    <section id="archive" className="rule" style={{ scrollMarginTop: 72 }}>
      <div className="wrap">
        <div className="t-eyebrow">archive · open the drawers</div>
        <WaterText
          as="h2"
          bobAmp={0}
          className="t-h2 italic"
          style={{ display: "block", marginTop: 12, marginBottom: 24 }}
        >
          every keepable thing
        </WaterText>

        <div className="archive-state-strip" aria-live="polite">
          <div className="archive-state-stats">
            <span><b>{items.length}</b> drawers</span>
            <span>{activeFilterCount ? `${activeFilterCount} filters` : "wide open"}</span>
            <span>{queryTrimmed ? `search ${queryTrimmed.slice(0, 18)}` : `sort ${archSort}`}</span>
            {imaginedEntries.length > 0 && <span>{imaginedEntries.length} imagined</span>}
          </div>
          <div className="archive-mark-strip" aria-hidden="true">
            {archiveMarks.length === 0 ? (
              <span className="archive-mark ghost" />
            ) : archiveMarks.map((mark) => (
              <span
                key={mark.id}
                className="archive-mark"
                style={{
                  ["--mark-color" as string]: MARK_COLOR[mark.tone],
                  ["--mark-height" as string]: `${18 + mark.strength * 34}px`,
                }}
              >
                <span>{mark.label}</span>
              </span>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "240px 1fr",
            columnGap: 48,
          }}
          className="archive-grid"
        >
          {/* filter rail */}
          <aside
            style={{
              position: "sticky",
              top: 72,
              alignSelf: "start",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <input
              type="search"
              value={archQuery}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                haptics.tap();
                addArchiveMark("search", "ink", 0.28);
              }}
              onBlur={() => {
                const q = archQuery.trim();
                if (!q) return;
                touchArchive(`search:${q.slice(0, 14)}`, "ink", 0.3);
              }}
              placeholder="search the drawers"
              aria-label="search"
              className="t-mono"
              style={{
                background: "transparent",
                border: 0,
                borderBottom: "1px solid var(--rule)",
                padding: "8px 0",
                color: "var(--ink)",
                fontSize: 13,
                outline: "none",
                width: "100%",
              }}
            />

            <FilterGroup
              label="medium"
              options={MEDIUMS}
              active={archMedium}
              onToggle={(v) => handleFilterToggle("medium", v)}
            />
            <FilterGroup
              label="concern"
              options={CONCERNS.map((c) => c.id)}
              active={archConcern as Set<string>}
              onToggle={(v) => handleFilterToggle("concern", v)}
            />
            <FilterGroup
              label="object"
              options={OBJECTS.map((o) => o.id)}
              active={archObject}
              onToggle={(v) => handleFilterToggle("object", v)}
            />
            <FilterGroup
              label="phase"
              options={PHASES}
              active={archPhase as unknown as Set<string>}
              onToggle={(v) => handleFilterToggle("phase", v)}
            />

            <div>
              <div className="t-eyebrow" style={{ marginBottom: 8 }}>sort</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(["recent", "oldest", "phase", "medium"] as const).map((s) => (
                  <button
                    key={s}
                    className={`chip${archSort === s ? " is-active" : ""}`}
                    aria-pressed={archSort === s}
                    onClick={() => {
                      haptics.chop();
                      setSort(s);
                      touchArchive(`sort:${s}`, "paper", 0.36);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* card grid */}
          <div>
            {/* imagine-a-drawer */}
            <div
              style={{
                marginBottom: 28,
                padding: 18,
                border: "1px dashed var(--rule)",
                background: "transparent",
              }}
            >
              <div className="t-eyebrow">imagine a drawer</div>
              <p className="t-meta italic" style={{ color: "var(--ink-2)", margin: "8px 0 14px", maxWidth: "60ch" }}>
                give the room a title and one to three concerns. the field will write the drawer into your archive.
              </p>
              <form
                onSubmit={(e) => { e.preventDefault(); imagine(); }}
                style={{ display: "grid", gap: 12 }}
              >
                <input
                  type="text"
                  value={imagineTitle}
                  onChange={(e) => setImagineTitle(e.target.value)}
                  placeholder="title — e.g. Lighthouse Tapes, Three Sleepless Years…"
                  maxLength={80}
                  disabled={imagining}
                  className="t-mono"
                  style={{
                    background: "transparent",
                    border: 0,
                    borderBottom: "1px solid var(--rule)",
                    padding: "8px 0",
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: 19,
                    color: "var(--ink)",
                    outline: "none",
                    width: "100%",
                  }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {CONCERNS.map((c) => {
                    const on = imagineConcerns.includes(c.id);
                    return (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => toggleImagineConcern(c.id)}
                        aria-pressed={on}
                        className={`chip${on ? " is-active" : ""}`}
                        disabled={imagining}
                      >
                        {c.id}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    disabled={imagining || !imagineTitle.trim()}
                    className="t-mono"
                    style={{
                      background: imagineTitle.trim() && !imagining ? "var(--ink)" : "var(--paper-2)",
                      color: imagineTitle.trim() && !imagining ? "var(--paper)" : "var(--ink-2)",
                      border: "1px solid var(--ink)",
                      padding: "10px 16px",
                      fontSize: 12,
                      letterSpacing: "0.08em",
                      textTransform: "lowercase",
                      cursor: imagining ? "default" : (imagineTitle.trim() ? "pointer" : "default"),
                    }}
                  >
                    {imagining ? "the field is writing…" : "imagine ◦"}
                  </button>
                  {imagineError && (
                    <span className="t-meta italic" style={{ color: "var(--ink-2)" }}>{imagineError}</span>
                  )}
                </div>
              </form>
            </div>

            {/* imagined entries — render in their own row above the canonical archive */}
            {imaginedEntries.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div className="t-eyebrow" style={{ marginBottom: 12 }}>imagined drawers · kept locally</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
                    gap: 18,
                  }}
                >
                  {imaginedEntries.map((e) => {
                    const expanded = openImagined === e.id;
                    return (
                      <article
                        key={e.id}
                        style={{
                          border: "1px solid var(--rule)",
                          background: "var(--paper-2)",
                          padding: 22,
                          transition: "border-color var(--t)",
                          gridColumn: expanded ? "1 / -1" : undefined,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span className="t-eyebrow" style={{ color: "var(--candle)" }}>
                            imagined · {new Date(e.imaginedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                          <button
                            onClick={() => {
                              haptics.chop();
                              forgetImaginedEntry(e.id);
                              touchArchive("forget imagined", "ink", 0.35);
                            }}
                            className="t-mono"
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, color: "var(--ink-2)" }}
                          >
                            forget
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            haptics.ripple(expanded ? 0.28 : 0.5);
                            setOpenImagined(expanded ? null : e.id);
                            touchArchive(expanded ? "fold imagined" : "open imagined", "candle", expanded ? 0.34 : 0.56, "reading");
                          }}
                          style={{
                            background: "none",
                            border: 0,
                            padding: 0,
                            cursor: "pointer",
                            textAlign: "left",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            marginTop: 10,
                            width: "100%",
                            color: "var(--ink)",
                          }}
                        >
                          <div style={{ flexShrink: 0, marginTop: 4 }}>
                            <ConcernSigil
                              concerns={entryWeightsFromConcerns(e.concerns)}
                              size={44}
                              showAxes
                              showDots={false}
                              fill="rgba(44,74,92,0.12)"
                            />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <WaterText
                              as="div"
                              bobAmp={0}
                              className="t-h3"
                              style={{ display: "block", margin: "0 0 6px" }}
                            >
                              {e.title}
                            </WaterText>
                            <p className="t-meta" style={{ color: "var(--ink-2)", margin: 0 }}>{e.fn}</p>
                          </div>
                        </button>

                        {expanded && (
                          <div style={{ marginTop: 16, animation: "ask-fade-in 600ms ease both" }}>
                            {e.note && (
                              <div
                                style={{
                                  borderLeft: "2px solid var(--candle)",
                                  paddingLeft: 14,
                                  margin: "0 0 16px",
                                  fontSize: 19,
                                  lineHeight: 1.4,
                                  fontStyle: "italic",
                                  color: "var(--ink)",
                                  fontFamily: "var(--font-serif)",
                                }}
                              >
                                {e.note}
                              </div>
                            )}
                            {e.body.map((p, i) => (
                              <p
                                key={i}
                                className="t-body"
                                style={{ marginTop: i === 0 ? 0 : 14, marginBottom: 0, maxWidth: "62ch" }}
                              >
                                {p}
                              </p>
                            ))}
                            <div className="t-eyebrow" style={{ marginTop: 18, color: "var(--ink-2)" }}>
                              {e.concerns.join(" / ")}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <style
                  dangerouslySetInnerHTML={{
                    __html: `
                  @keyframes ask-fade-in {
                    from { opacity: 0; transform: translateY(4px); }
                    to   { opacity: 1; transform: none; }
                  }
                `,
                  }}
                />
              </div>
            )}
            {items.length === 0 ? (
              <p className="t-h3 italic" style={{ color: "var(--ink-2)", maxWidth: "44ch" }}>
                no drawer answers that combination — yet.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
                  gap: 18,
                }}
              >
                {items.map((a) => (
                  <Link
                    key={a.id}
                    href={`/archive/${entrySlug(a)}`}
                    style={{
                      display: "block",
                      border: "1px solid var(--rule)",
                      background: "var(--paper-2)",
                      padding: 22,
                      transition: "transform var(--t), border-color var(--t)",
                      color: "var(--ink)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--ink)";
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--rule)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                    onPointerDown={() => {
                      haptics.tap();
                      touchArchive(a.title, a.status === "kept" ? "kept" : "ink", 0.48, "reading");
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <span className="t-eyebrow">{a.year ?? ""}</span>
                      {a.status && (
                        <span
                          className="t-mono"
                          style={{
                            fontSize: 11,
                            letterSpacing: "0.08em",
                            textTransform: "lowercase",
                            color: STATUS_COLOR[a.status] ?? "var(--ink-2)",
                            border: `1px solid ${STATUS_COLOR[a.status] ?? "var(--ink-2)"}`,
                            padding: "2px 6px",
                          }}
                        >
                          {a.status}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginTop: 10 }}>
                      <div style={{ flexShrink: 0, marginTop: 4 }}>
                        <ConcernSigil
                          concerns={entryWeights(a)}
                          size={44}
                          showAxes
                          showDots={false}
                          fill="rgba(44,74,92,0.12)"
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <WaterText
                          as="div"
                          bobAmp={0}
                          className="t-h3"
                          style={{
                            display: "-webkit-box",
                            margin: "0 0 6px",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {a.title}
                        </WaterText>
                        <p className="t-meta" style={{ color: "var(--ink-2)", margin: 0 }}>{a.fn}</p>
                      </div>
                    </div>
                    <div className="t-eyebrow" style={{ marginTop: 14, color: "var(--ink-2)" }}>
                      {a.medium} · {a.phase} · {a.concerns.join(" / ")}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        #archive .wrap {
          padding-bottom: calc(96px + env(safe-area-inset-bottom));
        }
        .archive-state-strip {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: center;
          margin: -4px 0 28px;
          padding: 12px 0;
          border-top: 1px solid color-mix(in srgb, var(--rule), transparent 28%);
          border-bottom: 1px solid color-mix(in srgb, var(--rule), transparent 28%);
        }
        .archive-state-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 9px 14px;
          color: var(--ink-2);
          font-family: var(--font-mono);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .archive-state-stats b {
          color: var(--ink);
          font-weight: 400;
        }
        .archive-mark-strip {
          min-width: min(320px, 42vw);
          min-height: 46px;
          display: flex;
          align-items: flex-end;
          justify-content: flex-end;
          gap: 7px;
          overflow: hidden;
        }
        .archive-mark {
          position: relative;
          width: 2px;
          height: var(--mark-height, 28px);
          background: var(--mark-color, var(--ink-2));
          opacity: 0.86;
          box-shadow: 0 0 18px color-mix(in srgb, var(--mark-color, var(--ink-2)), transparent 45%);
          animation: archive-mark-rise 2.6s ease both;
        }
        .archive-mark span {
          position: absolute;
          right: 7px;
          bottom: 0;
          max-width: 108px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--mark-color, var(--ink-2));
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .archive-mark.ghost {
          width: 42px;
          height: 1px;
          background: var(--rule);
          opacity: 0.7;
          box-shadow: none;
          animation: none;
        }
        @keyframes archive-mark-rise {
          0% { opacity: 0; transform: translateY(8px) scaleY(0.25); }
          18% { opacity: 0.9; transform: translateY(0) scaleY(1); }
          100% { opacity: 0; transform: translateX(-28px) scaleY(0.76); }
        }
        @media (max-width: 880px) {
          .archive-grid { grid-template-columns: 1fr !important; row-gap: 24px; }
          .archive-grid > aside { position: static !important; top: auto !important; }
        }
        @media (max-width: 640px) {
          #archive .wrap {
            padding-bottom: calc(128px + env(safe-area-inset-bottom));
          }
          .archive-state-strip {
            align-items: flex-start;
            flex-direction: column;
            margin-bottom: 22px;
          }
          .archive-mark-strip {
            justify-content: flex-start;
            min-width: 100%;
            width: 100%;
          }
          .archive-mark span {
            right: auto;
            left: 7px;
            max-width: 88px;
          }
        }
      `,
        }}
      />
    </section>
  );
}

function FilterGroup({
  label,
  options,
  active,
  onToggle,
}: {
  label: string;
  options: string[];
  active: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div className="t-eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((opt) => {
          const on = active.has(opt);
          return (
            <button
              key={opt}
              className={`chip${on ? " is-active" : ""}`}
              aria-pressed={on}
              onClick={() => onToggle(opt)}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
