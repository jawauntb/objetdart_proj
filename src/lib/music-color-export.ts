import { clamp, type ParsedMusicToken } from "@/lib/light-music";

export type MusicColorExportKind = "bar" | "matrix";

type MusicCell = Exclude<ParsedMusicToken, { kind: "invalid" }>;
type MusicNote = Extract<ParsedMusicToken, { kind: "note" }>;

type MusicColorExportOptions = {
  kind: MusicColorExportKind;
  cells: MusicCell[];
  matrixRows: (MusicCell | null)[][];
  matrixSize: number;
  totalDuration: number;
};

const EXPORT_BACKGROUND = "#07090d";
const EXPORT_INK = "#f5f0e6";

export async function exportMusicColorImage(options: MusicColorExportOptions) {
  if (options.cells.length === 0) throw new Error("nothing to export");

  const canvas = options.kind === "bar"
    ? paintBarExport(options.cells, options.totalDuration)
    : paintMatrixExport(options.matrixRows, options.matrixSize);

  await downloadCanvas(canvas, exportFilename(options.kind));
}

function exportFilename(kind: MusicColorExportKind) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `music-color-${kind}-${stamp}.png`;
}

function noteLabel(cell: MusicCell | null) {
  if (!cell) return "";
  if (cell.kind === "rest") return "rest";
  return cell.normalized;
}

function paintExportBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  const spectrum = ctx.createLinearGradient(0, 0, width, 0);
  spectrum.addColorStop(0, "rgba(216, 58, 46, 0.22)");
  spectrum.addColorStop(0.28, "rgba(245, 214, 91, 0.14)");
  spectrum.addColorStop(0.52, "rgba(79, 202, 117, 0.16)");
  spectrum.addColorStop(0.74, "rgba(69, 184, 232, 0.15)");
  spectrum.addColorStop(1, "rgba(154, 99, 238, 0.2)");
  ctx.fillStyle = spectrum;
  ctx.fillRect(0, 0, width, height);

  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, "rgba(255,255,255,0.05)");
  shade.addColorStop(0.48, "rgba(0,0,0,0.08)");
  shade.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
}

function paintExportHeader(ctx: CanvasRenderingContext2D, title: string, meta: string, width: number) {
  ctx.fillStyle = "rgba(245,240,230,0.62)";
  ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText("light / inverse translator", 44, 30);

  ctx.fillStyle = EXPORT_INK;
  ctx.font = "34px Georgia, 'Times New Roman', serif";
  ctx.fillText(title, 44, 52, width - 88);

  ctx.fillStyle = "rgba(245,240,230,0.68)";
  ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.fillText(meta, width - 44, 36, Math.max(160, width - 88));
  ctx.textAlign = "left";
}

function paintRestPattern(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.fillStyle = "rgba(245,240,230,0.07)";
  ctx.fillRect(x, y, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.strokeStyle = "rgba(245,240,230,0.2)";
  ctx.lineWidth = 3;
  for (let offset = -height; offset < width + height; offset += 18) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + height);
    ctx.lineTo(x + offset + height, y);
    ctx.stroke();
  }
  ctx.restore();
}

function paintNoteRect(
  ctx: CanvasRenderingContext2D,
  cell: MusicNote,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  ctx.shadowColor = cell.color;
  ctx.shadowBlur = 15;
  ctx.fillStyle = cell.color;
  ctx.fillRect(x, y, width, height);
  ctx.shadowBlur = 0;

  const gloss = ctx.createLinearGradient(0, y, 0, y + height);
  gloss.addColorStop(0, "rgba(255,255,255,0.28)");
  gloss.addColorStop(0.36, "rgba(255,255,255,0.04)");
  gloss.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, width, height);
}

function paintExportText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size = 12,
) {
  ctx.fillStyle = EXPORT_INK;
  ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(text, x, y, maxWidth);
}

function paintBarExport(cells: MusicCell[], totalDuration: number) {
  const gap = 3;
  const padding = 44;
  const barY = 116;
  const barHeight = 148;
  const rawWidths = cells.map((cell) => Math.max(34, cell.duration * 54));
  const rawContentWidth =
    rawWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, cells.length - 1) * gap;
  const contentWidth = clamp(rawContentWidth, 900, 7200);
  const scale = rawContentWidth > 0 ? contentWidth / rawContentWidth : 1;
  const width = Math.round(contentWidth + padding * 2);
  const height = 336;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  ctx.scale(dpr, dpr);
  paintExportBackground(ctx, width, height);
  paintExportHeader(ctx, "music color bar", `${cells.length} cells / ${totalDuration.toFixed(1)} beats`, width);

  let x = padding;
  cells.forEach((cell, index) => {
    const segmentWidth = rawWidths[index] * scale;
    if (cell.kind === "note") {
      paintNoteRect(ctx, cell, x, barY, segmentWidth, barHeight);
    } else {
      paintRestPattern(ctx, x, barY, segmentWidth, barHeight);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, barY + 0.5, Math.max(1, segmentWidth - 1), barHeight - 1);

    if (segmentWidth >= 18) {
      ctx.save();
      ctx.translate(x + segmentWidth / 2, barY + barHeight - 14);
      ctx.rotate(-Math.PI / 2);
      paintExportText(ctx, noteLabel(cell), 0, 0, barHeight - 22, segmentWidth >= 34 ? 12 : 10);
      ctx.restore();
    }

    x += segmentWidth + gap * scale;
  });

  ctx.strokeStyle = "rgba(245,240,230,0.28)";
  ctx.beginPath();
  ctx.moveTo(padding, barY + barHeight + 22);
  ctx.lineTo(width - padding, barY + barHeight + 22);
  ctx.stroke();

  paintExportText(ctx, "wavelength colors mapped from typed notes", padding, height - 40, width - padding * 2, 12);
  return canvas;
}

function paintMatrixExport(matrixRows: (MusicCell | null)[][], matrixSize: number) {
  const gap = matrixSize > 80 ? 1 : 2;
  const padding = 44;
  const headerHeight = 112;
  const cellSize = clamp(Math.floor(2200 / matrixSize), 5, 132);
  const gridSize = matrixSize * cellSize + Math.max(0, matrixSize - 1) * gap;
  const width = gridSize + padding * 2;
  const height = headerHeight + gridSize + padding;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  ctx.scale(dpr, dpr);
  paintExportBackground(ctx, width, height);
  paintExportHeader(ctx, "music color matrix", `${matrixSize} x ${matrixSize}`, width);

  matrixRows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const x = padding + columnIndex * (cellSize + gap);
      const y = headerHeight + rowIndex * (cellSize + gap);

      if (cell?.kind === "note") {
        paintNoteRect(ctx, cell, x, y, cellSize, cellSize);
      } else if (cell?.kind === "rest") {
        paintRestPattern(ctx, x, y, cellSize, cellSize);
      } else {
        ctx.fillStyle = "rgba(245,240,230,0.05)";
        ctx.fillRect(x, y, cellSize, cellSize);
      }

      ctx.strokeStyle = "rgba(255,255,255,0.13)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);

      if (cellSize < 42 || !cell) return;

      if (cell.kind === "note") {
        paintExportText(
          ctx,
          cell.normalized,
          x + 8,
          y + cellSize - 42,
          cellSize - 16,
          Math.min(20, Math.max(11, cellSize * 0.18)),
        );
        if (cellSize >= 56) {
          paintExportText(ctx, `${Math.round(cell.wavelength)} nm`, x + 8, y + cellSize - 24, cellSize - 16, 10);
        }
        if (cellSize >= 76) {
          paintExportText(ctx, cell.color, x + 8, y + cellSize - 11, cellSize - 16, 9);
        }
      } else {
        paintExportText(ctx, "rest", x + 8, y + cellSize - 24, cellSize - 16, 12);
      }
    });
  });

  return canvas;
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  return new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("empty image"));
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 250);
      resolve();
    }, "image/png");
  });
}
