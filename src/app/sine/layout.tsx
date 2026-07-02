import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("sine");

export default function SineLayout({ children }: { children: ReactNode }) {
  return children;
}
