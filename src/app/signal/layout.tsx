import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("signal");

export default function SignalLayout({ children }: { children: ReactNode }) {
  return children;
}
