import type { Metadata } from "next";
import {
  SITE_ICON_VISUALS,
  SITE_ORIGIN,
  siteIconPath,
  type SiteIconKey,
} from "@/lib/site-icon-config";
import { SITE_ROUTE_BY_KEY } from "@/lib/routes";

type SiteMetadataOptions = {
  path?: string;
  title?: string;
  description?: string;
  openGraphImage?: string;
};

/**
 * Rough perceived-luminance test on a `#rrggbb` (or `#rgb`) hex color. Used
 * as the fallback when a room key has no explicit `dark` bit in
 * `SITE_ROUTES` — the site icon palette carries a `bg` for every room, and
 * that is what the visitor actually sees.
 */
function isBgDark(hex: string): boolean {
  const h = hex.replace(/^#/, "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (v.length !== 6) return false;
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.5;
}

/**
 * The iOS status-bar mode this room should ask for. Dark rooms want
 * `black-translucent` so light status-bar TEXT reads against the room's
 * material; light/paper rooms want `default` so DARK status-bar text reads
 * against paper (asking for black-translucent on paper is what was flashing
 * white glyphs against a cream background — the whole bug).
 */
function statusBarStyleForKey(key: SiteIconKey): "black-translucent" | "default" {
  const routed = SITE_ROUTE_BY_KEY[key];
  if (routed?.dark === true) return "black-translucent";
  if (routed?.dark === false) return "default";
  // No route entry (e.g. "home") — infer from the room's visual bg.
  return isBgDark(SITE_ICON_VISUALS[key].bg) ? "black-translucent" : "default";
}

export function siteMetadata(key: SiteIconKey, options: SiteMetadataOptions = {}): Metadata {
  const visual = SITE_ICON_VISUALS[key];
  const title = options.title ?? visual.title;
  const description = options.description ?? visual.description;
  const path = options.path ?? visual.path;
  const image = options.openGraphImage ?? siteIconPath(key, "opengraph");
  const statusBarStyle = statusBarStyleForKey(key);

  return {
    title,
    description,
    manifest: siteIconPath(key, "manifest"),
    // The <meta name="theme-color"> the iOS Safari chrome tints itself with.
    // Set from the room's own visual bg so the Safari chrome matches the room
    // the visitor is looking at — moving through the album no longer flashes
    // the site-wide paper color between rooms. Next 14 still emits this from
    // `metadata` (with a deprecation warning); the alternative was to add a
    // per-route `viewport` export to every layout, which the CHANGE_SUMMARY
    // explicitly forbids.
    themeColor: visual.bg,
    icons: {
      icon: [
        { url: siteIconPath(key, "icon"), sizes: "64x64", type: "image/png" },
      ],
      shortcut: [
        { url: siteIconPath(key, "icon"), sizes: "64x64", type: "image/png" },
      ],
      apple: [
        { url: siteIconPath(key, "apple"), sizes: "180x180", type: "image/png" },
      ],
    },
    appleWebApp: {
      capable: true,
      title: visual.shortName,
      // Per-room, so light rooms don't ship black-translucent (which paints
      // white status-bar text against paper). Derived from `SITE_ROUTES.dark`,
      // falling back to bg luminance for keys with no route entry.
      statusBarStyle,
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: new URL(path, SITE_ORIGIN).toString(),
      title,
      description,
      siteName: "objet d'art",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${title} image`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
