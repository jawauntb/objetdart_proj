import Script from "next/script";
import { Suspense } from "react";
import AnalyticsListener from "@/components/AnalyticsListener";

function measurementId() {
  const id = (
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ||
    process.env.NEXT_PUBLIC_GA_ID ||
    ""
  ).trim();

  return /^G-[A-Z0-9]+$/i.test(id) ? id : "";
}

// Google Analytics 4. Renders nothing unless a Measurement ID is set, so dev
// and un-wired deploys stay clean. NEXT_PUBLIC_GA_MEASUREMENT_ID is preferred;
// NEXT_PUBLIC_GA_ID remains supported for older Railway envs.
export default function GoogleAnalytics() {
  const gaId = measurementId();
  if (!gaId) return null;

  const gaIdJson = JSON.stringify(gaId);

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', ${gaIdJson}, { send_page_view: false });
        `}
      </Script>
      <Suspense fallback={null}>
        <AnalyticsListener gaId={gaId} />
      </Suspense>
    </>
  );
}
