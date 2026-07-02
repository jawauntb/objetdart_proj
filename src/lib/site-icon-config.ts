export const SITE_ORIGIN = "https://objetdart-production.up.railway.app";

export type SiteIconKey =
  | "home"
  | "aphros"
  | "archive"
  | "atlas"
  | "beyond"
  | "charts"
  | "circularity"
  | "clouds"
  | "coin"
  | "colophon"
  | "compare"
  | "earth"
  | "fire"
  | "flowers"
  | "growth"
  | "jewel"
  | "kept"
  | "light"
  | "movement"
  | "ocean"
  | "plasma"
  | "pretext"
  | "pulse"
  | "reading"
  | "signal"
  | "sine"
  | "stars"
  | "storm"
  | "tide"
  | "time"
  | "watch"
  | "waves";

export type SiteIconKind =
  | "aphros"
  | "archive"
  | "atlas"
  | "beyond"
  | "charts"
  | "circularity"
  | "clouds"
  | "coin"
  | "colophon"
  | "compare"
  | "earth"
  | "fire"
  | "flowers"
  | "growth"
  | "home"
  | "jewel"
  | "kept"
  | "light"
  | "movement"
  | "ocean"
  | "plasma"
  | "pretext"
  | "pulse"
  | "reading"
  | "signal"
  | "sine"
  | "stars"
  | "storm"
  | "tide"
  | "time"
  | "watch"
  | "waves";

export type SiteIconVisual = {
  title: string;
  description: string;
  path: string;
  shortName: string;
  kind: SiteIconKind;
  bg: string;
  bg2: string;
  glow: string;
  accent: string;
  accent2: string;
  ink: string;
};

export const SITE_ICON_VISUALS = {
  home: {
    title: "objet d'art",
    description: "a gold medal you can hold",
    path: "/",
    shortName: "objet d'art",
    kind: "home",
    bg: "#08111c",
    bg2: "#211708",
    glow: "#e7b94e",
    accent: "#f3d37a",
    accent2: "#4fb7c8",
    ink: "#fff4cf",
  },
  aphros: {
    title: "Aphros",
    description: "foam, shells, and love",
    path: "/aphros",
    shortName: "aphros",
    kind: "aphros",
    bg: "#fbf4e7",
    bg2: "#1e5961",
    glow: "#e6b7a1",
    accent: "#f4d6c7",
    accent2: "#157983",
    ink: "#24383d",
  },
  archive: {
    title: "Archive",
    description: "the drawers of kept things",
    path: "/archive",
    shortName: "archive",
    kind: "archive",
    bg: "#17110b",
    bg2: "#4a2b16",
    glow: "#d7a45a",
    accent: "#e8c687",
    accent2: "#7c5031",
    ink: "#fff0cf",
  },
  atlas: {
    title: "Atlas",
    description: "the territories and their bearings",
    path: "/atlas/origin",
    shortName: "atlas",
    kind: "atlas",
    bg: "#102029",
    bg2: "#39462d",
    glow: "#b8c784",
    accent: "#d9d397",
    accent2: "#66a6a8",
    ink: "#edf1d0",
  },
  beyond: {
    title: "Beyond",
    description: "a novel wave field",
    path: "/beyond",
    shortName: "beyond",
    kind: "beyond",
    bg: "#080b20",
    bg2: "#2b1145",
    glow: "#8fe0e8",
    accent: "#91dfe7",
    accent2: "#e0a2ff",
    ink: "#e8f7ff",
  },
  charts: {
    title: "Charts",
    description: "lines, candles, and oscillators",
    path: "/charts",
    shortName: "charts",
    kind: "charts",
    bg: "#071018",
    bg2: "#17221a",
    glow: "#71d6a6",
    accent: "#90e7b7",
    accent2: "#e7bc63",
    ink: "#ddffe8",
  },
  circularity: {
    title: "Circularity",
    description: "circles becoming waves",
    path: "/circularity",
    shortName: "circle",
    kind: "circularity",
    bg: "#0a1120",
    bg2: "#263d55",
    glow: "#a8d7ff",
    accent: "#d0e5ff",
    accent2: "#d2ba6a",
    ink: "#edf7ff",
  },
  clouds: {
    title: "Clouds",
    description: "olympus and the air floor",
    path: "/clouds",
    shortName: "clouds",
    kind: "clouds",
    bg: "#182236",
    bg2: "#7b8aa3",
    glow: "#e7edf6",
    accent: "#f5f7fb",
    accent2: "#b7c6de",
    ink: "#f7fbff",
  },
  coin: {
    title: "Coin",
    description: "a gold medal you tilt, flip, and rub",
    path: "/coin",
    shortName: "coin",
    kind: "coin",
    bg: "#06080d",
    bg2: "#1b1305",
    glow: "#e8bd55",
    accent: "#f8d879",
    accent2: "#3d7ba7",
    ink: "#fff2bf",
  },
  colophon: {
    title: "Colophon",
    description: "what kept this",
    path: "/colophon",
    shortName: "colophon",
    kind: "colophon",
    bg: "#f1eadc",
    bg2: "#2d261e",
    glow: "#c28f4b",
    accent: "#2f2a21",
    accent2: "#c38f49",
    ink: "#201b14",
  },
  compare: {
    title: "Compare",
    description: "two readings held to the light",
    path: "/compare",
    shortName: "compare",
    kind: "compare",
    bg: "#101018",
    bg2: "#36244a",
    glow: "#d9b2ff",
    accent: "#f0cc76",
    accent2: "#8ed6dd",
    ink: "#fff3d6",
  },
  earth: {
    title: "Earth",
    description: "strata, seismograph, and root",
    path: "/earth",
    shortName: "earth",
    kind: "earth",
    bg: "#10110c",
    bg2: "#3d3525",
    glow: "#b8986e",
    accent: "#d8bf8c",
    accent2: "#6fa575",
    ink: "#f4e9c8",
  },
  fire: {
    title: "Fire",
    description: "the element that breathes",
    path: "/fire",
    shortName: "fire",
    kind: "fire",
    bg: "#100704",
    bg2: "#3b1208",
    glow: "#ff9c42",
    accent: "#ffd36d",
    accent2: "#d0472b",
    ink: "#fff0bd",
  },
  flowers: {
    title: "Flowers",
    description: "petals and symmetry",
    path: "/flowers",
    shortName: "flowers",
    kind: "flowers",
    bg: "#120f18",
    bg2: "#2c3b25",
    glow: "#e9a9c8",
    accent: "#ffcadc",
    accent2: "#9bd58b",
    ink: "#fff1f7",
  },
  growth: {
    title: "Growth",
    description: "sigmoid, exponential, and decay",
    path: "/growth",
    shortName: "growth",
    kind: "growth",
    bg: "#0b150e",
    bg2: "#243a1f",
    glow: "#94d171",
    accent: "#c7eb98",
    accent2: "#e2bc6f",
    ink: "#efffdb",
  },
  jewel: {
    title: "Jewel",
    description: "gold and diamond sound shader",
    path: "/jewel",
    shortName: "jewel",
    kind: "jewel",
    bg: "#06080d",
    bg2: "#16233b",
    glow: "#dbe8ff",
    accent: "#f9eaa2",
    accent2: "#75d6ff",
    ink: "#ffffff",
  },
  kept: {
    title: "Kept",
    description: "a private trail of readings",
    path: "/kept",
    shortName: "kept",
    kind: "kept",
    bg: "#11141b",
    bg2: "#2d2433",
    glow: "#c7a7ff",
    accent: "#d8c4ff",
    accent2: "#e1b76a",
    ink: "#f5edff",
  },
  light: {
    title: "Light",
    description: "color music",
    path: "/light",
    shortName: "light",
    kind: "light",
    bg: "#060b18",
    bg2: "#17244c",
    glow: "#ffe780",
    accent: "#fff1a0",
    accent2: "#70d6ff",
    ink: "#fffce7",
  },
  movement: {
    title: "Movement",
    description: "a mechanical watch in three dimensions",
    path: "/movement",
    shortName: "movement",
    kind: "movement",
    bg: "#090c11",
    bg2: "#282018",
    glow: "#e0b66a",
    accent: "#f1cf84",
    accent2: "#7ba6b8",
    ink: "#fff0ca",
  },
  ocean: {
    title: "Ocean",
    description: "open water and rivers",
    path: "/ocean",
    shortName: "ocean",
    kind: "ocean",
    bg: "#06111d",
    bg2: "#07324a",
    glow: "#59c7d7",
    accent: "#8ee4ed",
    accent2: "#d5ba73",
    ink: "#e0fbff",
  },
  plasma: {
    title: "Plasma",
    description: "light as wave and particle",
    path: "/plasma",
    shortName: "plasma",
    kind: "plasma",
    bg: "#080710",
    bg2: "#24194a",
    glow: "#ca7dff",
    accent: "#e0a4ff",
    accent2: "#67f0cf",
    ink: "#fbebff",
  },
  pretext: {
    title: "Pretext",
    description: "playable text",
    path: "/pretext",
    shortName: "pretext",
    kind: "pretext",
    bg: "#0b1018",
    bg2: "#273041",
    glow: "#cbd6e7",
    accent: "#e7eef8",
    accent2: "#c9a45a",
    ink: "#f8fbff",
  },
  pulse: {
    title: "Pulse",
    description: "heartbeat and pattern",
    path: "/pulse",
    shortName: "pulse",
    kind: "pulse",
    bg: "#040d0c",
    bg2: "#0f2c24",
    glow: "#62efb3",
    accent: "#83ffc8",
    accent2: "#f0c665",
    ink: "#dcffec",
  },
  reading: {
    title: "Reading",
    description: "a reading kept on objet d'art",
    path: "/reading",
    shortName: "reading",
    kind: "reading",
    bg: "#f2eee6",
    bg2: "#1b2f3d",
    glow: "#c8732a",
    accent: "#c8732a",
    accent2: "#2c4a5c",
    ink: "#15171a",
  },
  signal: {
    title: "Signal",
    description: "music is also waves",
    path: "/signal",
    shortName: "signal",
    kind: "signal",
    bg: "#06101c",
    bg2: "#111f3b",
    glow: "#6de1ff",
    accent: "#8decff",
    accent2: "#e7b85f",
    ink: "#e9fbff",
  },
  sine: {
    title: "Sine",
    description: "a wave explorer",
    path: "/sine",
    shortName: "sine",
    kind: "sine",
    bg: "#08111c",
    bg2: "#19334b",
    glow: "#8dd9ff",
    accent: "#b4e8ff",
    accent2: "#d5bd7b",
    ink: "#eff9ff",
  },
  stars: {
    title: "Stars",
    description: "the night sky",
    path: "/stars",
    shortName: "stars",
    kind: "stars",
    bg: "#040913",
    bg2: "#102142",
    glow: "#9db8ff",
    accent: "#d2ddff",
    accent2: "#e7c56a",
    ink: "#eef3ff",
  },
  storm: {
    title: "Storm",
    description: "the wave allowed to rage",
    path: "/storm",
    shortName: "storm",
    kind: "storm",
    bg: "#070b12",
    bg2: "#1a2632",
    glow: "#a9c8d8",
    accent: "#d6e6ee",
    accent2: "#f4c763",
    ink: "#ecf8ff",
  },
  tide: {
    title: "Tide",
    description: "night sea",
    path: "/tide",
    shortName: "tide",
    kind: "tide",
    bg: "#050b14",
    bg2: "#0b2743",
    glow: "#4db5d2",
    accent: "#9ee3ef",
    accent2: "#dcb96e",
    ink: "#e5fbff",
  },
  time: {
    title: "Time",
    description: "chronograph",
    path: "/time",
    shortName: "time",
    kind: "time",
    bg: "#080d12",
    bg2: "#25251a",
    glow: "#d3b56e",
    accent: "#ead28a",
    accent2: "#84a9b8",
    ink: "#fff2c7",
  },
  watch: {
    title: "Watch",
    description: "the room",
    path: "/watch",
    shortName: "watch",
    kind: "watch",
    bg: "#070b0d",
    bg2: "#221e18",
    glow: "#dcb361",
    accent: "#edcc82",
    accent2: "#8fb3bc",
    ink: "#fff0c8",
  },
  waves: {
    title: "Waves",
    description: "the poem",
    path: "/waves",
    shortName: "waves",
    kind: "waves",
    bg: "#07101b",
    bg2: "#143046",
    glow: "#62c9de",
    accent: "#a5e7f0",
    accent2: "#dbbd72",
    ink: "#e5fbff",
  },
} as const satisfies Record<SiteIconKey, SiteIconVisual>;

export function siteIconKey(value: string | undefined): SiteIconKey {
  if (value && Object.prototype.hasOwnProperty.call(SITE_ICON_VISUALS, value)) {
    return value as SiteIconKey;
  }
  return "home";
}

export function siteIconPath(key: SiteIconKey, asset: "icon" | "apple" | "opengraph" | "manifest"): string {
  return `/site-icons/${key}/${asset}`;
}

export function siteAppIconPath(key: SiteIconKey, size: 192 | 512): string {
  return `/site-icons/${key}/app/${size}`;
}

export function siteIconManifest(key: SiteIconKey, startUrl: string = SITE_ICON_VISUALS[key].path) {
  const visual = SITE_ICON_VISUALS[key];

  return {
    name: visual.title,
    short_name: visual.shortName,
    description: visual.description,
    start_url: startUrl,
    display: "standalone",
    background_color: visual.bg,
    theme_color: visual.bg,
    icons: [
      { src: siteIconPath(key, "icon"), sizes: "64x64", type: "image/png" },
      { src: siteIconPath(key, "apple"), sizes: "180x180", type: "image/png" },
      { src: siteAppIconPath(key, 192), sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: siteAppIconPath(key, 512), sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
}
