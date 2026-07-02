import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rootUrl = new URL("../", import.meta.url);

function readRepoFile(path) {
  return readFileSync(new URL(path, rootUrl), "utf8");
}

const googleAnalytics = readRepoFile("src/components/GoogleAnalytics.tsx");
const listener = readRepoFile("src/components/AnalyticsListener.tsx");
const analytics = readRepoFile("src/lib/analytics.ts");
const layout = readRepoFile("src/app/layout.tsx");
const readme = readRepoFile("README.md");
const colophon = readRepoFile("src/components/Colophon.tsx");

assert.match(googleAnalytics, /NEXT_PUBLIC_GA_MEASUREMENT_ID/, "preferred GA measurement env var should be supported");
assert.match(googleAnalytics, /NEXT_PUBLIC_GA_ID/, "legacy GA env var should remain supported");
assert.match(googleAnalytics, /send_page_view:\s*false/, "gtag config should not double-count the initial page view");
assert.match(googleAnalytics, /<Suspense fallback=\{null\}>/, "listener should be wrapped for useSearchParams");
assert.match(googleAnalytics, /<AnalyticsListener gaId=\{gaId\}/, "GoogleAnalytics should mount the listener");

assert.match(layout, /<GoogleAnalytics \/>/, "root layout should render GoogleAnalytics");

assert.match(listener, /useSearchParams/, "page views should include query-string navigations");
assert.match(listener, /site_click/, "delegated clicks should use the site_click GA event");
assert.match(listener, /\[data-analytics\]/, "click labels should support explicit data-analytics overrides");
assert.match(listener, /\[data-touch-surface\]/, "playable surfaces should be click tracked");
assert.match(listener, /canvas/, "canvas scenes should be eligible for click tracking");
assert.match(listener, /click_label/, "click events should use GA-friendly snake_case params");
assert.doesNotMatch(listener, /\.value|getAttribute\("value"\)/, "click tracking should not collect form values");

assert.match(analytics, /"page_view"/, "pageview helper should send GA4 page_view events");
assert.match(analytics, /page_location/, "pageview helper should include page_location");
assert.match(analytics, /window\.gtag\("event"/, "events should go through gtag event calls");

assert.match(readme, /NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX/, "README should document the preferred GA env var");
assert.match(readme, /site_click/, "README should document click tracking event name");
assert.doesNotMatch(colophon, /no analytics, no tracking/i, "colophon should not promise zero analytics");

console.log("analytics wiring ok");
