// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key. Deterministic — no LLM slot.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("pebble");

export default function PebbleLayout({ children }: { children: ReactNode }) {
  return children;
}
