#!/usr/bin/env python3
"""Pixel-level density metrics for one room's guide screenshot JPG.

Called by scripts/test-room-visual.mjs as:

    python3 room-visual-metrics.py <path-to-jpg>

Prints a single JSON object to stdout with the four measurements that
require reading pixels (file size, the fifth check, is read straight off
disk by the caller — no need to shell out for that one):

  hue_buckets      int   — of the 24 hue buckets (15° each, 360° total),
                           how many hold >= 1% of the image's total pixel
                           mass. PIL's HSV conversion assigns hue 0 to any
                           achromatic pixel (R==G==B), so a black or grey
                           background does not scatter fake mass across
                           many buckets — it just piles into bucket 0 with
                           everything else that has no real hue, which is
                           exactly the honest outcome for a page that is
                           genuinely grayscale.
  luminance_range  float — p90(Y') - p10(Y'), Y' = .2126R + .7152G + .0722B
  edge_fraction    float — fraction of pixels whose Sobel gradient
                           magnitude (over Y') exceeds 40
  spatial_entropy  float — Shannon entropy, in bits, of a 60x40 box-filter
                           downsample of the luminance channel, histogrammed
                           over the 256 8-bit levels

This is deliberately a thin, single-purpose script: it does one JPG per
invocation so the Node side can report per-room progress and keep the
subprocess boundary simple (argv in, JSON out, no shared state).
"""
import json
import os
import sys

import numpy as np
from PIL import Image


def main() -> None:
    path = sys.argv[1]
    img = Image.open(path).convert("RGB")
    rgb = np.asarray(img, dtype=np.float64)
    total_pixels = rgb.shape[0] * rgb.shape[1]

    # --- 1. hue diversity ---------------------------------------------------
    hsv = np.asarray(img.convert("HSV"), dtype=np.float64)
    hue_deg = hsv[..., 0] * (360.0 / 255.0)
    bucket_idx = (np.floor(hue_deg / 15.0).astype(np.int64)) % 24
    counts = np.bincount(bucket_idx.flatten(), minlength=24)
    mass = counts / total_pixels
    hue_buckets = int(np.sum(mass >= 0.01))

    # --- 2. luminance range --------------------------------------------------
    y = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    p10, p90 = np.percentile(y, [10, 90])
    luminance_range = float(p90 - p10)

    # --- 3. edge density (Sobel over Y') -------------------------------------
    padded = np.pad(y, 1, mode="edge")
    gx = (
        (padded[0:-2, 2:] - padded[0:-2, :-2])
        + 2 * (padded[1:-1, 2:] - padded[1:-1, :-2])
        + (padded[2:, 2:] - padded[2:, :-2])
    )
    gy = (
        (padded[2:, 0:-2] + 2 * padded[2:, 1:-1] + padded[2:, 2:])
        - (padded[0:-2, 0:-2] + 2 * padded[0:-2, 1:-1] + padded[0:-2, 2:])
    )
    mag = np.sqrt(gx * gx + gy * gy)
    edge_fraction = float(np.mean(mag > 40))

    # --- 4. spatial entropy (60x40 box-downsample of luminance) -------------
    small = img.convert("L").resize((60, 40), Image.Resampling.BOX)
    levels = np.asarray(small, dtype=np.int64).flatten()
    hist = np.bincount(levels, minlength=256).astype(np.float64)
    probs = hist[hist > 0] / levels.size
    spatial_entropy = float(-np.sum(probs * np.log2(probs)))

    print(json.dumps({
        "hue_buckets": hue_buckets,
        "luminance_range": round(luminance_range, 2),
        "edge_fraction": round(edge_fraction, 4),
        "spatial_entropy": round(spatial_entropy, 3),
    }))


if __name__ == "__main__":
    main()
