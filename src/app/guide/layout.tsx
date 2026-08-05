import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

// Guide styles are pulled in at the layout boundary (a Server Component) so
// they arrive as a proper CSS file rather than as an inline <style> tag in
// the client bundle. See src/app/guide/guide.css.
import "./guide.css";

export const metadata: Metadata = siteMetadata("guide");

export default function GuideLayout({ children }: { children: ReactNode }) {
  return children;
}
