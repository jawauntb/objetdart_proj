// Server component. The guide's ~1400 lines of static data never ship to
// the client bundle: every section renders on the server and the browser
// receives HTML + one small useEffect (GuideAudioBed) for the ambient bed.
// See src/components/guide/ for the section components.
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import GuideFirstMinute from "@/components/guide/GuideFirstMinute";
import GuideGrammar from "@/components/guide/GuideGrammar";
import GuideHero from "@/components/guide/GuideHero";
import GuideRooms from "@/components/guide/GuideRooms";
import GuideWorkshop from "@/components/guide/GuideWorkshop";
import GuideAudioBed from "./GuideAudioBed";
import "./guide.css";

export default function GuidePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <div className="guide">
          <GuideHero />
          <GuideFirstMinute />
          <GuideGrammar />
          <GuideRooms />
          <GuideWorkshop />
        </div>
      </main>
      <SiteFooter />
      <GuideAudioBed />
    </>
  );
}
