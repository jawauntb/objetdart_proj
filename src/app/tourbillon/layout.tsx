import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("tourbillon");

export default function TourbillonLayout({ children }: { children: ReactNode }) {
  return children;
}
