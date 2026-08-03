import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("organelles");

export default function OrganellesLayout({ children }: { children: ReactNode }) {
  return children;
}
