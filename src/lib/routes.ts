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
  { key: "atlas",       icon: "atlas",    href: "/atlas/origin",                    desc: "the living map",                 cluster: "field",     dark: true, homePriority: 10 },
  { key: "ocean",       icon: "waves",    href: "/ocean",                             desc: "the deep · dive down",          cluster: "water",     dark: true, homePriority: 7 },
  { key: "tide",        icon: "tide",     href: "/tide",                              desc: "move the moon",                cluster: "water",     dark: true, homePriority: 9 },
  { key: "waves",       icon: "waves",    href: "/waves",                             desc: "ripple tank",                  cluster: "water",     dark: true, homePriority: 8 },
  { key: "sine",        icon: "waves",    href: "/sine",                              desc: "wave explorer",                cluster: "water",     dark: true },
  { key: "pretext",     icon: "waves",    href: "/pretext",                           desc: "playable text",                cluster: "water",     dark: true },
  { key: "circularity", icon: "aphros",   href: "/circularity",                       desc: "circles to waves",             cluster: "water",     dark: true },
  { key: "beyond",      icon: "waves",    href: "/beyond",                            desc: "novel wave field",             cluster: "water",     dark: true, homePriority: 10 },
  { key: "manifold",    icon: "stars",    href: "/manifold",                          desc: "every scale kept in one fold", cluster: "field",     dark: true },
  { key: "overlook",    icon: "growth",   href: "/overlook",                          desc: "the whole tree kept in one glance", cluster: "field", dark: true },
  { key: "relativity",  icon: "stars",    href: "/relativity",                        desc: "light keeps its own covenant", cluster: "mechanism", dark: true },
  { key: "loom",        icon: "signal",   href: "/loom",                              desc: "one structure, every sense",   cluster: "mechanism", dark: true },
  { key: "storm",       icon: "storm",    href: "/storm",                             desc: "pressure · charge · discharge", cluster: "water",     dark: true },
  { key: "clouds",      icon: "clouds",   href: "/clouds",                            desc: "olympus",                      cluster: "water",     dark: true },
  { key: "aphros",      icon: "aphros",   href: "/aphros",                            desc: "play the shells",              cluster: "water" },
  { key: "flowers",     icon: "growth",   href: "/flowers",                           desc: "petals · symmetry",            cluster: "nature",    dark: true },
  { key: "cells",       icon: "aphros",   href: "/cells",                             desc: "the plasm keeps its own tide", cluster: "nature",    dark: true },
  { key: "dna",         icon: "growth",   href: "/dna",                               desc: "the ladder that copies", cluster: "nature", dark: true },
  { key: "organics",    icon: "growth",   href: "/organics",                          desc: "what carbon does when it has time", cluster: "nature", dark: true },
  { key: "molecules",   icon: "growth",   href: "/molecules",                         desc: "what the bond holds, the solvent carries", cluster: "nature", dark: true },
  { key: "atoms",       icon: "plasma",   href: "/atoms",                             desc: "probability breathes around a bright nucleus", cluster: "mechanism", dark: true },
  { key: "nucleons",    icon: "plasma",   href: "/nucleons",                          desc: "the valley makes the elements", cluster: "mechanism", dark: true },
  { key: "quarks",      icon: "plasma",   href: "/quarks",                            desc: "nothing here can be alone", cluster: "mechanism", dark: true },
  { key: "quanta",      icon: "plasma",   href: "/quanta",                            desc: "mass buys only a moment", cluster: "mechanism", dark: true },
  { key: "fire",        icon: "fire",     href: "/fire",                              desc: "the element that breathes",    cluster: "nature",    dark: true },
  { key: "earth",       icon: "earth",    href: "/earth",                             desc: "strata · seismograph · root",  cluster: "nature",    dark: true },
  { key: "growth",      icon: "growth",   href: "/growth",                            desc: "sigmoid · exponential · decay", cluster: "nature",    dark: true },
  { key: "stars",       icon: "stars",    href: "/stars",                             desc: "the night sky",                cluster: "nature",    dark: true, homePriority: 6 },
  { key: "comb",        icon: "stars",    href: "/comb",                              desc: "comb the light · the cowlick stays", cluster: "nature", homePriority: 9 },
  { key: "beam",        icon: "growth",   href: "/beam",                              desc: "the eye of heaven · bokeh petals",   cluster: "nature", homePriority: 10 },
  { key: "signal",      icon: "signal",   href: "/signal",                            desc: "music is also waves",          cluster: "mechanism", dark: true },
  { key: "light",       icon: "plasma",   href: "/light",                             desc: "color music",                  cluster: "mechanism", dark: true },
  { key: "music-color", icon: "plasma",   href: "/light/inverse",                     desc: "notes into color",             cluster: "mechanism", dark: true },
  { key: "timbre",      icon: "signal",   href: "/timbre",                            desc: "one surface, every instrument", cluster: "mechanism", dark: true },
  { key: "instrument",  icon: "signal",   href: "/instrument",                        desc: "every finger a voice",          cluster: "mechanism", dark: true },
  { key: "plasma",      icon: "plasma",   href: "/plasma",                            desc: "plasma globe",                 cluster: "mechanism", dark: true },
  { key: "pulse",       icon: "pulse",    href: "/pulse",                             desc: "heartbeat · pattern",          cluster: "mechanism", dark: true },
  { key: "charts",      icon: "charts",   href: "/charts",                            desc: "lines · candles · oscillators", cluster: "mechanism", dark: true },
  { key: "dither",      icon: "charts",   href: "/dither",                            desc: "ordered dots · signal studies", cluster: "mechanism", dark: true },
  { key: "time",        icon: "watch",    href: "/time",                              desc: "bend a clock",                  cluster: "mechanism", dark: true },
  { key: "movement",    icon: "watch",    href: "/movement",                          desc: "mechanical movement · 3D",     cluster: "mechanism", dark: true, homePriority: 10 },
  { key: "jewel",       icon: "plasma",   href: "/jewel",                             desc: "turn the stone",               cluster: "mechanism", dark: true, homePriority: 8 },
  { key: "drop",        icon: "plasma",   href: "/drop",                              desc: "a cosmos in glass",            cluster: "mechanism", dark: true, homePriority: 11 },
  { key: "coin",        icon: "watch",    href: "/coin",                              desc: "a gold medal · tilt · flip",   cluster: "mechanism", dark: true, homePriority: 10 },
  { key: "watch",       icon: "watch",    href: "/watch",                             desc: "the room",                     cluster: "mechanism", dark: true, homePriority: 9 },
  { key: "archive",     icon: "archive",  href: "/archive",                          desc: "the drawers",                  cluster: "field",     homePriority: 7 },
  { key: "kept",        icon: "kept",     href: "/kept",                              desc: "a private trail",              cluster: "field",     homePriority: 6 },
  { key: "colophon",    icon: "colophon", href: "/colophon",                         desc: "what kept this",               cluster: "field" },
  { key: "guide",       icon: "colophon", href: "/guide",                            desc: "how to hold it",               cluster: "field" },
];

export const PRIMARY_ROUTE_KEYS = ["atlas", "tide", "waves", "watch"] as const;

export const SITE_ROUTE_BY_KEY = Object.fromEntries(
  SITE_ROUTES.map((route) => [route.key, route]),
) as Record<string, SiteRouteEntry>;

const NAVIGATION_ROUTE_KEYS = [
  "atlas",
  "coin",
  "beam",
  "comb",
  "stars",
  "ocean",
  "clouds",
  "waves",
  "movement",
  "drop",
  "sine",
  "circularity",
  "beyond",
  "light",
  "music-color",
  "signal",
  "jewel",
  "aphros",
  "tide",
  "storm",
  "earth",
  "flowers",
  "growth",
  "pretext",
  "dither",
] as const;

const NAVIGATION_ROUTE_KEY_SET = new Set<string>(NAVIGATION_ROUTE_KEYS);

const PREFERRED_NAVIGATION_ROUTES = NAVIGATION_ROUTE_KEYS.map((key) => {
  const route = SITE_ROUTE_BY_KEY[key];
  if (!route) throw new Error(`Unknown navigation route: ${key}`);
  return route;
});

export const NAVIGATION_ROUTES = [
  ...PREFERRED_NAVIGATION_ROUTES,
  ...SITE_ROUTES.filter((route) => !NAVIGATION_ROUTE_KEY_SET.has(route.key)),
];

const GALLERY_OMITTED_ROUTE_KEYS = new Set(["archive", "kept", "colophon", "guide"]);

export const GALLERY_ROUTES = NAVIGATION_ROUTES.filter(
  (route) => !GALLERY_OMITTED_ROUTE_KEYS.has(route.key),
);

export const DARK_ROUTE_PREFIXES = SITE_ROUTES
  .filter((route) => route.dark)
  .map((route) => route.href);

export function isDarkRoutePath(pathname: string): boolean {
  return pathname === "/" ||
    DARK_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
