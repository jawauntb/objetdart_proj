import type { RouteSigilKind } from "@/components/RouteSigil";

export type SiteRouteCluster = "field" | "water" | "nature" | "mechanism";

export type SiteRouteEntry = {
  key: string;
  icon: RouteSigilKind;
  href: string;
  /** Anchor id on the home page; if set, home links scroll instead of navigating. */
  anchor?: string;
  desc: string;
  cluster: SiteRouteCluster;
  dark?: boolean;
  homePriority?: number;
};

export const SITE_ROUTES: SiteRouteEntry[] = [
  { key: "atlas",       icon: "atlas",    href: "/atlas/origin", anchor: "atlas",    desc: "the territories",                cluster: "field",     homePriority: 10 },
  { key: "ocean",       icon: "waves",    href: "/ocean",                             desc: "open water · rivers",           cluster: "water",     dark: true, homePriority: 7 },
  { key: "tide",        icon: "tide",     href: "/tide",                              desc: "night sea",                    cluster: "water",     dark: true, homePriority: 9 },
  { key: "waves",       icon: "waves",    href: "/waves",                             desc: "the poem",                     cluster: "water",     dark: true, homePriority: 8 },
  { key: "sine",        icon: "waves",    href: "/sine",                              desc: "wave explorer",                cluster: "water",     dark: true },
  { key: "pretext",     icon: "waves",    href: "/pretext",                           desc: "playable text",                cluster: "water",     dark: true },
  { key: "circularity", icon: "aphros",   href: "/circularity",                       desc: "circles to waves",             cluster: "water",     dark: true },
  { key: "beyond",      icon: "waves",    href: "/beyond",                            desc: "novel wave field",             cluster: "water",     dark: true, homePriority: 10 },
  { key: "storm",       icon: "storm",    href: "/storm",                             desc: "the wave allowed to rage",     cluster: "water",     dark: true },
  { key: "clouds",      icon: "clouds",   href: "/clouds",                            desc: "olympus",                      cluster: "water",     dark: true },
  { key: "aphros",      icon: "aphros",   href: "/aphros",                            desc: "foam · shells · love",         cluster: "water" },
  { key: "flowers",     icon: "growth",   href: "/flowers",                           desc: "petals · symmetry",            cluster: "nature",    dark: true },
  { key: "fire",        icon: "fire",     href: "/fire",                              desc: "the element that breathes",    cluster: "nature",    dark: true },
  { key: "earth",       icon: "earth",    href: "/earth",                             desc: "strata · seismograph · root",  cluster: "nature",    dark: true },
  { key: "growth",      icon: "growth",   href: "/growth",                            desc: "sigmoid · exponential · decay", cluster: "nature",    dark: true },
  { key: "stars",       icon: "stars",    href: "/stars",                             desc: "the night sky",                cluster: "nature",    dark: true, homePriority: 6 },
  { key: "signal",      icon: "signal",   href: "/signal",                            desc: "music is also waves",          cluster: "mechanism", dark: true },
  { key: "light",       icon: "plasma",   href: "/light",                             desc: "color music",                  cluster: "mechanism", dark: true },
  { key: "plasma",      icon: "plasma",   href: "/plasma",                            desc: "light · wave + particle",      cluster: "mechanism", dark: true },
  { key: "pulse",       icon: "pulse",    href: "/pulse",                             desc: "heartbeat · pattern",          cluster: "mechanism", dark: true },
  { key: "charts",      icon: "charts",   href: "/charts",                            desc: "lines · candles · oscillators", cluster: "mechanism", dark: true },
  { key: "time",        icon: "watch",    href: "/time",                              desc: "chronograph",                  cluster: "mechanism", dark: true },
  { key: "movement",    icon: "watch",    href: "/movement",                          desc: "mechanical movement · 3D",     cluster: "mechanism", dark: true, homePriority: 10 },
  { key: "jewel",       icon: "plasma",   href: "/jewel",                             desc: "gold & diamond · sound shader", cluster: "mechanism", dark: true, homePriority: 8 },
  { key: "coin",        icon: "watch",    href: "/coin",                              desc: "a gold medal · tilt · flip",   cluster: "mechanism", dark: true, homePriority: 10 },
  { key: "watch",       icon: "watch",    href: "/watch",                             desc: "the room",                     cluster: "mechanism", dark: true, homePriority: 9 },
  { key: "archive",     icon: "archive",  href: "/archive",      anchor: "archive",   desc: "the drawers",                  cluster: "field",     homePriority: 7 },
  { key: "kept",        icon: "kept",     href: "/kept",                              desc: "a private trail",              cluster: "field",     homePriority: 6 },
  { key: "colophon",    icon: "colophon", href: "/colophon",     anchor: "colophon",  desc: "what kept this",               cluster: "field" },
];

export const PRIMARY_ROUTE_KEYS = ["atlas", "tide", "waves", "watch"] as const;

export const SITE_ROUTE_BY_KEY = Object.fromEntries(
  SITE_ROUTES.map((route) => [route.key, route]),
) as Record<string, SiteRouteEntry>;

export const DARK_ROUTE_PREFIXES = SITE_ROUTES
  .filter((route) => route.dark)
  .map((route) => route.href);

export function isDarkRoutePath(pathname: string): boolean {
  return DARK_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
