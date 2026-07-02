import { siteIconKey } from "@/lib/site-icon-config";
import { renderIconImage } from "@/app/site-icons/_render";

export const runtime = "nodejs";

export function GET(_: Request, { params }: { params: { route?: string } }) {
  return renderIconImage(siteIconKey(params.route), 180);
}
