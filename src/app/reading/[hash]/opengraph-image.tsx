import { renderOpenGraphImage } from "@/app/site-icons/_render";
import { decodeReadingHash } from "@/lib/reading";
import type { ConcernKey } from "@/lib/types";

export const runtime = "nodejs";
export const alt = "a reading kept on objet d'art";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const RADIAL_ORDER: ConcernKey[] = [
  "prayer", "future", "work", "risk", "body", "love", "memory", "friendship",
];

export default function Image({ params }: { params: { hash: string } }) {
  const input = decodeReadingHash(params.hash);
  const concerns = input?.concerns ?? Object.fromEntries(
    RADIAL_ORDER.map((k) => [k, 50]),
  ) as Record<ConcernKey, number>;

  const points = RADIAL_ORDER.map((k, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / RADIAL_ORDER.length;
    const r = 10 + ((concerns[k] ?? 50) / 100) * 37;
    return {
      x: Number((60 + Math.cos(a) * r).toFixed(1)),
      y: Number((60 + Math.sin(a) * r).toFixed(1)),
    };
  });

  return renderOpenGraphImage("reading", points);
}
