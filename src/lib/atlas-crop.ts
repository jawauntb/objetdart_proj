/** Client-safe Atlas pixel crop helpers (Canvas in the browser). */

import { normalizeClipRect, type AtlasClipRect } from "@/lib/atlas-batch";

export type AtlasPixelBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Convert a normalized clip rect into inclusive pixel extract bounds. */
export function pixelBoundsForClip(
  clip: AtlasClipRect,
  imageWidth: number,
  imageHeight: number,
): AtlasPixelBounds {
  const normalized = normalizeClipRect(clip);
  const w = Math.max(1, Math.floor(imageWidth));
  const h = Math.max(1, Math.floor(imageHeight));
  const left = Math.min(w - 1, Math.max(0, Math.round(normalized.x * w)));
  const top = Math.min(h - 1, Math.max(0, Math.round(normalized.y * h)));
  const right = Math.min(w, Math.max(left + 1, Math.round((normalized.x + normalized.width) * w)));
  const bottom = Math.min(h, Math.max(top + 1, Math.round((normalized.y + normalized.height) * h)));
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Load `source` (data URL or same-origin path), crop to the clip rect, and return a PNG data URL.
 * Buffer margin is assumed already baked into `clip` by AtlasClipRect helpers.
 */
export async function cropAtlasDataUrl(source: string, clip: AtlasClipRect): Promise<string> {
  const image = await loadAtlasImageElement(source);
  const bounds = pixelBoundsForClip(clip, image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("atlas crop canvas unavailable");
  ctx.drawImage(
    image,
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  return canvas.toDataURL("image/png");
}

function loadAtlasImageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        reject(new Error("atlas crop source has no dimensions"));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error("atlas crop source failed to load"));
    image.src = source;
  });
}
