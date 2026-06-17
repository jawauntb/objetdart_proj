import { ARCHIVE } from "@/data/content";
import type { ArchiveEntry } from "@/lib/types";

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function entrySlug(a: ArchiveEntry): string {
  return slugify(a.title);
}

export function findBySlug(slug: string): ArchiveEntry | undefined {
  return ARCHIVE.find((a) => entrySlug(a) === slug);
}

export function neighbourSlug(slug: string, dir: 1 | -1): string | null {
  const idx = ARCHIVE.findIndex((a) => entrySlug(a) === slug);
  if (idx < 0) return null;
  const next = ARCHIVE[(idx + dir + ARCHIVE.length) % ARCHIVE.length];
  return entrySlug(next);
}
