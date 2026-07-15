import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path, globals = {}) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, ...globals };
  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

function createExportHarness({ canShare, share }) {
  let linkClicks = 0;
  let shareCalls = 0;
  const context = {
    beginPath() {},
    closePath() {},
    fill() {},
    fillRect() {},
    lineTo() {},
    moveTo() {},
    quadraticCurveTo() {},
  };
  const canvas = {
    getContext: () => context,
    height: 0,
    toDataURL: () => "data:image/png;base64,AA==",
    width: 0,
  };
  const document = {
    body: { appendChild() {} },
    createElement(tagName) {
      if (tagName === "canvas") return canvas;
      if (tagName === "a") {
        return {
          click() {
            linkClicks += 1;
          },
          remove() {},
        };
      }
      throw new Error(`Unexpected element: ${tagName}`);
    },
  };
  class TestFile extends Blob {
    constructor(parts, name, options) {
      super(parts, options);
      this.name = name;
    }
  }
  const navigator = {
    canShare,
    async share(data) {
      shareCalls += 1;
      return share(data);
    },
  };
  const urlApi = {
    createObjectURL: () => "blob:dither-avatar-test",
    revokeObjectURL() {},
  };
  const avatarModule = loadTsModule("src/lib/dither-avatar.ts", {
    atob,
    Blob,
    document,
    DOMException,
    File: TestFile,
    navigator,
    Uint8Array,
    URL: urlApi,
    window: {
      setTimeout(callback) {
        callback();
        return 1;
      },
    },
  });

  return {
    avatarModule,
    linkClicks: () => linkClicks,
    shareCalls: () => shareCalls,
  };
}

const {
  DITHER_AVATAR_GRID_SIZE,
  DITHER_AVATAR_IMAGE_SIZE,
  avatarFilename,
  createDitherAvatar,
  normalizeDitherName,
} = loadTsModule("src/lib/dither-avatar.ts");

assert.equal(DITHER_AVATAR_GRID_SIZE, 7, "the identity mark should remain a 7 by 7 grid");
assert.equal(DITHER_AVATAR_IMAGE_SIZE, 512, "saved avatars should be exactly 512 pixels square");
assert.equal(normalizeDitherName("  Orla   Rae  "), "orla rae", "names should normalize consistently");
const normalizedEmoji = normalizeDitherName("🧿".repeat(30));
assert.equal(Array.from(normalizedEmoji).length, 24, "the visible name should cap at 24 code points");
assert.equal(Array.from(normalizedEmoji).at(-1), "🧿", "normalization should not split the final code point");
assert.equal(avatarFilename("  Orla   Rae  "), "dither-orla-rae.png", "downloads should have a safe, readable name");

const orla = createDitherAvatar("Orla");
const orlaAgain = createDitherAvatar("  orla ");
const dan = createDitherAvatar("dan");

assert.equal(orla.name, "orla");
assert.equal(orla.hue, orlaAgain.hue, "the same normalized name should keep its hue");
assert.deepEqual(orla.cells, orlaAgain.cells, "the same normalized name should keep its pattern");
assert.equal(orla.cells.length, DITHER_AVATAR_GRID_SIZE);
assert.ok(orla.cells.every((row) => row.length === DITHER_AVATAR_GRID_SIZE));
assert.ok(orla.cells.flat().some(Boolean), "a mark should contain lit cells");
assert.ok(orla.cells.flat().some((cell) => !cell), "a mark should retain negative space");
assert.notDeepEqual(orla.cells, dan.cells, "different names should normally produce different marks");

for (const row of orla.cells) {
  assert.deepEqual(row, [...row].reverse(), "every avatar row should mirror left to right");
}

const sharedHarness = createExportHarness({
  canShare: () => true,
  share: async () => {},
});
const shared = await sharedHarness.avatarModule.shareOrDownloadDitherAvatar("Orla Rae");
assert.equal(shared.outcome, "shared", "successful native sharing should be reported");
assert.equal(sharedHarness.shareCalls(), 1, "native sharing should open exactly once");
assert.equal(sharedHarness.linkClicks(), 0, "successful sharing should not download a duplicate");

const cancelledHarness = createExportHarness({
  canShare: () => true,
  share: async () => {
    throw new DOMException("Share dismissed", "AbortError");
  },
});
const cancelled = await cancelledHarness.avatarModule.shareOrDownloadDitherAvatar("Orla Rae");
assert.equal(cancelled.outcome, "cancelled", "dismissing native sharing should be reported as cancellation");
assert.equal(cancelledHarness.shareCalls(), 1, "the cancelled share should only open once");
assert.equal(cancelledHarness.linkClicks(), 0, "cancelling sharing should not force a download");

const unsupportedHarness = createExportHarness({
  canShare: () => false,
  share: async () => {
    throw new Error("share should not run when canShare is false");
  },
});
const unsupported = await unsupportedHarness.avatarModule.shareOrDownloadDitherAvatar("Orla Rae");
assert.equal(unsupported.outcome, "downloaded", "unsupported file sharing should fall back to download");
assert.equal(unsupportedHarness.shareCalls(), 0, "unsupported sharing should not invoke the share API");
assert.equal(unsupportedHarness.linkClicks(), 1, "the unsupported fallback should click one download link");

const failedHarness = createExportHarness({
  canShare: () => true,
  share: async () => {
    throw new Error("native share failed");
  },
});
const failed = await failedHarness.avatarModule.shareOrDownloadDitherAvatar("Orla Rae");
assert.equal(failed.outcome, "downloaded", "a native share failure should fall back to download");
assert.equal(failedHarness.shareCalls(), 1, "the failing native share should only be attempted once");
assert.equal(failedHarness.linkClicks(), 1, "a failed native share should click one fallback download link");

console.log("dither avatar identity ok");
