import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("movement");

export default function MovementLayout({ children }: { children: ReactNode }) {
  return children;
}
