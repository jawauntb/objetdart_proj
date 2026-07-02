import { isDarkRoutePath } from "@/lib/routes";

export function isDarkRoute(pathname: string): boolean {
  return isDarkRoutePath(pathname);
}
