import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  return siteMetadata("archive", { path: `/archive/${params.slug}` });
}

export default function ArchiveEntryLayout({ children }: { children: ReactNode }) {
  return children;
}
