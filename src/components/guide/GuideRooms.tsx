import { GUIDE_ROOMS, type GuideRoom } from "@/data/guide";
import { SITE_ROUTE_BY_KEY } from "@/lib/routes";
import GuideRoomCard from "./GuideRoomCard";

const CLUSTER_LABELS: Record<string, string> = {
  threshold: "the threshold",
  field: "the field",
  water: "the water",
  nature: "the living world",
  mechanism: "the mechanism",
};

const CLUSTER_ORDER = ["threshold", "field", "water", "nature", "mechanism"];

function clusterOf(room: GuideRoom): string {
  if (room.key === "home") return "threshold";
  return SITE_ROUTE_BY_KEY[room.key]?.cluster ?? "field";
}

/**
 * The complete room roster grouped by cluster. Renders 55 GuideRoomCards on
 * the server; the client receives only the resulting HTML, and each card
 * skips layout until it scrolls near the viewport via CSS content-visibility.
 */
export default function GuideRooms() {
  const grouped = CLUSTER_ORDER.map((cluster) => ({
    cluster,
    rooms: GUIDE_ROOMS.filter((room) => clusterOf(room) === cluster),
  })).filter((group) => group.rooms.length > 0);

  return (
    <section id="rooms" className="guide-section">
      <h2 className="t-h2 guide-h2">
        <em>the rooms, exhaustively</em>
      </h2>
      <p className="t-body guide-note">
        every route, every move it answers. the global bindings above are assumed
        throughout and not repeated; what follows is each room&rsquo;s own register.
        screenshots are kept current by the workshop — if a picture and a room disagree,
        the room is newer.
      </p>
      {grouped.map((group) => (
        <div key={group.cluster} className="guide-cluster">
          <h3 className="t-eyebrow guide-cluster-title">{CLUSTER_LABELS[group.cluster]}</h3>
          {group.rooms.map((room) => (
            <GuideRoomCard key={room.key} room={room} />
          ))}
        </div>
      ))}
    </section>
  );
}
