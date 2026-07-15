export const DITHER_AVATAR_GRID_SIZE = 7;
export const DITHER_AVATAR_IMAGE_SIZE = 512;

const MAX_NAME_CODE_POINTS = 24;

export type DitherAvatarPattern = {
  name: string;
  hue: number;
  cells: boolean[][];
};

export type DitherAvatarSaveResult = {
  outcome: "shared" | "downloaded" | "cancelled";
  filename: string;
};

export function normalizeDitherName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return Array.from(normalized).slice(0, MAX_NAME_CODE_POINTS).join("");
}

function hashDitherName(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createDitherAvatar(value: string): DitherAvatarPattern {
  const name = normalizeDitherName(value);
  const hash = hashDitherName(name);
  const cells = Array.from({ length: DITHER_AVATAR_GRID_SIZE }, (_, row) => (
    Array.from({ length: DITHER_AVATAR_GRID_SIZE }, (_, column) => {
      const mirroredColumn = column > 3 ? 6 - column : column;
      return ((hash >>> ((row * 4 + mirroredColumn) % 28)) & 1) === 1;
    })
  ));

  return { name, hue: hash % 360, cells };
}

function filenameForName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "signal";
  return `dither-${slug}.png`;
}

export function avatarFilename(value: string): string {
  return filenameForName(normalizeDitherName(value));
}

function roundedSquare(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + size - radius, y);
  context.quadraticCurveTo(x + size, y, x + size, y + radius);
  context.lineTo(x + size, y + size - radius);
  context.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
  context.lineTo(x + radius, y + size);
  context.quadraticCurveTo(x, y + size, x, y + size - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, encoded] = dataUrl.split(",");
  const mime = metadata.match(/^data:([^;]+)/)?.[1] ?? "image/png";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function renderDitherAvatarPng(avatar: DitherAvatarPattern): Blob {
  if (!avatar.name) throw new Error("A name is required to make an avatar.");
  if (typeof document === "undefined") throw new Error("Avatar export requires a browser.");

  const canvas = document.createElement("canvas");
  canvas.width = DITHER_AVATAR_IMAGE_SIZE;
  canvas.height = DITHER_AVATAR_IMAGE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the avatar.");

  context.fillStyle = "#0b0e0a";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const step = 64;
  const cellSize = 56;
  const offset = 36;
  context.fillStyle = `hsl(${avatar.hue} 75% 70%)`;
  context.shadowColor = `hsl(${avatar.hue} 75% 60% / 0.34)`;
  context.shadowBlur = 24;

  avatar.cells.forEach((row, y) => {
    row.forEach((on, x) => {
      if (!on) return;
      roundedSquare(context, offset + x * step, offset + y * step, cellSize, 7);
      context.fill();
    });
  });

  return dataUrlToBlob(canvas.toDataURL("image/png"));
}

function downloadAvatar(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareOrDownloadDitherAvatar(value: string): Promise<DitherAvatarSaveResult> {
  const avatar = createDitherAvatar(value);
  const filename = filenameForName(avatar.name);
  const blob = renderDitherAvatarPng(avatar);
  const shareNavigator = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };

  if (typeof File !== "undefined" && shareNavigator.share && shareNavigator.canShare) {
    const file = new File([blob], filename, { type: "image/png" });
    const shareData: ShareData = {
      files: [file],
      title: `${avatar.name} dither avatar`,
    };
    let canShare = false;
    try {
      canShare = shareNavigator.canShare(shareData);
    } catch {
      // Fall back to download when a browser advertises, but cannot inspect,
      // file-sharing support.
    }
    if (canShare) {
      try {
        await shareNavigator.share(shareData);
        return { outcome: "shared", filename };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return { outcome: "cancelled", filename };
        }
        // If the platform advertises file sharing but fails to open it, keep
        // the one-click promise by falling back to a normal browser download.
      }
    }
  }

  downloadAvatar(blob, filename);
  return { outcome: "downloaded", filename };
}
