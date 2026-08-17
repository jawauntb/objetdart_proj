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
import { GUIDE_VOICE_ATTR, GUIDE_VOICE_KEY } from "@/lib/guide-voice";
import GuideAudioBed from "./GuideAudioBed";
import "./guide.css";

// Every entry below is server-rendered in both voices; the stylesheet shows
// one by `<html data-guide-voice>`. This runs before the guide paints so a
// returning field-notes reader never sees the plain default flash first.
const VOICE_BOOT = `try{var v=localStorage.getItem(${JSON.stringify(
  GUIDE_VOICE_KEY,
)});if(v==="field"||v==="plain")document.documentElement.setAttribute(${JSON.stringify(
  GUIDE_VOICE_ATTR,
)},v)}catch(e){}`;

export default function GuidePage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: VOICE_BOOT }} />
      <SiteHeader />
      <main>
        {/* data-pretext-ignore: the guide is a reading surface. Without it,
            GlobalPretextText wraps its thousands of words in per-word breathe
            spans whose drift swallows Cormorant's narrow spaces on phones —
            the same defect the ? sheet had ("thatis", "foundby" in the lede). */}
        <div className="guide" data-pretext-ignore="">
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
