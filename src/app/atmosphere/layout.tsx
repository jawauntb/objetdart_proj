import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("atmosphere");

export default function AtmosphereLayout({ children }: { children: ReactNode }) {
  return children;
}
