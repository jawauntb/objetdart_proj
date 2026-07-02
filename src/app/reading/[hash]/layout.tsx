import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export function generateMetadata({ params }: { params: { hash: string } }): Metadata {
  return siteMetadata("reading", {
    path: `/reading/${params.hash}`,
    openGraphImage: `/reading/${params.hash}/opengraph-image`,
  });
}

export default function ReadingLayout({ children }: { children: ReactNode }) {
  return children;
}
