// Objet d'art's MCP endpoint (also served at /mcp — see next.config.mjs).
import { notHere, serveMcp } from "@/lib/universe-mcp/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (req: Request) => serveMcp(req, null);
export const GET = notHere;
export const DELETE = notHere;
