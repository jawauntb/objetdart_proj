export type ConcernKey =
  | "memory" | "work" | "love" | "prayer"
  | "risk" | "future" | "body" | "friendship";

export type Affordance = "inspect" | "hold" | "drag" | "combine" | "route";

export type LensKey = "ritual" | "systems" | "body" | "archive" | "horizon";

export type PhaseKey =
  | "seed" | "ascent" | "crash" | "love"
  | "prayer" | "return" | "horizon";

export type ModeKey = "window" | "table" | "console" | "atlas" | "archive" | "command";

export interface SymbolObject {
  id: string;
  label: string;
  glyph: string;
  x: number; // 0..1 relative position in the room
  y: number;
  means: string[];
  inscription: string;
  fn: string; // plain function line — orientation, not lore
  concerns: ConcernKey[];
  affordances: Affordance[];
  regions: string[]; // compatible region ids for drag/combine
}

export interface Concern {
  id: ConcernKey;
  label: string;
  inscription: string;
}

export interface MapRegion {
  id: string;
  label: string;
  x: number; // 0..1 on the atlas canvas
  y: number;
  inscription: string;
  concerns: ConcernKey[];
}

export interface ArchiveEntry {
  id: string;
  title: string;
  medium: string;
  phase: PhaseKey;
  concerns: ConcernKey[];
  fn: string; // one-line function
  region: string;
  year?: string;
  status?: "open" | "kept" | "closed";
  objects?: string[]; // related object ids
  note?: string;      // longer hidden note
  link?: string;
}

export interface FieldTrace {
  id: string;
  timestamp: string;
  concerns: Record<ConcernKey, number>;
  objects: string[];
  region: string;
  archiveId: string;
  inscription: string;
  route?: { from: string; to: string };
}
