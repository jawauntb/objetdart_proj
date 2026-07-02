"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pageview, trackEvent } from "@/lib/analytics";

const CLICK_SELECTOR = [
  "a",
  "button",
  "summary",
  "input",
  "select",
  "textarea",
  "canvas",
  "svg[role='img']",
  "[role='button']",
  "[data-analytics]",
  "[data-touch-surface]",
].join(", ");

function compactText(value: string | null | undefined, fallback: string) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 120);
}

function linkPath(el: HTMLElement) {
  if (!(el instanceof HTMLAnchorElement) || !el.href || typeof window === "undefined") return undefined;
  try {
    const url = new URL(el.href);
    if (url.protocol === "mailto:" || url.protocol === "tel:") return url.protocol.slice(0, -1);
    if (url.origin === window.location.origin) return compactText(`${url.pathname}${url.search}`, "/");
    return compactText(`${url.origin}${url.pathname}`, url.origin);
  } catch {
    return compactText(el.getAttribute("href"), "link");
  }
}

// Mounted once when GA is configured. It owns first-load and client-navigation
// page views, plus one delegated click listener for interactive surfaces.
export default function AnalyticsListener({ gaId }: { gaId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pagePath = useMemo(() => {
    const path = pathname || "/";
    const query = searchParams.toString();
    return query ? `${path}?${query}` : path;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (gaId) pageview(pagePath);
  }, [gaId, pagePath]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>(CLICK_SELECTOR);
      if (!el) return;

      const tag = el.tagName.toLowerCase();
      const analyticsId =
        el.getAttribute("data-analytics") ||
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.id ||
        (el.hasAttribute("data-touch-surface") ? undefined : el.textContent) ||
        tag;

      const params: Record<string, unknown> = {
        click_label: compactText(analyticsId, tag),
        element_tag: tag,
        page_path: pagePath,
      };

      const role = el.getAttribute("role");
      const explicit = el.getAttribute("data-analytics");
      const href = linkPath(el);
      if (role) params.element_role = role;
      if (explicit) params.analytics_id = compactText(explicit, tag);
      if (href) params.link_url = href;

      trackEvent("site_click", params);
    }

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [pagePath]);

  return null;
}
