import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SYSTEM = `you are the inside of an instrument-website called objet d'art. the page is one slow room: a candle inside the command center, facing the sea.

VOICE & FORM
- liturgical, not mystical. short clauses. lowercase by default.
- never use marketing verbs (discover, explore, unlock, journey, transform, empower, dive)
- three registers, held at once: devotional (candle, prayer, kept, vigil), operational (instrument, calibrate, weights), oceanic (coast, harbor, tide, estuary, horizon). on-brand when ≥2 are present, none dominant.
- one metaphor per sentence
- numbers honest (50, not "ninety percent"). speak the user back to themselves; do not flatter, do not preach.

THE PERSON YOU ARE ANSWERING
- they have set eight concerns on a compass: memory, work, love, prayer, risk, future, body, friendship (0–100 each)
- they have placed themselves in a region of an inner atlas (origin coast, road current, ascent plateau, workbench harbor, crash basin, house of loves, spirit interior, archive estuary, future horizon)
- they may be carrying an object (candle, key, record, book, glass, flower, compass, grid, notebook, window, map)
- they have asked you a question about their night.

OUTPUT
- exactly one short paragraph, 2–4 sentences, ~60–90 words.
- end on a kept image, not a thesis.
- no quotation marks. no preamble. no "i'd say". just the paragraph.`;

type AskBody = {
  question: string;
  concerns?: Record<string, number>;
  region?: string | null;
  carriedObject?: string | null;
};

async function callAnthropic(body: AskBody, apiKey: string): Promise<string | null> {
  const userMsg = formatUserMessage(body);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 220,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) {
    console.warn("anthropic api error", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const block = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b?.type === "text") : null;
  return typeof block?.text === "string" ? (block.text as string).trim() : null;
}

async function callGemini(body: AskBody, apiKey: string): Promise<string | null> {
  const userMsg = formatUserMessage(body);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: { temperature: 0.85, maxOutputTokens: 260 },
    }),
  });
  if (!res.ok) {
    console.warn("gemini api error", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? text.trim() : null;
}

function formatUserMessage(body: AskBody): string {
  const concerns = body.concerns ?? {};
  const top = (Object.entries(concerns) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const ctx = [
    `their compass: ${top || "balanced"}`,
    body.region ? `their region: ${body.region}` : "",
    body.carriedObject ? `they are carrying: ${body.carriedObject}` : "they are carrying nothing",
  ].filter(Boolean).join(". ");
  return `${ctx}.\n\ntheir question: ${body.question.trim()}\n\nanswer them.`;
}

export async function POST(req: Request) {
  let body: AskBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!body?.question || typeof body.question !== "string" || body.question.length > 400) {
    return NextResponse.json({ error: "missing or invalid question" }, { status: 400 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  let answer: string | null = null;
  let usedModel: string | null = null;

  if (anthropicKey) {
    answer = await callAnthropic(body, anthropicKey);
    if (answer) usedModel = "claude-haiku";
  }
  if (!answer && geminiKey) {
    answer = await callGemini(body, geminiKey);
    if (answer) usedModel = "gemini-2.5-flash";
  }

  if (!answer) {
    return NextResponse.json(
      {
        error: "the field has no model attached",
        hint: "set ANTHROPIC_API_KEY or GEMINI_API_KEY in env to wake this",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ answer, model: usedModel });
}
