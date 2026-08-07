import { redirect } from "next/navigation";

// The door opens onto the fold itself. The manifold keeps its one registry
// address (/manifold) — chrome, guide, and axis all resolve there — so the
// threshold sends the visitor rather than mounting a second copy of the room.
export default function Page() {
  redirect("/manifold");
}
