import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { GuideRoom } from "@/data/guide";
import { hexToRgba, resolveRoomPalette } from "@/lib/guide-aurora";

/**
 * One room card. Server-rendered so no JS ships for these 55 cards.
 * The parent .guide-room selector applies content-visibility: auto,
 * so off-screen cards skip layout entirely until scrolled near — the
 * single biggest scroll-perf win on mobile.
 */
export default function GuideRoomCard({ room }: { room: GuideRoom }) {
  const palette = resolveRoomPalette(room.key);
  const style = {
    "--room-glow": palette.glow,
    "--room-accent2": palette.accent2,
    "--room-border": hexToRgba(palette.glow, 0.55),
  } as CSSProperties;

  return (
    <article id={`room-${room.key}`} className="guide-room" style={style}>
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
}
