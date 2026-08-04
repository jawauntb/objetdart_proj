import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("cabinet");

export default function CabinetLayout({ children }: { children: ReactNode }) {
  return children;
}
