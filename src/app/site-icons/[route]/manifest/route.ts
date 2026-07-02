import {
  SITE_ICON_VISUALS,
  siteAppIconPath,
  siteIconKey,
  siteIconPath,
} from "@/lib/site-icon-config";

export const runtime = "nodejs";

export function GET(_: Request, { params }: { params: { route?: string } }) {
  const key = siteIconKey(params.route);
  const visual = SITE_ICON_VISUALS[key];

  return Response.json(
    {
      name: visual.title,
      short_name: visual.shortName,
      description: visual.description,
      start_url: visual.path,
      display: "standalone",
      background_color: visual.bg,
      theme_color: visual.bg,
      icons: [
        { src: siteIconPath(key, "icon"), sizes: "64x64", type: "image/png" },
        { src: siteIconPath(key, "apple"), sizes: "180x180", type: "image/png" },
        { src: siteAppIconPath(key, 192), sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: siteAppIconPath(key, 512), sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
      },
    },
  );
}
