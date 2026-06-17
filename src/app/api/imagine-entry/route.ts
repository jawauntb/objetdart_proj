import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SYSTEM = `you write entries for the archive of objet d'art — an instrument-website. each entry stands in for an artifact in someone's inner archive: a notebook, a recording, a study, a route map.

VOICE & FORM
- liturgical, not mystical. lowercase. short clauses.
- never use marketing verbs (discover, explore, unlock, journey, transform, empower, dive)
- three registers held: devotional (candle, prayer, kept, vigil), operational (instrument, weights, calibrate), oceanic (coast, harbor, tide, estuary, horizon). on-brand when ≥2 present, none dominant.
- one metaphor per sentence.

OUTPUT
respond with strict JSON of shape:
{
  "fn": "<one-line description, under 60 chars, lowercase, no period>",
  "note": "<a single sentence pull-quote, ~10-18 words, in italic-feeling prose>",
  "body": ["<para 1>", "<para 2>", "<para 3>"]
}

each body paragraph 60–90 words. open with a strong image. end with a kept image, not a thesis. respect the user's title and tagged concerns.

no extra keys. no markdown. just the JSON object.`;

type ImagineBody = {
  title: string;
  concerns: string[];   // concern keys from data/content.ts
  medium?: string;
  region?: string;
};

async function callAnthropic(body: ImagineBody, apiKey: string): Promise<unknown | null> {
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
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const block = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b?.type === "text") : null;
  return safeParseJson(typeof block?.text === "string" ? block.text : "");
}

async function callGemini(body: ImagineBody, apiKey: string): Promise<unknown | null> {
  const userMsg = formatUserMessage(body);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 900,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return safeParseJson(typeof text === "string" ? text : "");
}

function safeParseJson(text: string): unknown | null {
  if (!text) return null;
  // strip code fences if any
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try { return JSON.parse(cleaned); } catch {
    // try to find a JSON object embedded in prose
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
    return null;
  }
}

function formatUserMessage(b: ImagineBody): string {
  return [
    `title: ${b.title.trim()}`,
    `concerns: ${b.concerns.join(", ") || "—"}`,
    b.medium ? `medium: ${b.medium}` : "",
    b.region ? `region: ${b.region}` : "",
    "",
    "write this artifact into the archive. return the JSON.",
  ].filter(Boolean).join("\n");
}

export async function POST(req: Request) {
  let body: ImagineBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!body?.title || typeof body.title !== "string" || body.title.length > 80) {
    return NextResponse.json({ error: "title required, under 80 chars" }, { status: 400 });
  }
  if (!Array.isArray(body.concerns)) body.concerns = [];

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  let result: unknown | null = null;
  let usedModel: string | null = null;

  if (anthropicKey) {
    result = await callAnthropic(body, anthropicKey);
    if (result) usedModel = "claude-haiku";
  }
  if (!result && geminiKey) {
    result = await callGemini(body, geminiKey);
    if (result) usedModel = "gemini-2.5-flash";
  }

  if (!result || typeof result !== "object") {
    return NextResponse.json(
      {
        error: "the field has no model attached",
        hint: "set ANTHROPIC_API_KEY or GEMINI_API_KEY in env to wake this",
      },
      { status: 503 },
    );
  }

  // shape validation
  const r = result as { fn?: unknown; note?: unknown; body?: unknown };
  if (typeof r.fn !== "string" || typeof r.note !== "string" || !Array.isArray(r.body)) {
    return NextResponse.json({ error: "model returned wrong shape", raw: result }, { status: 502 });
  }

  return NextResponse.json({
    entry: {
      fn: r.fn,
      note: r.note,
      body: (r.body as unknown[]).filter((p) => typeof p === "string").slice(0, 4) as string[],
    },
    model: usedModel,
  });
}
