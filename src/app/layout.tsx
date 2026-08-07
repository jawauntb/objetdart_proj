import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, JetBrains_Mono, Fraunces } from "next/font/google";
import "@/styles/globals.css";
import SoundToggle from "@/components/SoundToggle";
import RoomHelp from "@/components/RoomHelp";
import CandleMark from "@/components/CandleMark";
import Tape from "@/components/Tape";
import FieldWatch from "@/components/FieldWatch";
import ConcernTint from "@/components/ConcernTint";
import GlobalPretextText from "@/components/GlobalPretextText";
import TravelPassageHost from "@/components/TravelPassage";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import { SITE_ORIGIN } from "@/lib/site-icon-config";
import { siteMetadata } from "@/lib/site-metadata";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

// Fraunces — used for instrument numerals (the tape, field watch). The
// optical-size axis gives it the warm, high-contrast cut at large sizes
// that Cormorant can't quite hit; lining-nums keep digits stable.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  ...siteMetadata("home"),
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: "objet d'art",
  keywords: [
    "personal instrument",
    "art object",
    "meditation",
    "interactive poem",
    "objet d'art",
  ],
  // iOS auto-linkifies bare digit runs as `tel:` links — the poem's numerals
  // (dates, page numbers, breath counts) get an underline and turn blue. Turn
  // that off site-wide so text keeps its material.
  formatDetection: { telephone: false },
  // Android Chrome's standalone hint. `apple-mobile-web-app-capable` covers
  // iOS via `appleWebApp.capable` in siteMetadata(); mirror it here so a
  // Chrome-on-Android install behaves the same. Next 14's `other` passes
  // through unchanged.
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // draw into the safe areas (notch / home indicator) so immersive scenes
  // like /ocean fill the screen edge-to-edge; chrome opts back in with
  // env(safe-area-inset-*) so nothing important hides under device bezels.
  viewportFit: "cover",
  // themeColor is set per-room from `siteMetadata()` (visual.bg), so moving
  // between rooms retints the iOS Safari chrome instead of flashing the
  // paper default between every navigation.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${fraunces.variable}`}>
      <body>
        {children}
        <GlobalPretextText />
        <Tape />
        <FieldWatch />
        <CandleMark />
        <SoundToggle />
        {/* The `?` sits one step above the sound toggle in the same corner. It
            is the only surface that explains, it never opens itself, and it
            renders the current route's own field-guide entry — see
            src/components/RoomHelp.tsx and AGENTS.md, "no instructions". */}
        <RoomHelp />
        <ConcernTint />
        {/* The passage host lives in the root layout so a band-crossing film
            survives the route change it plays over (App Router never remounts
            the root layout). Renders nothing until a crossing cues it. */}
        <TravelPassageHost />
        <GoogleAnalytics />
      </body>
    </html>
  );
}
