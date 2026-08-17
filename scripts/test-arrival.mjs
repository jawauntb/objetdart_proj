// The arrival invitation is the one volunteered explanation: a dismissable
// card on /manifold, remembered at objetdart:arrival:v1, never inside another
// room and never opening the chrome `?`. These assertions name the bugs they
// catch — a corrupt flag hiding the door, the card mounting in the wrong
// tree, RoomHelp growing a first-run fork.
//
// Copy is not snapshotted. Voice lives in the component; a wording change
// must not turn this file red.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function readRepoFile(path) {
  return readFileSync(new URL(path, rootUrl), "utf8");
}

function loadTsModule(path) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const { ARRIVAL_STORAGE_KEY, encodeArrivalDismissal, isArrivalDismissed } =
  loadTsModule("src/lib/arrival.ts");

// ---------------------------------------------------------------------------
// the on-disk contract: key and { dismissed: true }
// ---------------------------------------------------------------------------

assert.equal(
  ARRIVAL_STORAGE_KEY,
  "objetdart:arrival:v1",
  "the remembered key is the one the door writes — renaming it would re-invite everyone, or lose the silence",
);

const encoded = encodeArrivalDismissal();
const parsed = JSON.parse(encoded);
assert.equal(parsed.dismissed, true, "encode must persist dismissed as boolean true");
assert.equal(Object.keys(parsed).length, 1, "encode must persist only the dismissed flag");
assert.equal(typeof parsed.dismissed, "boolean", "dismissed must be a boolean, not a string");
assert.equal(isArrivalDismissed(encoded), true, "the codec must round-trip its own write");

assert.equal(isArrivalDismissed(null), false, "a missing key is a first visit");
assert.equal(isArrivalDismissed(undefined), false, "undefined is a first visit");
assert.equal(isArrivalDismissed(""), false, "an empty string is a first visit");
assert.equal(isArrivalDismissed("not-json"), false, "garbage must not hide the door");
assert.equal(isArrivalDismissed("true"), false, "a bare true is not the record");
assert.equal(isArrivalDismissed("{}"), false, "an empty object is not a dismissal");
assert.equal(isArrivalDismissed('{"dismissed":false}'), false, "dismissed:false is still invited");
assert.equal(isArrivalDismissed('{"dismissed":"true"}'), false, "a string true is not a dismissal");
assert.equal(isArrivalDismissed("[]"), false, "an array is not a dismissal");
assert.equal(isArrivalDismissed("null"), false, "json null is not a dismissal");
assert.equal(
  isArrivalDismissed('{"dismissed":true,"extra":1}'),
  true,
  "extra fields on a true dismissal still count — the flag is what matters",
);

// ---------------------------------------------------------------------------
// it lives on the manifold page, not in the fold, the help chrome, or layout
// ---------------------------------------------------------------------------

const page = readRepoFile("src/app/manifold/page.tsx");
const fold = readRepoFile("src/components/ManifoldFold.tsx");
const help = readRepoFile("src/components/RoomHelp.tsx");
const layout = readRepoFile("src/app/layout.tsx");
const invitation = readRepoFile("src/components/ArrivalInvitation.tsx");

assert.match(
  page,
  /ArrivalInvitation/,
  "src/app/manifold/page.tsx must mount the invitation — otherwise the door is silent",
);
assert.doesNotMatch(
  fold,
  /from ["']@\/components\/ArrivalInvitation|<ArrivalInvitation/,
  "ManifoldFold must not mount the invitation — copy does not sit on the canvas",
);
assert.doesNotMatch(
  help,
  /from ["']@\/components\/ArrivalInvitation|<ArrivalInvitation|objetdart:arrival/,
  "RoomHelp must not grow the invitation — the ? stays a mirror of /guide",
);
assert.doesNotMatch(
  layout,
  /from ["']@\/components\/ArrivalInvitation|<ArrivalInvitation/,
  "the root layout must not mount the invitation — other rooms would inherit a first-run card",
);

assert.match(
  invitation,
  /createPortal\([\s\S]*document\.body/,
  "ArrivalInvitation must portal to document.body — a room's fixed wrapper traps in-tree overlays",
);
assert.match(invitation, /role="dialog"/, "the invitation must be a dialog");
assert.match(invitation, /aria-modal="true"/, "the invitation must be modal to assistive tech");
assert.match(invitation, /aria-labelledby/, "the dialog must be labelled by its title");
assert.match(invitation, /Escape/, "Escape must dismiss");
assert.match(
  invitation,
  /prefers-reduced-motion/,
  "the breath and fade must honour prefers-reduced-motion",
);
assert.match(
  invitation,
  /readArrivalDismissed|ARRIVAL_STORAGE_KEY/,
  "dismissal must go through the arrival codec, not a private key",
);
assert.doesNotMatch(
  invitation,
  /objetdart:arrival:v1/,
  "the storage key lives in src/lib/arrival.ts so the codec and the write cannot drift",
);
assert.doesNotMatch(invitation, /\/group|\/eigen/, "the invitation must not name the law-rooms");
assert.doesNotMatch(
  invitation,
  /from ["']@\/components\/RoomHelp/,
  "the invitation must not import the chrome ?",
);

console.log("arrival ok: dismissal codec, manifold-only mount, help chrome untouched");
