import SiteHeader from "@/components/SiteHeader";
import ExperimentGallery from "@/components/ExperimentGallery";

export const metadata = {
  title: "Experiment — the scrolling cabinet",
  description: "Walk through every objet d'art toy without leaving the page.",
};

export default function ExperimentPage() {
  return (
    <>
      <SiteHeader />
      <ExperimentGallery />
    </>
  );
}
