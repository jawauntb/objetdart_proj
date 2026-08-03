import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("planets");

export default function PlanetsLayout({ children }: { children: ReactNode }) {
  return children;
}
