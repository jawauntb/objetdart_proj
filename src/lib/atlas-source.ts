import type { AtlasClipRect } from "@/lib/atlas-batch";
import { cropAtlasDataUrl } from "@/lib/atlas-crop";

export type AtlasPreparedSource = {
  currentImage: string;
  sourceImageCropped: boolean;
};

export async function prepareAtlasSourceImage(
  currentImage: string,
  clip: AtlasClipRect,
): Promise<AtlasPreparedSource> {
  try {
    return {
      currentImage: await cropAtlasDataUrl(currentImage, clip),
      sourceImageCropped: true,
    };
  } catch {
    return { currentImage, sourceImageCropped: false };
  }
}
