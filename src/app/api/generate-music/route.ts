import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "lyria-3-clip-preview";

type MusicBody = {
  prompt: string;
  concerns?: Record<string, number>;
  oceanicCoda?: boolean;
};

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

function buildMusicPrompt(body: MusicBody): string {
  const top = Object.entries(body.concerns ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, value]) => `${name} ${value}`)
    .join(", ");
  const wantsSeaWash = body.oceanicCoda !== false;

  return [
    "Create a 30-second instrumental music clip for an interactive oceanic instrument website.",
    "Instrumental only, no vocals, no lyrics.",
    "Keep it textural, close-mic, playable as a loop, and responsive to this user prompt:",
    body.prompt.trim(),
    wantsSeaWash
      ? "Thread a subtle sea-wash texture through the clip, with a tide-like tail that can loop cleanly."
      : "Do not force an ocean ending; resolve naturally while remaining loopable.",
    top ? `The current field emphasis is: ${top}.` : "",
  ].filter(Boolean).join("\n");
}

export async function POST(req: Request) {
  let body: MusicBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!body?.prompt || typeof body.prompt !== "string" || body.prompt.trim().length > 500) {
    return NextResponse.json({ error: "prompt required, under 500 chars" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "music generation needs GEMINI_API_KEY" },
      { status: 503 },
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: buildMusicPrompt(body) }],
      }],
    }),
  });

  if (!res.ok) {
    const details = await res.text();
    console.warn("lyria api error", res.status, details);
    return NextResponse.json({ error: "music generation failed" }, { status: 502 });
  }

  const data = await res.json();
  const parts = (data?.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
  const text = parts.map((part) => part.text).filter(Boolean).join("\n").trim();
  for (const part of parts) {
    const inline = part.inlineData ?? (
      part.inline_data
        ? { mimeType: part.inline_data.mime_type, data: part.inline_data.data }
        : undefined
    );
    if (inline?.data) {
      return NextResponse.json({
        audio: {
          mimeType: inline.mimeType ?? "audio/mpeg",
          data: inline.data,
        },
        text: text || null,
        model: MODEL,
      });
    }
  }

  return NextResponse.json({ error: "model returned no audio", text: text || null }, { status: 502 });
}
