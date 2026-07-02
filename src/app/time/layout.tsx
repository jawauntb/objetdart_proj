import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("time");

export default function TimeLayout({ children }: { children: ReactNode }) {
  return children;
}
