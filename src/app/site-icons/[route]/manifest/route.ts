import {
  siteIconManifest,
  siteIconKey,
} from "@/lib/site-icon-config";

export const runtime = "nodejs";

export function GET(_: Request, { params }: { params: { route?: string } }) {
  const key = siteIconKey(params.route);

  return Response.json(
    siteIconManifest(key),
    {
      headers: {
        "Content-Type": "application/manifest+json",
      },
    },
  );
}
