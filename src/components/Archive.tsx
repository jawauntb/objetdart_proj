"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useField } from "@/store/field";
import { ARCHIVE, CONCERNS, OBJECTS, PHASES, REGIONS } from "@/data/content";
import { entrySlug } from "@/lib/slug";
import ConcernSigil from "@/components/ConcernSigil";
import WaterText from "@/components/WaterText";
import { getFieldAudio } from "@/lib/audio";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
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

// twist(2) steps through the same order the sort chips offer — the
// drawers' own lens: same material, a different arrangement.
const SORT_ORDER = ["recent", "oldest", "phase", "medium"] as const;

export default function Archive() {
  const archMedium = useField((s) => s.archMedium);
  const archConcern = useField((s) => s.archConcern);
  const archObject = useField((s) => s.archObject);
  const archPhase = useField((s) => s.archPhase);
  const archQuery = useField((s) => s.archQuery);
  const archSort = useField((s) => s.archSort);
  const toggle = useField((s) => s.toggleArchFilter);
  const solo = useField((s) => s.soloArchFilter);
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

  // gesture layer — the buttons all stay; the grammar adds: a flick on
  // a card shivers its drawer open (navigates); a long-press on a
  // filter chip solos it (every other filter falls quiet); twist(2)
  // steps the sort, the grid's own lens; two-finger tap releases every
  // filter at once, three-finger tap is tutti (every drawer answers);
  // and the vessel — shake rattles the grid, a knock rings it, face
  // down is night. pan2 and the three-finger drag/twist/hold are left
  // unbound (see the note by the grid's engine mount). Engines mount on
  // the card grid and the filter rail only, so the page itself keeps
  // scrolling.
  const router = useRouter();
  const gridRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const consumedAtRef = useRef(-1e9);
  // the drawer the finger landed on — a flick releases away from where
  // it began, so the verb resolves against the landing card
  const downHrefRef = useRef<string | null>(null);
  const [shiverHref, setShiverHref] = useState<string | null>(null);
  // frame/law/vessel: twist(2) cycles the sort (the drawers' own lens —
  // same shape, different order), two/three-finger tap step back/tutti,
  // and the vessel rattles, rings and dims the whole grid
  const [rattle, setRattle] = useState(false);
  const [tutti, setTutti] = useState(0);
  const [night, setNight] = useState(false);
  const sortRef = useRef(archSort);
  sortRef.current = archSort;

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

  // stable bridges into the long-lived engine closures
  const touchArchiveRef = useRef(touchArchive);
  touchArchiveRef.current = touchArchive;
  const soloRef = useRef(solo);
  soloRef.current = solo;
  const hasItems = items.length > 0;

  // flick on a card: the drawer shivers open, then the room steps in.
  // The frame and law also live here: twist(2) steps the sort — the
  // grid's own lens, same drawers in a different order — and tap
  // completes the pair (two fingers back off the filters, three are
  // tutti). pan2 and the three-finger drag/twist/hold are left unbound:
  // the grid already scrolls under two fingers via the page's own
  // touch-action, and drawers have no weather or season to hold.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let navTimer: ReturnType<typeof setTimeout> | null = null;
    let tuttiTimer: ReturnType<typeof setTimeout> | null = null;
    const twistAcc = { current: 0 };
    const detach = attachGestures(grid, {
      flick: (e) => {
        if (e.fingers !== 1) return;
        const hit = (document.elementFromPoint(e.x, e.y) as HTMLElement | null)
          ?.closest?.("a.arch-card") as HTMLAnchorElement | null;
        const href = downHrefRef.current ?? hit?.getAttribute("href") ?? null;
        if (!href) return;
        consumedAtRef.current = performance.now();
        setShiverHref(href);
        try { haptics.chop(); } catch { /* noop */ }
        try { getFieldAudio().chime(); } catch { /* noop */ }
        touchArchiveRef.current("drawer opens", "candle", 0.6, "reading");
        if (navTimer) clearTimeout(navTimer);
        navTimer = setTimeout(() => router.push(href), 260);
      },
      twist: (e) => {
        if (e.fingers === 3 || e.phase !== "move") return;
        twistAcc.current += e.angle;
        const step = Math.PI / 2;
        while (Math.abs(twistAcc.current) >= step) {
          const direction = twistAcc.current > 0 ? 1 : -1;
          twistAcc.current -= direction * step;
          const idx = SORT_ORDER.indexOf(sortRef.current);
          const next = SORT_ORDER[(idx + direction + SORT_ORDER.length) % SORT_ORDER.length];
          setSort(next);
          touchArchiveRef.current(`sort:${next}`, "paper", 0.36);
          try { haptics.tap(); } catch { /* noop */ }
        }
      },
      tap: (e) => {
        if (e.fingers === 2) {
          // step back: the filters retreat all at once
          if (activeFilterCount === 0) return;
          useField.setState({
            archMedium: new Set(),
            archConcern: new Set(),
            archObject: new Set(),
            archPhase: new Set(),
          });
          touchArchiveRef.current("filters cleared", "ink", 0.4);
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        if (e.fingers === 3) {
          setTutti(Date.now());
          if (tuttiTimer) clearTimeout(tuttiTimer);
          tuttiTimer = setTimeout(() => setTutti(0), 640);
          try { haptics.ripple(0.4); } catch { /* noop */ }
          try { getFieldAudio().chime(); } catch { /* noop */ }
          touchArchiveRef.current("drawers answer", "candle", 0.4);
        }
      },
    }, { wheelZoom: false, manageStyle: false, noCapture: true });
    return () => {
      detach();
      if (navTimer) clearTimeout(navTimer);
      if (tuttiTimer) clearTimeout(tuttiTimer);
    };
  }, [hasItems, router, activeFilterCount, setSort]);

  // vessel: shake rattles every drawer at once, a knock rings the
  // archive like tutti, and face-down is night — the grid dims until
  // the phone turns back over. Tilt has no honest gravity on a flat
  // reading grid, so it is left unbound.
  useEffect(() => {
    let rattleTimer: ReturnType<typeof setTimeout> | null = null;
    let tuttiTimer: ReturnType<typeof setTimeout> | null = null;
    const detachVessel = onVessel({
      shake: () => {
        setRattle(true);
        try { haptics.chop(); } catch { /* noop */ }
        try { getFieldAudio().chime(); } catch { /* noop */ }
        if (rattleTimer) clearTimeout(rattleTimer);
        rattleTimer = setTimeout(() => setRattle(false), 420);
      },
      knock: () => {
        setTutti(Date.now());
        try { getFieldAudio().bell(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        if (tuttiTimer) clearTimeout(tuttiTimer);
        tuttiTimer = setTimeout(() => setTutti(0), 640);
      },
      flip: ({ faceDown }) => setNight(faceDown),
    });
    return () => {
      detachVessel();
      if (rattleTimer) clearTimeout(rattleTimer);
      if (tuttiTimer) clearTimeout(tuttiTimer);
    };
  }, []);

  // long-press on a filter chip: solo it — the other filters fall quiet
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let fired = false;
    const detach = attachGestures(rail as HTMLElement, {
      hold: (e) => {
        if (e.fingers !== 1) return;
        if (e.phase === "enter") { fired = false; return; }
        if (e.phase === "release" || fired || e.tier < 2) return;
        const btn = (document.elementFromPoint(e.x, e.y) as HTMLElement | null)
          ?.closest?.("button[data-filter-kind]") as HTMLButtonElement | null;
        if (!btn) return;
        fired = true;
        const kind = btn.dataset.filterKind as ArchiveFilterKind | undefined;
        const value = btn.dataset.filterValue;
        if (!kind || !value) return;
        consumedAtRef.current = performance.now();
        soloRef.current(kind, value);
        try { getFieldAudio().bell(); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
        touchArchiveRef.current(`solo:${value}`, "candle", 0.62);
      },
    }, { wheelZoom: false, manageStyle: false, noCapture: true });
    return detach;
  }, []);

  return (
    <section
      id="archive"
      className={
        "rule"
        + (rattle ? " is-rattling" : "")
        + (tutti ? " is-tutti" : "")
        + (night ? " is-night" : "")
      }
      style={{ scrollMarginTop: 72 }}
    >
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
            ref={railRef}
            onClickCapture={(e) => {
              // a consumed long-press (solo) never doubles as a toggle click
              if (performance.now() - consumedAtRef.current < 700) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
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
              kind="medium"
              options={MEDIUMS}
              active={archMedium}
              onToggle={(v) => handleFilterToggle("medium", v)}
            />
            <FilterGroup
              label="concern"
              kind="concern"
              options={CONCERNS.map((c) => c.id)}
              active={archConcern as Set<string>}
              onToggle={(v) => handleFilterToggle("concern", v)}
            />
            <FilterGroup
              label="object"
              kind="object"
              options={OBJECTS.map((o) => o.id)}
              active={archObject}
              onToggle={(v) => handleFilterToggle("object", v)}
            />
            <FilterGroup
              label="phase"
              kind="phase"
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
            <div className="arch-imagine">
              <div className="t-eyebrow" style={{ color: "var(--candle)" }}>imagine a drawer</div>
              <p className="t-meta italic" style={{ color: "var(--ink-2)", margin: "8px 0 14px", maxWidth: "60ch" }}>
                an empty drawer, waiting. give the room a title and one to three concerns — the field will write the drawer into your archive.
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
                        className={`arch-imagined${expanded ? " is-open" : ""}`}
                        style={{ gridColumn: expanded ? "1 / -1" : undefined }}
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
              <div className="arch-empty">
                <div className="arch-empty-ghost" aria-hidden="true">
                  <ConcernSigil concerns={entryWeightsFromConcerns([])} size={120} showAxes showRing showDots={false} />
                </div>
                <p className="t-h3 italic" style={{ color: "var(--ink-2)", maxWidth: "44ch" }}>
                  no drawer answers that combination — yet.
                </p>
                {(activeFilterCount > 0 || queryTrimmed) && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      useField.setState({
                        archMedium: new Set(),
                        archConcern: new Set(),
                        archObject: new Set(),
                        archPhase: new Set(),
                      });
                      setQuery("");
                      haptics.tap();
                      touchArchive("filters cleared", "ink", 0.4);
                    }}
                  >
                    release the filters
                  </button>
                )}
              </div>
            ) : (
              <div
                ref={gridRef}
                onPointerDownCapture={(e) => {
                  const a = (e.target as HTMLElement).closest?.("a.arch-card") as HTMLAnchorElement | null;
                  downHrefRef.current = a?.getAttribute("href") ?? null;
                }}
                onClickCapture={(e) => {
                  // a consumed flick already opens the drawer — one entry, once
                  if (performance.now() - consumedAtRef.current < 700) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
                  gap: 18,
                }}
              >
                {items.map((a) => {
                  const accent = a.status
                    ? STATUS_COLOR[a.status] ?? "var(--ink-2)"
                    : "var(--ink-2)";
                  const href = `/archive/${entrySlug(a)}`;
                  return (
                  <Link
                    key={a.id}
                    href={href}
                    className={`arch-card${shiverHref === href ? " is-shivering" : ""}`}
                    draggable={false}
                    style={{ ["--card-accent" as string]: accent }}
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
                          className="t-mono arch-status"
                          style={{
                            ["--status-color" as string]:
                              STATUS_COLOR[a.status] ?? "var(--ink-2)",
                          }}
                        >
                          <span className="arch-status-dot" aria-hidden="true" />
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
                    <div className="arch-card-tags t-eyebrow" style={{ marginTop: 14 }}>
                      <span className="arch-card-medium">{a.medium}</span>
                      <span className="arch-card-sep" aria-hidden="true">·</span>
                      <span>{a.phase}</span>
                      <span className="arch-card-sep" aria-hidden="true">·</span>
                      <span style={{ color: "var(--ink-2)" }}>{a.concerns.join(" / ")}</span>
                    </div>
                  </Link>
                  );
                })}
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

        /* ---- specimen-drawer cards: pull, don't lift ---- */
        .arch-card {
          position: relative;
          display: block;
          padding: 22px 22px 22px 26px;
          color: var(--ink);
          text-decoration: none;
          border: 1px solid var(--rule);
          border-left: 3px solid color-mix(in srgb, var(--card-accent, var(--ink-2)), transparent 45%);
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--paper), transparent 42%), transparent 46%),
            var(--paper-2);
          transition: transform var(--t), box-shadow var(--t), border-color var(--t);
        }
        /* the drawer pull, on the front edge */
        .arch-card::before {
          content: "";
          position: absolute;
          left: -3px;
          top: 50%;
          width: 3px;
          height: 18px;
          transform: translateY(-50%);
          background: var(--card-accent, var(--ink-2));
          opacity: 0;
          transition: opacity var(--t), height var(--t);
        }
        .arch-card:hover,
        .arch-card:focus-visible {
          transform: translateX(6px);
          border-color: color-mix(in srgb, var(--card-accent, var(--ink)), var(--rule) 52%);
          border-left-color: var(--card-accent, var(--ink));
          box-shadow:
            -13px 0 28px -18px rgba(21, 23, 26, 0.5),
            inset 0 1px 0 color-mix(in srgb, var(--paper), transparent 28%);
        }
        .arch-card:hover::before,
        .arch-card:focus-visible::before {
          opacity: 0.9;
          height: 34px;
        }
        .arch-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: lowercase;
          color: var(--status-color, var(--ink-2));
          border: 1px solid color-mix(in srgb, var(--status-color, var(--ink-2)), transparent 55%);
          padding: 2px 7px;
        }
        .arch-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--status-color, var(--ink-2));
          box-shadow: 0 0 8px color-mix(in srgb, var(--status-color, var(--ink-2)), transparent 40%);
        }
        .arch-card-tags {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 4px 7px;
          color: var(--ink-2);
        }
        .arch-card-medium { color: var(--ink); }
        .arch-card-sep { color: color-mix(in srgb, var(--rule), transparent 8%); }

        /* ---- imagine: an empty drawer waiting to be filled ---- */
        .arch-imagine {
          position: relative;
          margin-bottom: 28px;
          padding: 20px 22px 22px 26px;
          border: 1px solid var(--rule);
          border-left: 3px solid color-mix(in srgb, var(--candle), transparent 45%);
          background: linear-gradient(180deg, color-mix(in srgb, var(--paper), transparent 30%), var(--paper-2));
          box-shadow: inset 0 12px 26px -20px rgba(21, 23, 26, 0.6);
        }
        .arch-imagine::before {
          content: "";
          position: absolute;
          left: -3px;
          top: 50%;
          width: 3px;
          height: 26px;
          transform: translateY(-50%);
          background: var(--candle);
          opacity: 0.55;
        }

        /* ---- imagined drawers: kept locally ---- */
        .arch-imagined {
          position: relative;
          padding: 22px 22px 22px 26px;
          border: 1px solid var(--rule);
          border-left: 3px solid color-mix(in srgb, var(--candle), transparent 42%);
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--paper), transparent 42%), transparent 46%),
            var(--paper-2);
          transition: box-shadow var(--t), border-color var(--t);
        }
        .arch-imagined.is-open {
          border-left-color: var(--candle);
          box-shadow: -13px 0 28px -20px rgba(21, 23, 26, 0.42);
        }

        /* a flicked drawer shivers on its runners as it opens */
        .arch-card.is-shivering {
          animation: arch-shiver 260ms ease-out both;
          border-left-color: var(--card-accent, var(--ink));
        }
        .arch-card.is-shivering::before { opacity: 0.9; height: 34px; }
        @keyframes arch-shiver {
          0% { transform: translateX(0); }
          28% { transform: translateX(9px); }
          52% { transform: translateX(4px); }
          74% { transform: translateX(11px); }
          100% { transform: translateX(14px); }
        }

        @media (prefers-reduced-motion: reduce) {
          .arch-card { transition: box-shadow var(--t), border-color var(--t); }
          .arch-card:hover,
          .arch-card:focus-visible { transform: none; }
          .arch-card.is-shivering { animation: none; }
        }

        /* a richer no-results state: a ghost sigil behind the line, and
           a release valve when filters or a search are the cause */
        .arch-empty {
          position: relative;
          padding: 20px 0 4px;
          display: grid;
          gap: 16px;
          justify-items: start;
        }
        .arch-empty-ghost {
          position: absolute;
          top: -10px;
          right: 12px;
          opacity: 0.1;
          color: var(--sea);
          pointer-events: none;
        }

        /* shake — every drawer rattles on its runners at once */
        #archive.is-rattling .arch-card {
          animation: arch-shiver 260ms ease-out both, arch-rattle 380ms ease-in-out;
        }
        @keyframes arch-rattle {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(2px); }
          50% { transform: translateX(-2px); }
          75% { transform: translateX(1px); }
        }
        /* three-finger tap / a knock on the case — tutti, drawers answer once */
        #archive.is-tutti .arch-card::before {
          opacity: 0.9;
          height: 34px;
          transition: opacity 200ms ease, height 200ms ease;
        }
        /* flip face-down — night, until the phone turns back over */
        #archive.is-night .arch-card { opacity: 0.5; transition: opacity 900ms ease; }
        @media (prefers-reduced-motion: reduce) {
          #archive.is-rattling .arch-card { animation: none; }
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
  kind,
  options,
  active,
  onToggle,
}: {
  label: string;
  kind: ArchiveFilterKind;
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
              data-filter-kind={kind}
              data-filter-value={opt}
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
