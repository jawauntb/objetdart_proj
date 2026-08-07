import {
  resolveSplashDevice,
  siteIconKey,
  splashPixelSize,
} from "@/lib/site-icon-config";
import { renderSplashImage } from "@/app/site-icons/_render";

export const runtime = "nodejs";

/**
 * The iOS launch-splash family, mirroring /site-icons/[route]/manifest — one
 * device viewport per URL, rendered on demand from the room's visual palette.
 * The device slug is decoded via `resolveSplashDevice`; an unknown slug 404s
 * so Safari falls back to the default white flash instead of a wrong bg.
 */
export function GET(
  _: Request,
  { params }: { params: { route?: string; device?: string } },
) {
  const key = siteIconKey(params.route);
  const device = resolveSplashDevice(params.device);
  if (!device) {
    return new Response("Unknown splash device", { status: 404 });
  }
  const { width, height } = splashPixelSize(device);
  return renderSplashImage(key, width, height);
}
