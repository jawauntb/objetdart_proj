import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("dither");

export default function DitherLayout({ children }: { children: ReactNode }) {
  return children;
}
