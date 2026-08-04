"use client";

import Image from "next/image";
import Link from "next/link";
import {
  GUIDE_APIS,
  GUIDE_FIRST_MINUTE,
  GUIDE_GLOBAL_BINDINGS,
  GUIDE_LAYERS,
  GUIDE_ROOMS,
  GUIDE_WORKSHOP,
  type GuideRoom,
} from "@/data/guide";
import { SITE_ROUTE_BY_KEY } from "@/lib/routes";
import { auroraSpots, hexToRgba, resolveRoomPalette } from "@/lib/guide-aurora";

// The one sanctioned reading surface where the site explains itself
// (AGENTS.md, "the documentation law"). The rooms never explain; this page
// carries every instruction so they don't have to.

const CLUSTER_LABELS: Record<string, string> = {
  threshold: "the threshold",
  field: "the field",
  water: "the water",
  nature: "the living world",
  mechanism: "the mechanism",
};

const CLUSTER_ORDER = ["threshold", "field", "water", "nature", "mechanism"];

function clusterOf(room: GuideRoom): string {
  if (room.key === "home") return "threshold";
  return SITE_ROUTE_BY_KEY[room.key]?.cluster ?? "field";
}

export default function Guide() {
  const grouped = CLUSTER_ORDER.map((cluster) => ({
    cluster,
    rooms: GUIDE_ROOMS.filter((room) => clusterOf(room) === cluster),
  })).filter((group) => group.rooms.length > 0);

  const spots = auroraSpots(GUIDE_ROOMS.map((room) => room.key));

  return (
    <div className="guide">
      {/* threshold — a room of its own: the album's full palette, breathing */}
      <header className="guide-hero">
        <div className="guide-hero-room">
          <div className="guide-aurora" aria-hidden="true">
            {spots.map((spot) => (
              <span
                key={spot.key}
                className="guide-aurora-spot"
                style={{
                  left: `${spot.leftPct}%`,
                  top: `${spot.topPct}%`,
                  width: spot.sizePx,
                  height: spot.sizePx,
                  background: `radial-gradient(circle at 40% 35%, ${hexToRgba(spot.color, 0.55)}, ${hexToRgba(spot.color2, 0.28)} 45%, transparent 72%)`,
                  animationDelay: `${spot.delayMs}ms`,
                  animationDuration: `${spot.durationMs}ms`,
                }}
              />
            ))}
          </div>
          <div className="guide-hero-scrim" aria-hidden="true" />
          <div className="guide-hero-text">
            <p className="t-eyebrow guide-hero-eyebrow">the field guide</p>
            <h1 className="t-h1 guide-hero-title">
              <em>how to hold it</em>
            </h1>
            <p className="t-body guide-lede">
              the rooms of this site never explain themselves — that is their law. everything
              is meant to be found by a curious hand inside a minute of play. this page is the
              one place the law is lifted: an onboarding walk for the first visit, the grammar
              every room speaks, an exhaustive account of each room — every color here is a
              real room&rsquo;s own — and the workshop where the machinery is kept.
            </p>
            <nav className="guide-toc t-mono" aria-label="guide sections">
              <a href="#first-minute">the first minute</a>
              <a href="#grammar">the grammar</a>
              <a href="#rooms">the rooms</a>
              <a href="#workshop">the workshop</a>
            </nav>
          </div>
        </div>
      </header>

      {/* onboarding */}
      <section id="first-minute" className="guide-section">
        <h2 className="t-h2 guide-h2">
          <em>the first minute</em>
        </h2>
        <p className="t-body guide-note">
          arrive with sound on if you can. nothing here autoplays — the sea waits for your
          first touch.
        </p>
        <ol className="guide-steps">
          {GUIDE_FIRST_MINUTE.map((step, index) => (
            <li key={step.title} className="guide-step">
              <span className="guide-step-num t-mono">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3 className="t-h3 guide-step-title">{step.title}</h3>
                <p className="t-body guide-step-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* grammar */}
      <section id="grammar" className="guide-section">
        <h2 className="t-h2 guide-h2">
          <em>the grammar of the hand</em>
        </h2>
        <p className="t-body guide-note">
          one grammar, every room. the number of fingers chooses which layer of the world you
          are touching — learn it once and it holds everywhere, forever.
        </p>
        <div className="guide-layers">
          {GUIDE_LAYERS.map((layer) => (
            <div key={layer.title} className="guide-layer">
              <h3 className="t-mono guide-layer-title">{layer.title}</h3>
              <p className="t-body guide-layer-body">{layer.body}</p>
            </div>
          ))}
        </div>
        <table className="guide-bindings">
          <caption className="t-mono guide-bindings-caption">
            the global bindings — identical in every room
          </caption>
          <tbody>
            {GUIDE_GLOBAL_BINDINGS.map((binding) => (
              <tr key={binding.gesture}>
                <th scope="row" className="t-mono">{binding.gesture}</th>
                <td className="t-body">{binding.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* rooms */}
      <section id="rooms" className="guide-section">
        <h2 className="t-h2 guide-h2">
          <em>the rooms, exhaustively</em>
        </h2>
        <p className="t-body guide-note">
          every route, every move it answers. the global bindings above are assumed
          throughout and not repeated; what follows is each room&rsquo;s own register.
          screenshots are kept current by the workshop — if a picture and a room disagree,
          the room is newer.
        </p>
        {grouped.map((group) => (
          <div key={group.cluster} className="guide-cluster">
            <h3 className="t-eyebrow guide-cluster-title">{CLUSTER_LABELS[group.cluster]}</h3>
            {group.rooms.map((room) => {
              const palette = resolveRoomPalette(room.key);
              return (
              <article
                key={room.key}
                id={`room-${room.key}`}
                className="guide-room"
                style={{
                  "--room-glow": palette.glow,
                  "--room-accent2": palette.accent2,
                  "--room-border": hexToRgba(palette.glow, 0.55),
                } as React.CSSProperties}
              >
                <div className="guide-room-shot">
                  <Link href={room.href} aria-label={`enter ${room.title}`}>
                    <Image
                      src={`/guide/${room.key}.jpg`}
                      alt={`${room.title} — ${room.essence}`}
                      width={1200}
                      height={750}
                      loading="lazy"
                      sizes="(max-width: 760px) 100vw, 460px"
                    />
                  </Link>
                </div>
                <div className="guide-room-text">
                  <header className="guide-room-head">
                    <span className="guide-room-dot" aria-hidden="true" />
                    <h4 className="t-h3 guide-room-title">
                      <em>{room.title}</em>
                    </h4>
                    <Link className="t-mono guide-room-href" href={room.href}>
                      {room.href} →
                    </Link>
                  </header>
                  {room.scale ? <p className="t-mono guide-room-scale">{room.scale}</p> : null}
                  <p className="t-body guide-room-essence">{room.essence}</p>
                  <ul className="guide-moves">
                    {room.moves.map((move) => {
                      const [gesture, ...rest] = move.split("→");
                      return (
                        <li key={move}>
                          <span className="t-mono guide-move-gesture">{gesture.trim()}</span>
                          <span className="t-body guide-move-answer">{rest.join("→").trim()}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {room.finds.length > 0 ? (
                    <p className="t-body guide-room-finds">
                      <span className="t-mono guide-room-finds-label">for the patient hand · </span>
                      {room.finds.join(" · ")}
                    </p>
                  ) : null}
                  {room.keeps ? (
                    <p className="t-mono guide-room-keeps">it keeps: {room.keeps}</p>
                  ) : null}
                </div>
              </article>
              );
            })}
          </div>
        ))}
      </section>

      {/* workshop */}
      <section id="workshop" className="guide-section">
        <h2 className="t-h2 guide-h2">
          <em>the workshop</em>
        </h2>
        <p className="t-body guide-note">
          for the ones who would build a room of their own — how the machinery is kept, and
          the covenants a new room signs before it joins the album.
        </p>
        {GUIDE_WORKSHOP.map((part) => (
          <div key={part.title} className="guide-workshop-part">
            <h3 className="t-h3 guide-workshop-title">
              <em>{part.title}</em>
            </h3>
            {part.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="t-body guide-workshop-body">
                {paragraph}
              </p>
            ))}
          </div>
        ))}

        <div className="guide-workshop-part">
          <h3 className="t-h3 guide-workshop-title">
            <em>the http api</em>
          </h3>
          <p className="t-body guide-workshop-body">
            the room&rsquo;s few server offices, all stateless: each takes the current state in
            the request body and stores nothing. all prefer <span className="t-mono">ANTHROPIC_API_KEY</span>,
            fall back to <span className="t-mono">GEMINI_API_KEY</span>, and answer 503 with a
            hint when neither is set. the voice rules are hard-coded into every system prompt.
          </p>
          <div className="guide-apis">
            {GUIDE_APIS.map((api) => (
              <div key={api.name} className="guide-api">
                <p className="t-mono guide-api-name">
                  {api.method} /api/{api.name}
                </p>
                <p className="t-body guide-api-line"><span className="t-mono">takes ·</span> {api.takes}</p>
                <p className="t-body guide-api-line"><span className="t-mono">returns ·</span> {api.returns}</p>
                {api.notes ? <p className="t-body guide-api-line"><span className="t-mono">notes ·</span> {api.notes}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <style
        dangerouslySetInnerHTML={{
          __html: `
.guide {
  max-width: var(--max);
  margin: 0 auto;
  padding: var(--pad-y) var(--pad-x);
}
.guide a { transition: color var(--t); }
.guide-hero { max-width: 100%; }
.guide-hero-room {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(120% 160% at 12% -10%, rgba(79, 183, 200, 0.16), transparent 55%),
    radial-gradient(130% 140% at 92% 118%, rgba(231, 185, 78, 0.14), transparent 60%),
    linear-gradient(165deg, #0a0e17 0%, #10141f 55%, #140f1c 100%);
  border: 1px solid rgba(232, 226, 213, 0.14);
  padding: clamp(40px, 7vw, 76px) clamp(24px, 5vw, 64px) clamp(44px, 7vw, 80px);
}
.guide-aurora {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.guide-aurora-spot {
  position: absolute;
  margin-left: -60px;
  margin-top: -60px;
  border-radius: 50%;
  opacity: 0.72;
  animation: guide-breathe 7s ease-in-out infinite;
}
@keyframes guide-breathe {
  0%, 100% { transform: scale(0.92); opacity: 0.55; }
  50% { transform: scale(1.08); opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  /* fully hide instead of just pausing — the compositor cost survives paused animation */
  .guide-aurora { display: none; }
}
/* Touch devices (iPad, iPhone, Android tablets/phones) skip the aurora entirely.
 * 20 blurred radial-gradient blobs on continuous scale animation reliably froze
 * iPad Safari — one GPU layer per spot, and the previous mix-blend-mode: screen
 * forced full offscreen composition every frame. The aurora is decorative; a
 * static room-lit hero is still the intended look on touch. */
@media (pointer: coarse) {
  .guide-aurora { display: none; }
}
.guide-hero-scrim {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(
    100deg,
    rgba(9, 12, 19, 0.86) 0%,
    rgba(9, 12, 19, 0.62) 38%,
    rgba(9, 12, 19, 0.22) 62%,
    transparent 82%
  );
  pointer-events: none;
}
.guide-hero-text { position: relative; z-index: 1; max-width: 760px; }
.guide-hero-eyebrow { color: rgba(232, 226, 213, 0.72); }
.guide-hero-title { margin: 10px 0 18px; color: rgba(244, 238, 222, 0.98); }
.guide-lede { color: rgba(232, 226, 213, 0.82); }
.guide-toc {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 22px;
  margin-top: 26px;
  font-size: 13px;
}
.guide-toc a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  color: rgba(232, 226, 213, 0.86);
  border-bottom: 1px solid rgba(232, 226, 213, 0.22);
}
.guide-toc a:hover { color: var(--candle); border-bottom-color: var(--candle); }
.guide-section {
  margin-top: clamp(64px, 9vw, 110px);
  padding-top: 28px;
  border-top: 1px solid var(--rule);
}
.guide-h2 { margin-bottom: 12px; }
.guide-note { max-width: 640px; color: var(--ink-2); }
.guide-steps {
  list-style: none;
  margin: 34px 0 0;
  padding: 0;
  display: grid;
  gap: 26px;
}
.guide-step {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 14px;
  max-width: 700px;
}
.guide-step-num { color: var(--candle); font-size: 13px; padding-top: 5px; }
.guide-step-title { margin: 0 0 6px; }
.guide-step-body { color: var(--ink-2); }
.guide-layers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 22px;
  margin: 34px 0 40px;
}
.guide-layer { border-left: 2px solid var(--candle); padding-left: 14px; }
.guide-layer-title { font-size: 12px; letter-spacing: 0.08em; margin: 0 0 8px; }
.guide-layer-body { color: var(--ink-2); font-size: 16px; }
.guide-bindings { width: 100%; max-width: 760px; border-collapse: collapse; }
.guide-bindings-caption {
  text-align: left;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ink-2);
  padding-bottom: 10px;
}
.guide-bindings tr { border-top: 1px solid var(--rule); }
.guide-bindings th {
  text-align: left;
  font-weight: 500;
  font-size: 13px;
  padding: 10px 18px 10px 0;
  white-space: nowrap;
  vertical-align: top;
  width: 1%;
}
.guide-bindings td { padding: 10px 0; font-size: 16px; color: var(--ink-2); }
.guide-cluster { margin-top: 54px; }
.guide-cluster-title { margin-bottom: 6px; }
.guide-room {
  display: grid;
  grid-template-columns: minmax(0, 460px) 1fr;
  gap: clamp(18px, 3vw, 36px);
  padding: 30px 0 30px 18px;
  border-top: 1px solid var(--rule);
  border-left: 3px solid var(--room-border, var(--rule));
  align-items: start;
}
.guide-room-shot img {
  width: 100%;
  height: auto;
  display: block;
  border: 1px solid var(--room-border, var(--rule));
}
.guide-room-shot { position: sticky; top: 84px; }
.guide-room-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 12px;
}
.guide-room-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--room-glow), var(--room-accent2));
  flex: none;
}
.guide-room-title { margin: 0; font-size: 26px; }
.guide-room-href { font-size: 12px; color: var(--ink-2); }
.guide-room-href:hover { color: var(--room-glow, var(--candle)); }
.guide-room-scale { font-size: 11px; letter-spacing: 0.05em; color: var(--sea); margin-top: 6px; }
.guide-room-essence { margin-top: 10px; color: var(--ink-2); font-style: italic; }
.guide-moves { list-style: none; margin: 16px 0 0; padding: 0; }
.guide-moves li {
  display: grid;
  grid-template-columns: minmax(120px, 190px) 1fr;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px dashed var(--rule);
}
.guide-move-gesture { font-size: 12px; padding-top: 2px; color: var(--ink); }
.guide-move-answer { font-size: 15px; color: var(--ink-2); }
.guide-room-finds { margin-top: 16px; font-size: 15px; color: var(--ink-2); }
.guide-room-finds-label { font-size: 11px; letter-spacing: 0.06em; color: var(--candle); }
.guide-room-keeps { margin-top: 10px; font-size: 11px; letter-spacing: 0.05em; color: var(--kept); }
.guide-workshop-part { max-width: 720px; margin-top: 40px; }
.guide-workshop-title { margin-bottom: 10px; }
.guide-workshop-body { color: var(--ink-2); margin-top: 10px; }
.guide-workshop-body .t-mono { font-size: 13px; }
.guide-apis { display: grid; gap: 18px; margin-top: 20px; }
.guide-api { border: 1px solid var(--rule); padding: 16px 18px; background: var(--paper-2); }
.guide-api-name { font-size: 13px; margin-bottom: 8px; }
.guide-api-line { font-size: 15px; color: var(--ink-2); margin-top: 4px; }
.guide-api-line .t-mono { font-size: 11px; letter-spacing: 0.06em; }
@media (max-width: 760px) {
  .guide-room { grid-template-columns: 1fr; padding-left: 14px; }
  .guide-room-shot { position: static; }
  .guide-moves li { grid-template-columns: 1fr; gap: 2px; }
  .guide-hero-room { padding: 40px 20px 46px; }
}
/* iPad-class widths (portrait 820, small landscape) and any coarse pointer
 * skip position: sticky on the room shots. 55 simultaneously sticky elements
 * are cheap on desktop but a scroll-thread killer on iPad Safari. */
@media (max-width: 1024px), (pointer: coarse) {
  .guide-room-shot { position: static; }
}
`,
        }}
      />
    </div>
  );
}
