import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, JetBrains_Mono, Fraunces } from "next/font/google";
import "@/styles/globals.css";
import SoundToggle from "@/components/SoundToggle";
import CandleMark from "@/components/CandleMark";
import Tape from "@/components/Tape";
import FieldWatch from "@/components/FieldWatch";
import ConcernTint from "@/components/ConcernTint";

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
  metadataBase: new URL("https://objetdart-production.up.railway.app"),
  applicationName: "objet d'art",
  title: "objet d'art — a candle inside the command center, facing the sea",
  description:
    "a working instrument for a life — a room you tune, an atlas you cross, an archive you keep.",
  keywords: [
    "personal instrument",
    "art object",
    "meditation",
    "interactive poem",
    "objet d'art",
  ],
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/apple-icon",
  },
  appleWebApp: {
    capable: true,
    title: "objet d'art",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://objetdart-production.up.railway.app",
    title: "objet d'art — a candle inside the command center, facing the sea",
    description:
      "a working instrument for a life — a room you tune, an atlas you cross, an archive you keep.",
    siteName: "objet d'art",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "objet d'art — a candle inside the command center, facing the sea.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "objet d'art — a candle inside the command center, facing the sea",
    description:
      "a working instrument for a life — a room you tune, an atlas you cross, an archive you keep.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F2EEE6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${fraunces.variable}`}>
      <body>
        {children}
        <Tape />
        <FieldWatch />
        <CandleMark />
        <SoundToggle />
        <ConcernTint />
      </body>
    </html>
  );
}
