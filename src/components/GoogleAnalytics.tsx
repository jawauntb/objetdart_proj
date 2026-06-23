import Script from "next/script";
import AnalyticsListener from "@/components/AnalyticsListener";

// Google Analytics 4. Renders nothing unless NEXT_PUBLIC_GA_ID is set, so the
// instrument stays clean (and untracked) in dev and in any deploy that hasn't
// been wired up. Set NEXT_PUBLIC_GA_ID to your Measurement ID (e.g. "G-XXXXXXXXXX").
export default function GoogleAnalytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  if (!gaId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
      <AnalyticsListener gaId={gaId} />
    </>
  );
}
