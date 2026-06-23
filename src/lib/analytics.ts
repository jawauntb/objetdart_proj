// Thin wrapper over gtag. Every call no-ops safely when GA isn't loaded
// (no NEXT_PUBLIC_GA_ID, or running server-side), so callers never need to guard.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

// Send a page_view for client-side (App Router) navigations. The initial load
// is already counted by the gtag('config') call in the injected script.
export function pageview(gaId: string, path: string) {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("config", gaId, { page_path: path });
}

export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params);
}

export {};
