import type { Metadata } from "next";
import {
  SITE_ICON_VISUALS,
  SITE_ORIGIN,
  siteIconPath,
  type SiteIconKey,
} from "@/lib/site-icon-config";

type SiteMetadataOptions = {
  path?: string;
  title?: string;
  description?: string;
  openGraphImage?: string;
  manifest?: string;
};

export function siteMetadata(key: SiteIconKey, options: SiteMetadataOptions = {}): Metadata {
  const visual = SITE_ICON_VISUALS[key];
  const title = options.title ?? visual.title;
  const description = options.description ?? visual.description;
  const path = options.path ?? visual.path;
  const image = options.openGraphImage ?? siteIconPath(key, "opengraph");

  return {
    title,
    description,
    manifest: options.manifest ?? siteIconPath(key, "manifest"),
    icons: {
      icon: [
        { url: siteIconPath(key, "icon"), sizes: "64x64", type: "image/png" },
      ],
      shortcut: [
        { url: siteIconPath(key, "icon"), sizes: "64x64", type: "image/png" },
      ],
      apple: [
        { url: siteIconPath(key, "apple"), sizes: "180x180", type: "image/png" },
      ],
    },
    appleWebApp: {
      capable: true,
      title: visual.shortName,
      statusBarStyle: "black-translucent",
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: new URL(path, SITE_ORIGIN).toString(),
      title,
      description,
      siteName: "objet d'art",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${title} image`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
