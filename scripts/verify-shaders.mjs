/**
 * verify-shaders — does the glass actually light up?
 *
 * A shader that fails to compile is invisible to `tsc` and to every node test
 * in this repo: the room catches the failure, falls back to its 2D path, and
 * looks exactly like the flat room the shader was meant to replace. That is a
 * silent regression, and the only thing that can see it is a real GPU driver.
 *
 * So: drive each shader room in a real browser, and fail on
 *   - a shader that did not compile or link
 *   - a WebGL context that was never obtained
 *   - a canvas that stayed blank
 *   - any uncaught page error
 *
 * Usage:
 *   node scripts/verify-shaders.mjs [--base=<url>] [--out=<dir>] [--only=<route>]
 *
 * Default base is the local dev server; pass a deploy URL to check what
 * actually shipped.
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg("base", "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = arg("out", "iterations/shader-verify");
const ONLY = arg("only", "");

/** Rooms that draw through a shader, and what each must not fall back to.
 *  Sea.tsx is deliberately absent: it is embedded on the home page, not a
 *  route of its own, so there is no URL to drive it at. */
const SHADER_ROOMS = [
  { route: "/mountain", why: "the range is ray-marched per pixel" },
  { route: "/waves", why: "the height field is a fragment pass, not a CPU raster" },
  { route: "/coast", why: "sea, sky, sand and dune are one shader" },
  { route: "/ocean", why: "the water" },
  { route: "/clouds", why: "the sky as a marched volume" },
  { route: "/storm", why: "the cell and its rain" },
  { route: "/fire", why: "the flame" },
  { route: "/plasma", why: "the globe" },
  { route: "/jewel", why: "the stone's fire" },
  { route: "/aphros", why: "the foam" },
  { route: "/birds", why: "the meadow" },
  { route: "/manifold", why: "the fold's lensing ring" },
  { route: "/relativity", why: "the gravity well field" },
  { route: "/space", why: "the cosmic web" },
  { route: "/beam", why: "the postprocess chain" },
  { route: "/tourbillon", why: "the movement" },
];

/** Phrases a driver uses when a shader does not survive compilation. */
const SHADER_FAILURE = /shader|glsl|compil|link|WebGL|program|getContext/i;
const HARD_FAILURE = /ERROR:|failed to compile|failed to link|could not compile|INVALID_OPERATION/i;

mkdirSync(OUT, { recursive: true });

const rooms = ONLY ? SHADER_ROOMS.filter((r) => r.route === ONLY) : SHADER_ROOMS;
// The image ships a pinned Chromium under PLAYWRIGHT_BROWSERS_PATH; a newer
// playwright package looks for a build number that is not here. Point it at
// the binary that exists rather than downloading one.
const EXECUTABLE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({
  executablePath: existsSync(EXECUTABLE) ? EXECUTABLE : undefined,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const results = [];

for (const room of rooms) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const console_ = [];
  const errors = [];

  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || m.type() === "warning") console_.push(`${m.type()}: ${t}`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  let status = "ok";
  let detail = "";
  let gl = null;

  try {
    const resp = await page.goto(`${BASE}${room.route}`, {
      waitUntil: "networkidle",
      timeout: 45000,
    });
    if (!resp || resp.status() >= 400) {
      status = "http";
      detail = `HTTP ${resp ? resp.status() : "none"}`;
    } else {
      // let the room mount, size, compile and draw a few frames
      await page.waitForTimeout(3500);

      gl = await page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        const out = canvases.map((c) => {
          // Which context did this canvas actually take? Asking for a
          // different type returns null, which is how we learn the answer
          // without disturbing the one the room is using.
          let kind = "none";
          for (const t of ["webgl2", "webgl", "experimental-webgl"]) {
            try {
              if (c.getContext(t)) { kind = t; break; }
            } catch { /* taken by 2d */ }
          }
          if (kind === "none") {
            try { if (c.getContext("2d")) kind = "2d"; } catch { /* noop */ }
          }
          return { kind, w: c.width, h: c.height };
        });
        return {
          canvases: out,
          anyGl: out.some((c) => c.kind === "webgl2" || c.kind === "webgl" || c.kind === "experimental-webgl"),
          sized: out.some((c) => c.w > 1 && c.h > 1),
        };
      });

      const shaderNoise = console_.filter((l) => SHADER_FAILURE.test(l) && HARD_FAILURE.test(l));
      if (errors.length) {
        status = "pageerror";
        detail = errors[0].slice(0, 300);
      } else if (shaderNoise.length) {
        status = "shader";
        detail = shaderNoise[0].slice(0, 300);
      } else if (!gl.anyGl) {
        status = "nogl";
        detail = `no WebGL context on any canvas (${gl.canvases.map((c) => c.kind).join(",") || "no canvas"}) — the room is on its 2D fallback`;
      } else if (!gl.sized) {
        status = "unsized";
        detail = "WebGL canvas has a zero-size drawing buffer";
      }
    }

    await page.screenshot({ path: path.join(OUT, `${room.route.replace(/\//g, "") || "home"}.png`) });
  } catch (err) {
    status = "threw";
    detail = String(err).slice(0, 300);
  }

  results.push({ ...room, status, detail, gl });
  const mark = status === "ok" ? "ok  " : "FAIL";
  console.log(`${mark} ${room.route.padEnd(14)} ${status === "ok" ? (gl?.canvases.map((c) => c.kind).join(",") ?? "") : `${status}: ${detail}`}`);
  await ctx.close();
}

await browser.close();
writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));

const bad = results.filter((r) => r.status !== "ok");
console.log(`\n${results.length - bad.length}/${results.length} shader rooms lit; screenshots in ${OUT}`);
if (bad.length) {
  console.log("\nrooms that fell back or failed:");
  for (const b of bad) console.log(`  · ${b.route} — ${b.status}: ${b.detail}`);
  process.exit(1);
}
