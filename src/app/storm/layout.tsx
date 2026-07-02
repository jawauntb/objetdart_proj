import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("storm");

export default function StormLayout({ children }: { children: ReactNode }) {
  return children;
}
