import { NextResponse } from "next/server";
import {
  parseMusicInput,
  type ParsedMusicInput,
  type ParsedMusicMetadata,
  type ParsedMusicToken,
} from "@/lib/light-music";

export const runtime = "nodejs";
export const maxDuration = 45;

const MODEL = "gemini-2.5-flash";
const MAX_TEXT_LENGTH = 8_000;
const MAX_IMAGE_BASE64_LENGTH = 8_000_000;

type SheetImage = {
  data: string;
  mimeType: string;
  name?: string;
};

type ParseMusicBody = {
  text?: string;
  image?: SheetImage | null;
};

type GeminiMusicEvent = {
  notes?: unknown;
  note?: unknown;
  pitches?: unknown;
  rest?: unknown;
  type?: unknown;
  duration?: unknown;
};

type GeminiMusicJson = {
  metadata?: Record<string, unknown>;
  events?: GeminiMusicEvent[];
  warnings?: unknown;
};

const SYSTEM = `You normalize arbitrary music into deterministic color-map input.

Return strict JSON only:
{
  "metadata": {
    "title": "optional",
    "tempo": 120,
    "timeSignature": [4, 4],
    "key": "C"
  },
  "events": [
    { "notes": ["C4"], "duration": 1 },
    { "notes": ["C4", "E4", "G4"], "duration": 2 },
    { "rest": true, "duration": 0.5 }
  ],
  "warnings": ["optional uncertainty notes"]
}

Rules:
- Use scientific pitch notation, like C4, F#4, Bb3. If octave is unclear, choose the most plausible playable octave.
- Chords are one event with multiple notes.
- Durations are beats; use 1 when unclear.
- Include tempo, time signature, and key when the source implies them.
- For sheet images, read the visible staff as best as possible and approximate unclear marks rather than inventing prose.
- Do not return MusicXML, ABC, markdown, or explanation.`;

export async function POST(req: Request) {
  let body: ParseMusicBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT_LENGTH) : "";
  const image = normalizeImage(body?.image);

  if (!text && !image) {
    return NextResponse.json({ error: "music text or sheet image required" }, { status: 400 });
  }

  if (body?.image && !image) {
    return NextResponse.json({ error: "image must be an image/* file under 8 MB" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (image) {
      return NextResponse.json(
        { error: "sheet image reading needs GEMINI_API_KEY" },
        { status: 503 },
      );
    }
    return normalizedResponse(parseMusicInput(text), "local", text);
  }

  const normalized = await callGemini({ text, image }, apiKey);
  if (!normalized) {
    if (!image) return normalizedResponse(parseMusicInput(text), "local", text);
    return NextResponse.json({ error: "could not interpret music" }, { status: 502 });
  }

  return normalizedResponse(normalized, MODEL);
}

async function callGemini(body: { text: string; image: SheetImage | null }, apiKey: string): Promise<ParsedMusicInput | null> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: musicPrompt(body.text, body.image?.name) },
  ];
  if (body.image) {
    parts.push({ inlineData: { mimeType: body.image.mimeType, data: body.image.data } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2400,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    console.warn("gemini music parse error", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const json = safeParseJson(typeof text === "string" ? text : "");
  if (!json || typeof json !== "object") return null;

  const scoreText = scoreTextFromGemini(json as GeminiMusicJson);
  if (!scoreText) return null;

  const parsed = parseMusicInput(scoreText);
  const hasMusic = parsed.tokens.some((token) => token.kind === "note" || token.kind === "chord" || token.kind === "rest");
  return hasMusic ? parsed : null;
}

function musicPrompt(text: string, filename?: string) {
  return [
    filename ? `sheet image filename: ${filename}` : "",
    text ? `source text:\n${text}` : "source text: none",
    "",
    "Normalize the source into JSON events for the color-map instrument.",
  ].filter(Boolean).join("\n");
}

function normalizedResponse(parsed: ParsedMusicInput, model: string, fallbackScoreText = "") {
  const invalid = parsed.tokens
    .filter((token) => token.kind === "invalid")
    .map((token) => `skipped ${token.raw}`);
  const scoreText = scoreTextFromParsed(parsed);

  return NextResponse.json({
    scoreText: scoreText || fallbackScoreText,
    metadata: parsed.metadata,
    warnings: [...parsed.warnings, ...invalid],
    model,
  });
}

function scoreTextFromGemini(result: GeminiMusicJson) {
  const metadata = normalizeMetadata(result.metadata);
  const events = Array.isArray(result.events) ? result.events : [];
  const lines = metadataLines(metadata);
  const tokens = events.map(tokenFromGeminiEvent).filter(Boolean);
  if (tokens.length === 0) return "";
  lines.push(tokens.join(" "));
  return lines.join("\n");
}

function scoreTextFromParsed(parsed: ParsedMusicInput) {
  const lines = metadataLines(parsed.metadata);
  const tokens = parsed.tokens.map(tokenFromParsed).filter(Boolean);
  if (tokens.length > 0) lines.push(tokens.join(" "));
  return lines.join("\n");
}

function metadataLines(metadata: ParsedMusicMetadata) {
  const lines: string[] = [];
  if (metadata.title) lines.push(`T:${metadata.title}`);
  if (metadata.tempo) lines.push(`tempo=${roundDuration(metadata.tempo)}`);
  if (metadata.timeSignature) lines.push(`time=${metadata.timeSignature[0]}/${metadata.timeSignature[1]}`);
  if (metadata.key) lines.push(`key=${metadata.key}`);
  return lines;
}

function tokenFromParsed(token: ParsedMusicToken) {
  if (token.kind === "invalid") return "";
  if (token.kind === "rest") return `rest${durationSuffix(token.duration)}`;
  return `${token.normalized}${durationSuffix(token.duration)}`;
}

function tokenFromGeminiEvent(event: GeminiMusicEvent) {
  const duration = normalizeDuration(event.duration);
  const rest = event.rest === true || event.type === "rest";
  const notes = normalizeNotes(event.notes ?? event.note ?? event.pitches);

  if (rest || notes.length === 0) return `rest${durationSuffix(duration)}`;
  if (notes.length === 1) return `${notes[0]}${durationSuffix(duration)}`;
  return `[${notes.join(" ")}]${durationSuffix(duration)}`;
}

function normalizeMetadata(metadata?: Record<string, unknown>): ParsedMusicMetadata {
  if (!metadata) return {};

  const normalized: ParsedMusicMetadata = {};
  const title = stringValue(metadata.title);
  const key = stringValue(metadata.key);
  const tempo = normalizeNumber(metadata.tempo ?? metadata.bpm);
  const signature = normalizeTimeSignature(metadata.timeSignature ?? metadata.time ?? metadata.meter);

  if (title) normalized.title = title.slice(0, 120);
  if (key) normalized.key = key.slice(0, 24);
  if (tempo) normalized.tempo = Math.max(20, Math.min(320, tempo));
  if (signature) normalized.timeSignature = signature;
  return normalized;
}

function normalizeTimeSignature(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const top = normalizeNumber(value[0]);
    const bottom = normalizeNumber(value[1]);
    if (top && bottom) return [top, bottom];
  }

  const text = stringValue(value);
  const match = text?.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function normalizeNotes(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map(normalizeNote)
    .filter((note): note is string => Boolean(note));
}

function normalizeNote(value: unknown) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const pitch = stringValue(record.note ?? record.pitch ?? record.name);
    const octave = normalizeNumber(record.octave);
    return normalizeNoteString(octave != null && pitch && !/-?\d+$/.test(pitch) ? `${pitch}${octave}` : pitch);
  }

  return normalizeNoteString(stringValue(value));
}

function normalizeNoteString(value?: string) {
  const text = value
    ?.replace(/\u266f/g, "#")
    .replace(/\u266d/g, "b")
    .replace(/\s+/g, "")
    .trim();
  const match = text?.match(/^([A-Ga-g])([#b]?)(-?\d+)?$/);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2] ?? ""}${match[3] ?? 4}`;
}

function normalizeDuration(value: unknown) {
  const duration = normalizeNumber(value);
  return duration ? Math.max(0.125, Math.min(8, duration)) : 1;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const ratio = value.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (ratio) {
    const top = Number(ratio[1]);
    const bottom = Number(ratio[2]);
    return bottom > 0 ? top / bottom : null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function durationSuffix(duration: number) {
  return Math.abs(duration - 1) < 0.0001 ? "" : `:${roundDuration(duration)}`;
}

function roundDuration(value: number) {
  return Number(value.toFixed(3)).toString();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeImage(image?: SheetImage | null): SheetImage | null {
  if (!image || typeof image !== "object") return null;
  if (typeof image.data !== "string" || image.data.length === 0 || image.data.length > MAX_IMAGE_BASE64_LENGTH) return null;
  if (typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/")) return null;

  return {
    data: image.data,
    mimeType: image.mimeType,
    name: typeof image.name === "string" ? image.name.slice(0, 140) : undefined,
  };
}

function safeParseJson(text: string): unknown | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try { return JSON.parse(cleaned); } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}
