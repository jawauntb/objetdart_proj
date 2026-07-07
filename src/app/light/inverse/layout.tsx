import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("light", {
  title: "Music Colors",
  description: "music notes translated into visible color",
  path: "/light/inverse",
});

export default function LightInverseLayout({ children }: { children: ReactNode }) {
  return children;
}
