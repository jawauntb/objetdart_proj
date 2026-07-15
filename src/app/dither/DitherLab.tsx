"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./dither.module.css";

type ChartMode = "area" | "bar" | "line";
type PatternMode = "gradient" | "dotted" | "hatched" | "solid";
type SeriesKey = "desktop" | "mobile";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];
const SERIES: Record<SeriesKey, number[]> = {
  desktop: [74, 126, 111, 174, 158, 226, 202, 278],
  mobile: [38, 62, 88, 70, 122, 148, 177, 214],
};

const PALETTES = {
  lime: { primary: "#d7ff64", secondary: "#79d8ff", glow: "#b9ff66" },
  coral: { primary: "#ff8c74", secondary: "#f8d66d", glow: "#ff6d77" },
  violet: { primary: "#c9a7ff", secondary: "#75efc4", glow: "#9d74ff" },
} as const;

type PaletteName = keyof typeof PALETTES;

const BAYER_4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

function rgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const n = Number.parseInt(value, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function makePattern(
  ctx: CanvasRenderingContext2D,
  color: string,
  pattern: PatternMode,
  density: number,
) {
  const tile = document.createElement("canvas");
  const size = pattern === "hatched" ? 10 : 8;
  tile.width = size;
  tile.height = size;
  const t = tile.getContext("2d");
  if (!t) return color;
  t.clearRect(0, 0, size, size);
  t.fillStyle = color;

  if (pattern === "solid") {
    t.globalAlpha = 0.42;
    t.fillRect(0, 0, size, size);
  } else if (pattern === "hatched") {
    t.globalAlpha = 0.55;
    t.lineWidth = 1;
    t.strokeStyle = color;
    t.beginPath();
    t.moveTo(-2, size);
    t.lineTo(size, -2);
    t.moveTo(3, size + 2);
    t.lineTo(size + 2, 3);
    t.stroke();
  } else {
    const threshold = Math.round(3 + density * 11);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (BAYER_4[y * 4 + x] > threshold) continue;
        t.globalAlpha = pattern === "gradient" ? 0.32 + y * 0.13 : 0.62;
        t.fillRect(x * 2, y * 2, 1.25, 1.25);
      }
    }
  }
  return ctx.createPattern(tile, "repeat") ?? color;
}

function linePoints(values: number[], width: number, height: number) {
  const left = 44;
  const right = 18;
  const top = 26;
  const bottom = 38;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  return values.map((value, index) => ({
    x: left + (index / (values.length - 1)) * innerW,
    y: top + (1 - value / 300) * innerH,
  }));
}

function DitherChart({
  mode,
  pattern,
  palette,
  density,
  replayToken,
  focus,
  locked,
  onFocus,
}: {
  mode: ChartMode;
  pattern: PatternMode;
  palette: (typeof PALETTES)[PaletteName];
  density: number;
  replayToken: number;
  focus: SeriesKey | null;
  locked: boolean;
  onFocus: (focus: SeriesKey | null, locked?: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [scrubLocked, setScrubLocked] = useState(false);
  const animationRef = useRef(1);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const left = 44;
    const right = 18;
    const top = 26;
    const bottom = 38;
    const baseY = height - bottom;
    const innerW = width - left - right;
    const progress = animationRef.current;

    ctx.font = "10px var(--font-text)";
    ctx.fillStyle = "rgba(236,240,220,.45)";
    ctx.textAlign = "right";
    for (const tick of [0, 100, 200, 300]) {
      const y = top + (1 - tick / 300) * (height - top - bottom);
      ctx.strokeStyle = "rgba(236,240,220,.09)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(width - right, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(tick), left - 9, y + 3);
    }
    ctx.textAlign = "center";
    MONTHS.forEach((month, index) => {
      const x = left + (index / (MONTHS.length - 1)) * innerW;
      ctx.fillText(month, x, height - 13);
    });

    const order: SeriesKey[] = ["mobile", "desktop"];
    order.forEach((key) => {
      const values = SERIES[key];
      const color = key === "desktop" ? palette.primary : palette.secondary;
      const points = linePoints(values, width, height).map((point) => ({
        x: point.x,
        y: baseY - (baseY - point.y) * progress,
      }));
      const dimmed = focus && focus !== key;
      ctx.save();
      ctx.globalAlpha = dimmed ? 0.14 : focus === key ? 1 : 0.78;

      if (mode === "bar") {
        const barW = Math.max(7, innerW / MONTHS.length / 3.2);
        points.forEach((point) => {
          const offset = key === "desktop" ? -barW * 0.6 : barW * 0.6;
          ctx.fillStyle = makePattern(ctx, color, pattern, density);
          ctx.fillRect(point.x + offset - barW / 2, point.y, barW, baseY - point.y);
          ctx.strokeStyle = rgba(color, 0.92);
          ctx.strokeRect(point.x + offset - barW / 2, point.y, barW, baseY - point.y);
        });
      } else {
        if (mode === "area") {
          ctx.beginPath();
          ctx.moveTo(points[0].x, baseY);
          points.forEach((point) => ctx.lineTo(point.x, point.y));
          ctx.lineTo(points[points.length - 1].x, baseY);
          ctx.closePath();
          ctx.fillStyle = makePattern(ctx, color, pattern, density);
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = focus === key ? 2.5 : 1.6;
        ctx.shadowColor = color;
        ctx.shadowBlur = dimmed ? 0 : focus === key ? 16 : 7;
        ctx.beginPath();
        points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      }
      ctx.restore();
    });

    if (scrubIndex !== null) {
      const x = left + (scrubIndex / (MONTHS.length - 1)) * innerW;
      ctx.strokeStyle = "rgba(247,246,226,.55)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, baseY);
      ctx.stroke();
      ctx.setLineDash([]);
      (["desktop", "mobile"] as SeriesKey[]).forEach((key) => {
        const color = key === "desktop" ? palette.primary : palette.secondary;
        const point = linePoints(SERIES[key], width, height)[scrubIndex];
        ctx.fillStyle = "#10130e";
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  }, [density, focus, mode, palette, pattern, scrubIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      animationRef.current = 1;
      draw();
      return;
    }
    animationRef.current = 0;
    let frame = 0;
    const started = performance.now();
    const animate = (now: number) => {
      const raw = Math.min(1, (now - started) / 760);
      animationRef.current = 1 - Math.pow(1 - raw, 3);
      draw();
      if (raw < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [replayToken, mode, draw]);

  const updateScrub = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(44, Math.min(rect.width - 18, clientX - rect.left));
    setScrubIndex(Math.round(((x - 44) / (rect.width - 62)) * (MONTHS.length - 1)));
  };

  const tooltipPosition = scrubIndex === null ? 50 : 14 + (scrubIndex / 7) * 78;
  return (
    <div className={styles.chartWrap}>
      <canvas
        ref={canvasRef}
        className={styles.chart}
        aria-label="Interactive chart comparing desktop and mobile signals from January through August"
        onPointerMove={(event) => updateScrub(event.clientX)}
        onPointerDown={(event) => {
          updateScrub(event.clientX);
          setScrubLocked((value) => !value);
        }}
        onPointerLeave={() => {
          if (!scrubLocked) setScrubIndex(null);
        }}
      />
      {scrubIndex !== null && (
        <div
          className={styles.tooltip}
          style={{ left: `${tooltipPosition}%` }}
          aria-live="polite"
        >
          <span>{MONTHS[scrubIndex]}</span>
          <strong style={{ color: palette.primary }}>{SERIES.desktop[scrubIndex]}</strong>
          <strong style={{ color: palette.secondary }}>{SERIES.mobile[scrubIndex]}</strong>
        </div>
      )}
      <div className={styles.legend} aria-label="Chart series">
        {(["desktop", "mobile"] as SeriesKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={focus === key ? styles.legendActive : undefined}
            aria-pressed={locked && focus === key}
            onPointerEnter={() => { if (!locked) onFocus(key); }}
            onPointerLeave={() => { if (!locked) onFocus(null); }}
            onClick={() => onFocus(focus === key && locked ? null : key, !(focus === key && locked))}
          >
            <i style={{ background: key === "desktop" ? palette.primary : palette.secondary }} />
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

function MiniStudy({ kind, palette }: { kind: "bar" | "pie" | "radar"; palette: (typeof PALETTES)[PaletteName] }) {
  const patternId = `dots-${kind}`;
  if (kind === "bar") {
    return (
      <svg viewBox="0 0 320 160" role="img" aria-label="Dithered bar study">
        <defs><DotPattern id={patternId} color={palette.primary} /></defs>
        {[58, 94, 70, 124, 110, 140].map((height, index) => (
          <rect key={height + index} x={22 + index * 48} y={146 - height} width="28" height={height} fill={`url(#${patternId})`} stroke={palette.primary} strokeWidth="1" />
        ))}
        <path d="M12 146H308" stroke="currentColor" opacity=".18" />
      </svg>
    );
  }
  if (kind === "pie") {
    return (
      <svg viewBox="0 0 320 160" role="img" aria-label="Dithered pie study">
        <defs><DotPattern id={patternId} color={palette.primary} /></defs>
        <circle cx="160" cy="80" r="57" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="28" />
        <circle cx="160" cy="80" r="57" fill="none" stroke={`url(#${patternId})`} strokeWidth="28" strokeDasharray="222 136" transform="rotate(-90 160 80)" />
        <circle cx="160" cy="80" r="57" fill="none" stroke={palette.secondary} strokeOpacity=".75" strokeWidth="28" strokeDasharray="78 280" strokeDashoffset="-230" transform="rotate(-90 160 80)" />
        <text x="160" y="84" textAnchor="middle" fill="currentColor" fontSize="20">62%</text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 160" role="img" aria-label="Dithered radar study">
      <defs><DotPattern id={patternId} color={palette.primary} /></defs>
      {[1, .72, .44].map((scale) => <polygon key={scale} points="160,18 218,52 218,114 160,146 102,114 102,52" fill="none" stroke="currentColor" opacity={0.08 + scale * 0.08} transform={`translate(${160 * (1 - scale)} ${80 * (1 - scale)}) scale(${scale})`} />)}
      <polygon points="160,29 207,59 195,111 160,136 113,107 124,56" fill={`url(#${patternId})`} stroke={palette.primary} strokeWidth="1.5" />
      {[[160,29],[207,59],[195,111],[160,136],[113,107],[124,56]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.5" fill={palette.secondary} />)}
    </svg>
  );
}

function DotPattern({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="1.5" cy="1.5" r="1" fill={color} />
      <circle cx="4.5" cy="4.5" r=".6" fill={color} opacity=".55" />
    </pattern>
  );
}

function hashName(name: string) {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function DitherAvatar({ name }: { name: string }) {
  const cells = useMemo(() => {
    const hash = hashName(name);
    return Array.from({ length: 7 }, (_, row) => Array.from({ length: 7 }, (_, col) => {
      const mirrored = col > 3 ? 6 - col : col;
      return ((hash >>> ((row * 4 + mirrored) % 28)) & 1) === 1;
    }));
  }, [name]);
  const hue = hashName(name) % 360;
  return (
    <div className={styles.avatar} style={{ "--avatar-hue": hue } as React.CSSProperties}>
      <svg viewBox="0 0 56 56" role="img" aria-label={`${name} generative avatar`}>
        {cells.flatMap((row, y) => row.map((on, x) => on ? <rect key={`${x}-${y}`} x={x * 8} y={y * 8} width="7" height="7" rx="1" /> : null))}
      </svg>
      <span>{name}</span>
    </div>
  );
}

export default function DitherLab() {
  const [mode, setMode] = useState<ChartMode>("area");
  const [pattern, setPattern] = useState<PatternMode>("gradient");
  const [paletteName, setPaletteName] = useState<PaletteName>("lime");
  const [density, setDensity] = useState(.62);
  const [focus, setFocus] = useState<SeriesKey | null>(null);
  const [focusLocked, setFocusLocked] = useState(false);
  const [replayToken, setReplayToken] = useState(0);
  const palette = PALETTES[paletteName];

  const onFocus = (next: SeriesKey | null, nextLocked = false) => {
    setFocus(next);
    setFocusLocked(nextLocked);
  };

  return (
    <div
      className={styles.page}
      style={{
        "--signal-primary": palette.primary,
        "--signal-secondary": palette.secondary,
        "--signal-glow": palette.glow,
      } as React.CSSProperties}
    >
      <div className={styles.ambient} aria-hidden="true" />
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.kicker}><span>edition 32×32</span><i />one small engine</div>
          <h1>the image<br />between pixels</h1>
          <p>
            Charts, marks, and luminous fields assembled from absence—ordered dots that stay legible in shade and light.
          </p>
          <div className={styles.heroNotes}>
            <span>scrub the signal</span>
            <span>hover to isolate</span>
            <span>tap to hold</span>
          </div>
        </div>

        <div className={styles.console}>
          <div className={styles.consoleTop}>
            <div>
              <span>signal / 08</span>
              <strong>paired transmission</strong>
            </div>
            <button type="button" onClick={() => setReplayToken((value) => value + 1)}>
              replay <span aria-hidden="true">↗</span>
            </button>
          </div>
          <DitherChart
            mode={mode}
            pattern={pattern}
            palette={palette}
            density={density}
            replayToken={replayToken}
            focus={focus}
            locked={focusLocked}
            onFocus={onFocus}
          />
          <div className={styles.controls}>
            <fieldset>
              <legend>shape</legend>
              <div className={styles.segmented}>
                {(["area", "bar", "line"] as ChartMode[]).map((value) => (
                  <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{value}</button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>surface</legend>
              <div className={styles.segmented}>
                {(["gradient", "dotted", "hatched", "solid"] as PatternMode[]).map((value) => (
                  <button key={value} type="button" aria-pressed={pattern === value} onClick={() => setPattern(value)}>{value}</button>
                ))}
              </div>
            </fieldset>
            <label className={styles.density}>
              <span>density <output>{Math.round(density * 100)}</output></span>
              <input type="range" min="0.15" max="1" step="0.01" value={density} onChange={(event) => setDensity(Number(event.target.value))} />
            </label>
            <fieldset className={styles.paletteField}>
              <legend>ink</legend>
              <div className={styles.swatches}>
                {(Object.keys(PALETTES) as PaletteName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={`${name} palette`}
                    aria-pressed={paletteName === name}
                    style={{ background: PALETTES[name].primary }}
                    onClick={() => setPaletteName(name)}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </section>

      <section className={styles.studies}>
        <header className={styles.sectionHeader}>
          <span>01 / instruments</span>
          <h2>one grammar,<br />many readings</h2>
          <p>The dot is not decoration. It carries weight, direction, and uncertainty without needing more color.</p>
        </header>
        <div className={styles.studyGrid}>
          {(["bar", "pie", "radar"] as const).map((kind, index) => (
            <article className={styles.studyCard} key={kind}>
              <div className={styles.studyMeta}><span>0{index + 1}</span><strong>{kind}</strong><i>live study</i></div>
              <MiniStudy kind={kind} palette={palette} />
              <p>{kind === "bar" ? "frequency held in columns" : kind === "pie" ? "a whole with a bright remainder" : "six bearings, one nervous shape"}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.specimens}>
        <header className={styles.sectionHeader}>
          <span>02 / specimens</span>
          <h2>identity,<br />pressed into a grid</h2>
          <p>Each name becomes a mirrored field. The same letters always return the same face.</p>
        </header>
        <div className={styles.avatarRow}>
          {["dan", "orla", "mine", "yours", "nobody"].map((name) => <DitherAvatar key={name} name={name} />)}
        </div>
      </section>

      <section className={styles.touchSection}>
        <div className={styles.wash} aria-hidden="true" />
        <div className={styles.touchCopy}>
          <span>03 / pressure</span>
          <h2>density becomes<br />a gesture</h2>
          <p>Hover, press, release. The surface answers by gathering more ink beneath your hand.</p>
        </div>
        <div className={styles.buttonRack}>
          <button type="button" className={styles.ditherButton}>save the signal</button>
          <button type="button" className={`${styles.ditherButton} ${styles.ditherButtonOutline}`}>deploy →</button>
          <button type="button" className={`${styles.ditherButton} ${styles.ditherButtonSoft}`}>hold the light</button>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>dither / objet d&rsquo;art</span>
        <p>made from a 4×4 threshold, two inks, and the dark between them.</p>
        <a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>return to signal ↑</a>
      </footer>
    </div>
  );
}
