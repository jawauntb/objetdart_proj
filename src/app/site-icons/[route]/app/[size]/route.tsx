import { siteIconKey } from "@/lib/site-icon-config";
import { renderIconImage } from "@/app/site-icons/_render";

export const runtime = "nodejs";

export function GET(_: Request, { params }: { params: { route?: string; size?: string } }) {
  const requested = Number(params.size);
  const size = requested === 512 ? 512 : 192;
  return renderIconImage(siteIconKey(params.route), size);
}
