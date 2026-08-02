import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("signal", {
  title: "Instrument",
  description: "every finger a voice, every voice any instrument",
  path: "/instrument",
});

export default function InstrumentLayout({ children }: { children: ReactNode }) {
  return children;
}
