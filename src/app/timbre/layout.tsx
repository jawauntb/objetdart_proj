import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("signal", {
  title: "Timbre",
  description: "one surface, every instrument",
  path: "/timbre",
});

export default function TimbreLayout({ children }: { children: ReactNode }) {
  return children;
}
