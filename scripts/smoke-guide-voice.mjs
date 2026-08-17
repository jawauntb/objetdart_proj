// Visual smoke for the guide's two voices and the ? sheet's spacing.
//
// Needs a served build (dev or start):
//   node scripts/smoke-guide-voice.mjs [--base=http://localhost:3000]
//
// Checks, at 390px:
//   - the ? sheet's essence carries no pretext-wrapped words and its spaces
//     render at one true width (the "ofpale / dwellplantsa" regression);
//   - the sheet defaults to plain words, flips to field notes, and persists
//     the choice at objetdart:guide-voice:v1;
//   - /guide honors a stored voice pre-paint, defaults fresh visitors to
//     plain, and flips live without a reload.
// Screenshots land in iterations/guide-voice/.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = process.env.BASE_URL || (baseArg ? baseArg.slice("--base=".length) : "http://localhost:3000");
const OUT_DIR = "iterations/guide-voice";
mkdirSync(OUT_DIR, { recursive: true });

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "ok " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});

async function openHelp() {
  const help = page.locator('button[aria-label="how to hold this room"]');
  await help.waitFor({ state: "visible", timeout: 30_000 });
  await help.click();
  await page.locator(".oda-help-essence").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(2000);
}

function measureEssenceSpacing() {
  return page.evaluate(() => {
    const p = document.querySelector(".oda-help-essence");
    const widths = [];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const s = node.nodeValue ?? "";
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== " ") continue;
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        const w = r.getBoundingClientRect().width;
        if (w > 0) widths.push(w);
      }
    }
    return {
      wrappedWordSpans: p.querySelectorAll(".global-pretext-text").length,
      minSpace: Math.min(...widths),
      maxSpace: Math.max(...widths),
    };
  });
}

// --- the ? sheet on a room -------------------------------------------------

await page.goto(`${BASE}/tide`, { waitUntil: "networkidle", timeout: 90_000 });
await page.evaluate(() => localStorage.removeItem("objetdart:guide-voice:v1"));
await page.waitForTimeout(1000);
await openHelp();

const spacing = await measureEssenceSpacing();
check(spacing.wrappedWordSpans === 0, `sheet essence carries no pretext spans (${spacing.wrappedWordSpans})`);
check(
  spacing.maxSpace - spacing.minSpace < 1,
  `sheet spaces render at one width (${spacing.minSpace}–${spacing.maxSpace}px)`,
);

const defaultVoice = await page.evaluate(() =>
  [...document.querySelectorAll(".oda-help-voice-option")].map(
    (b) => `${b.textContent.trim()}=${b.getAttribute("aria-pressed")}`,
  ),
);
check(defaultVoice.includes("plain words=true"), `a fresh visitor reads plain words (${defaultVoice})`);
await page.screenshot({ path: `${OUT_DIR}/help-modal-390-tide-plain.png` });

await page.locator(".oda-help-voice-option", { hasText: "field notes" }).click();
await page.waitForTimeout(300);
const stored = await page.evaluate(() => localStorage.getItem("objetdart:guide-voice:v1"));
check(stored === "field", `the choice persists at objetdart:guide-voice:v1 (${stored})`);
const fieldSummaries = await page.evaluate(() =>
  [...document.querySelectorAll(".oda-help-summary")].map((s) => s.textContent.trim()),
);
check(fieldSummaries.includes("moves"), `field notes bring the room's own register back (${fieldSummaries})`);
await page.screenshot({ path: `${OUT_DIR}/help-modal-390-tide-field.png` });

// --- /guide ------------------------------------------------------------------

await page.goto(`${BASE}/guide`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(800);
const storedAttr = await page.evaluate(() => document.documentElement.getAttribute("data-guide-voice"));
check(storedAttr === "field", `/guide honors the stored voice pre-paint (${storedAttr})`);

await page.evaluate(() => localStorage.removeItem("objetdart:guide-voice:v1"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const fresh = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute("data-guide-voice"),
  wrappedSpansInGuide: document.querySelector(".guide").querySelectorAll(".global-pretext-text").length,
  bindingCell: document.querySelector(".guide-bindings td")?.innerText?.slice(0, 40) ?? "",
}));
check(fresh.attr === "plain" || fresh.attr === null, `/guide defaults a fresh visitor to plain (${fresh.attr})`);
check(fresh.wrappedSpansInGuide === 0, `the guide column carries no pretext spans (${fresh.wrappedSpansInGuide})`);
check(fresh.bindingCell.startsWith("touch the screen once"), `the bindings table reads plain (${fresh.bindingCell})`);
await page.screenshot({ path: `${OUT_DIR}/guide-390-plain.png` });

await page.locator(".guide-voice-toggle button", { hasText: "field notes" }).click();
await page.waitForTimeout(300);
const flipped = await page.evaluate(
  () => document.querySelector(".guide-bindings td")?.innerText?.slice(0, 40) ?? "",
);
check(flipped.startsWith("touch the material"), `the flip lands without a reload (${flipped})`);
await page.screenshot({ path: `${OUT_DIR}/guide-390-field.png` });

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed`);
  process.exit(1);
}
console.log(`\nguide-voice smoke ok — screenshots in ${OUT_DIR}/`);
