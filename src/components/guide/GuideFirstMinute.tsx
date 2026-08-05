import { GUIDE_FIRST_MINUTE } from "@/data/guide";

/** Onboarding walkthrough — a numbered ordered list of first-visit steps. */
export default function GuideFirstMinute() {
  return (
    <section id="first-minute" className="guide-section">
      <h2 className="t-h2 guide-h2">
        <em>the first minute</em>
      </h2>
      <p className="t-body guide-note">
        arrive with sound on if you can. nothing here autoplays — the sea waits for your
        first touch.
      </p>
      <ol className="guide-steps">
        {GUIDE_FIRST_MINUTE.map((step, index) => (
          <li key={step.title} className="guide-step">
            <span className="guide-step-num t-mono">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3 className="t-h3 guide-step-title">{step.title}</h3>
              <p className="t-body guide-step-body">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
