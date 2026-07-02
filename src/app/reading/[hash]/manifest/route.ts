import { siteIconManifest } from "@/lib/site-icon-config";

export const runtime = "nodejs";

export function GET(_: Request, { params }: { params: { hash: string } }) {
  return Response.json(
    siteIconManifest("reading", `/reading/${params.hash}`),
    {
      headers: {
        "Content-Type": "application/manifest+json",
      },
    },
  );
}
