import { GUIDE_ROOMS } from "@/data/guide";
import { auroraSpots, hexToRgba } from "@/lib/guide-aurora";

/**
 * The album's threshold: title, lede, TOC, and the aurora of room-colored
 * blobs that light the type. Rendered server-side — the aurora spot data is
 * pre-computed pure JS, and the animation is CSS in guide.css. Touch devices
 * hide the aurora entirely via a media query (see guide.css); the static
 * gradient background still lights the type without any GPU cost.
 */
export default function GuideHero() {
  const spots = auroraSpots(GUIDE_ROOMS.map((room) => room.key));

  return (
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
  );
}
