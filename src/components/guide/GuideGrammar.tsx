import { GUIDE_GLOBAL_BINDINGS, GUIDE_LAYERS } from "@/data/guide";

/** The finger-count grammar and the global-binding gesture table. */
export default function GuideGrammar() {
  return (
    <section id="grammar" className="guide-section">
      <h2 className="t-h2 guide-h2">
        <em>the grammar of the hand</em>
      </h2>
      <p className="t-body guide-note">
        one grammar, every room. the number of fingers chooses which layer of the world you
        are touching — learn it once and it holds everywhere, forever.
      </p>
      <div className="guide-layers">
        {GUIDE_LAYERS.map((layer) => (
          <div key={layer.title} className="guide-layer">
            <h3 className="t-mono guide-layer-title">{layer.title}</h3>
            <p className="t-body guide-layer-body">{layer.body}</p>
          </div>
        ))}
      </div>
      <table className="guide-bindings">
        <caption className="t-mono guide-bindings-caption">
          the global bindings — identical in every room
        </caption>
        <tbody>
          {GUIDE_GLOBAL_BINDINGS.map((binding) => (
            <tr key={binding.gesture}>
              <th scope="row" className="t-mono">{binding.gesture}</th>
              <td className="t-body">{binding.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
