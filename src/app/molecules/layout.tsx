import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("molecules");

export default function MoleculesLayout({ children }: { children: ReactNode }) {
  return children;
}
