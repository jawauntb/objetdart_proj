import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = "gemini-3.1-flash-tts-preview";
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const SAMPLE_WIDTH_BYTES = 2;
const DEFAULT_VOICE = "Sulafat";
const VOICES = new Set([
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda",
  "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus",
  "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
  "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux",
  "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix",
  "Sadachbia", "Sadaltager", "Sulafat",
]);

type SpeechBody = {
  text: string;
  context?: string;
  voiceName?: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function buildSpeechPrompt(body: SpeechBody): string {
  const context = typeof body.context === "string" ? normalizeText(body.context).slice(0, 240) : "";
  return [
    "Synthesize speech for an instrument-website called objet d'art.",
    "Voice direction: warm, intimate, unhurried, close to the microphone.",
    "Keep the cadence like a candle inside a quiet command center facing the sea.",
    "Do not add words. Read only the transcript after TRANSCRIPT.",
    context ? `Context: ${context}` : "",
    "",
    "TRANSCRIPT:",
    normalizeText(body.text),
  ].filter(Boolean).join("\n");
}

function pcmBase64ToWavBase64(pcmBase64: string): string {
  const pcm = Buffer.from(pcmBase64, "base64");
  const dataSize = pcm.length;
  const byteRate = SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH_BYTES;
  const blockAlign = CHANNELS * SAMPLE_WIDTH_BYTES;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(SAMPLE_WIDTH_BYTES * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]).toString("base64");
}

async function callGeminiTts(body: SpeechBody, apiKey: string, voiceName: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: buildSpeechPrompt(body) }],
      }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const details = await res.text();
    console.warn("gemini tts api error", res.status, details);
    return { error: "speech generation failed" as const };
  }

  const data = await res.json();
  const parts = (data?.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
  for (const part of parts) {
    const inline = part.inlineData ?? (
      part.inline_data
        ? { mimeType: part.inline_data.mime_type, data: part.inline_data.data }
        : undefined
    );
    const pcmBase64 = inline?.data;
    if (typeof pcmBase64 === "string") return { pcmBase64 };
  }

  return { error: "model returned no audio" as const };
}

export async function POST(req: Request) {
  let body: SpeechBody;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!body?.text || typeof body.text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const text = normalizeText(body.text);
  if (!text || text.length > 1200) {
    return NextResponse.json({ error: "text required, under 1200 chars" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "speech generation needs GEMINI_API_KEY" },
      { status: 503 },
    );
  }

  const voiceName = typeof body.voiceName === "string" && VOICES.has(body.voiceName)
    ? body.voiceName
    : DEFAULT_VOICE;

  let result = await callGeminiTts({ ...body, text }, apiKey, voiceName);
  if (!("pcmBase64" in result)) {
    result = await callGeminiTts({ ...body, text }, apiKey, voiceName);
  }

  const pcmBase64 = "pcmBase64" in result && typeof result.pcmBase64 === "string"
    ? result.pcmBase64
    : null;

  if (!pcmBase64) {
    const error = "error" in result ? result.error : "model returned no audio";
    return NextResponse.json({ error }, { status: 502 });
  }

  return NextResponse.json({
    audio: {
      mimeType: "audio/wav",
      data: pcmBase64ToWavBase64(pcmBase64),
    },
    model: MODEL,
    voice: voiceName,
  });
}
