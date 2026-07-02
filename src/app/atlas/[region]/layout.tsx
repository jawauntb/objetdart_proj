import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export function generateMetadata({ params }: { params: { region: string } }): Metadata {
  return siteMetadata("atlas", { path: `/atlas/${params.region}` });
}

export default function AtlasRegionLayout({ children }: { children: ReactNode }) {
  return children;
}
