import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("city");

export default function CityLayout({ children }: { children: ReactNode }) {
  return children;
}
