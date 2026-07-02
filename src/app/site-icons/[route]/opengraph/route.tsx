import { siteIconKey } from "@/lib/site-icon-config";
import { renderOpenGraphImage } from "@/app/site-icons/_render";

export const runtime = "nodejs";

export function GET(_: Request, { params }: { params: { route?: string } }) {
  return renderOpenGraphImage(siteIconKey(params.route));
}
