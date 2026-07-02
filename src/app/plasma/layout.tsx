import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("plasma");

export default function PlasmaLayout({ children }: { children: ReactNode }) {
  return children;
}
