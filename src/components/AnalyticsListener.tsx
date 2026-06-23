"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pageview, trackEvent } from "@/lib/analytics";

// Mounted once (only when GA is configured). Handles the two things gtag's
// default config doesn't: page views across client-side route changes, and a
// single delegated listener that turns every click on an interactive element
// into a GA event — no per-component wiring across the scenes.
export default function AnalyticsListener({ gaId }: { gaId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) pageview(gaId, pathname);
  }, [gaId, pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>(
        'a, button, [role="button"], [data-analytics]',
      );
      if (!el) return;

      // Prefer an explicit data-analytics label, then aria-label, then the
      // element's own text, falling back to the tag name. Capped so long copy
      // doesn't bloat the event.
      const label =
        el.getAttribute("data-analytics") ||
        el.getAttribute("aria-label") ||
        el.textContent?.trim().slice(0, 80) ||
        el.tagName.toLowerCase();

      const params: Record<string, unknown> = { label, page_path: pathname };
      if (el instanceof HTMLAnchorElement && el.href) params.link_url = el.href;

      trackEvent("click", params);
    }

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [pathname]);

  return null;
}
