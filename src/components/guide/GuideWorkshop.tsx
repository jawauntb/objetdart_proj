import { GUIDE_APIS, GUIDE_WORKSHOP } from "@/data/guide";

/** Workshop prose + a machine-readable HTTP API reference. */
export default function GuideWorkshop() {
  return (
    <section id="workshop" className="guide-section">
      <h2 className="t-h2 guide-h2">
        <em>the workshop</em>
      </h2>
      <p className="t-body guide-note">
        for the ones who would build a room of their own — how the machinery is kept, and
        the covenants a new room signs before it joins the album.
      </p>
      {GUIDE_WORKSHOP.map((part) => (
        <div key={part.title} className="guide-workshop-part">
          <h3 className="t-h3 guide-workshop-title">
            <em>{part.title}</em>
          </h3>
          {part.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 32)} className="t-body guide-workshop-body">
              {paragraph}
            </p>
          ))}
        </div>
      ))}

      <div className="guide-workshop-part">
        <h3 className="t-h3 guide-workshop-title">
          <em>the http api</em>
        </h3>
        <p className="t-body guide-workshop-body">
          the room&rsquo;s few server offices, all stateless: each takes the current state in
          the request body and stores nothing. all prefer <span className="t-mono">ANTHROPIC_API_KEY</span>,
          fall back to <span className="t-mono">GEMINI_API_KEY</span>, and answer 503 with a
          hint when neither is set. the voice rules are hard-coded into every system prompt.
        </p>
        <div className="guide-apis">
          {GUIDE_APIS.map((api) => (
            <div key={api.name} className="guide-api">
              <p className="t-mono guide-api-name">
                {api.method} /api/{api.name}
              </p>
              <p className="t-body guide-api-line"><span className="t-mono">takes ·</span> {api.takes}</p>
              <p className="t-body guide-api-line"><span className="t-mono">returns ·</span> {api.returns}</p>
              {api.notes ? <p className="t-body guide-api-line"><span className="t-mono">notes ·</span> {api.notes}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
