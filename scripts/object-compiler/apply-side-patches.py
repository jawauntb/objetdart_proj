#!/usr/bin/env python3
"""
apply-side-patches.py — auto-apply the four side-file patches every new room
                        needs, so the compiler is autonomous on the shared code.

Companion to:
    docs/plans/object-compiler.md   (M3/M4 followup — Track A of phase 2)
    data/object-compiler/audits/spring-e2e.md   §Followups
    data/object-compiler/audits/geyser-e2e.md   §Followups

For every landed room the compiler produces, four files that live *outside*
`src/rooms/<key>/` and `src/components/<Room>.tsx` must also be edited:

    1. src/rooms/registry.ts        — import + ROOM_MANIFESTS entry
    2. src/lib/room-registry.ts     — ROOM_REGISTRY entry (contract row)
    3. src/lib/scale.ts             — LATERAL_ROUTE_BANDS entry (peer only)
    4. scripts/test-routes.mjs      — expectedKeys entry

Each is a small, mechanical, alphabetical insertion at a sentinel line. This
script performs all four in one pass, idempotently, with atomic writes.

Design:
    * Find-marker + insert. No TS parsing.
    * Sentinel lines that already exist in each file mark the insertion zone;
      absence of the sentinel is a hard error.
    * Idempotent: re-running is a no-op if every entry is already present.
    * Atomic: each file is written to a temp file in the same directory and
      renamed into place.
    * Stdlib only (Python 3.10+).

Usage:
    scripts/object-compiler/apply-side-patches.py \\
        --spec object-compiler/schema/examples/spring.yaml \\
        [--repo /Users/jawaun/objetdart_proj] \\
        [--dry-run] \\
        [--verify]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


REPO_DEFAULT = Path("/Users/jawaun/objetdart_proj")


# ---------------------------------------------------------------------------
# YAML — reuse the mini-parser shape from render-template.py so we depend on
# stdlib only. PyYAML is preferred when present.
# ---------------------------------------------------------------------------

def load_yaml(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(text)
    except ImportError:
        data = _mini_yaml_parse(text)
    if not isinstance(data, dict):
        raise SystemExit(f"spec at {path} did not parse to a mapping")
    return data


def _mini_yaml_parse(text: str) -> Any:
    """Minimal YAML subset — enough for the fields we read from a room spec."""
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        stripped = raw.split("#", 1)[0].rstrip() if not _in_string(raw) else raw.rstrip()
        if not stripped.strip():
            continue
        indent = len(stripped) - len(stripped.lstrip(" "))
        lines.append((indent, stripped.strip()))
    pos = [0]

    def parse_block(base_indent: int) -> Any:
        if pos[0] >= len(lines):
            return None
        indent, first = lines[pos[0]]
        if indent < base_indent:
            return None
        if first.startswith("- "):
            return parse_list(base_indent)
        return parse_map(base_indent)

    def parse_map(base_indent: int) -> dict:
        out: dict[str, Any] = {}
        while pos[0] < len(lines):
            indent, line = lines[pos[0]]
            if indent < base_indent:
                break
            if indent > base_indent:
                raise SystemExit(f"mini-YAML: unexpected indent at {line!r}")
            if ":" not in line:
                raise SystemExit(f"mini-YAML: expected key: value at {line!r}")
            key, _, rest = line.partition(":")
            key = key.strip()
            rest = rest.strip()
            pos[0] += 1
            if rest == "|" or rest == ">":
                block_lines: list[str] = []
                block_indent = None
                while pos[0] < len(lines):
                    ii, ll = lines[pos[0]]
                    if ii <= base_indent:
                        break
                    if block_indent is None:
                        block_indent = ii
                    block_lines.append(" " * (ii - block_indent) + ll)
                    pos[0] += 1
                joiner = "\n" if rest == "|" else " "
                out[key] = joiner.join(block_lines)
            elif rest == "":
                out[key] = parse_block(base_indent + 2) if pos[0] < len(lines) else None
            else:
                out[key] = _mini_scalar(rest)
        return out

    def parse_list(base_indent: int) -> list:
        out: list[Any] = []
        while pos[0] < len(lines):
            indent, line = lines[pos[0]]
            if indent < base_indent or not line.startswith("- "):
                break
            rest = line[2:].strip()
            pos[0] += 1
            if rest == "":
                out.append(parse_block(base_indent + 2))
            elif ":" in rest and not rest.startswith(('"', "'")):
                key, _, val = rest.partition(":")
                mp: dict[str, Any] = {}
                v = val.strip()
                if v:
                    mp[key.strip()] = _mini_scalar(v)
                sub = parse_map(base_indent + 2)
                mp.update(sub)
                out.append(mp)
            else:
                out.append(_mini_scalar(rest))
        return out

    def _mini_scalar(s: str) -> Any:
        if s.startswith('"') and s.endswith('"'):
            return s[1:-1].encode("utf-8").decode("unicode_escape")
        if s.startswith("'") and s.endswith("'"):
            return s[1:-1]
        if s in ("true", "True"):
            return True
        if s in ("false", "False"):
            return False
        if s in ("null", "~", ""):
            return None
        try:
            if "." in s or "e" in s or "E" in s:
                return float(s)
            return int(s)
        except ValueError:
            return s

    return parse_block(0)


def _in_string(line: str) -> bool:
    q = 0
    for ch in line:
        if ch == '"':
            q ^= 1
    return q == 1


# ---------------------------------------------------------------------------
# Spec helpers — the shape the patches read.
# ---------------------------------------------------------------------------

def pascal_case(key: str) -> str:
    parts = re.split(r"[-_\s]+", key)
    return "".join(p[:1].upper() + p[1:] for p in parts if p)


def article_for(noun: str) -> str:
    """`a X` vs `an X` — English article by first-letter vowel test.
    Not perfect (an hour vs. a horse) but the compiler's nouns don't hit those
    edges; keep it dumb and mechanical."""
    if not noun:
        return "a"
    return "an" if noun[0].lower() in "aeiou" else "a"


# ---------------------------------------------------------------------------
# Atomic writes.
# ---------------------------------------------------------------------------

def atomic_write(path: Path, content: str) -> None:
    """Write to a sibling temp file and rename into place. Preserves the
    directory's file so a concurrent read never sees a half-written buffer."""
    d = path.parent
    d.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(d))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


# ---------------------------------------------------------------------------
# Result reporting.
# ---------------------------------------------------------------------------

@dataclass
class PatchResult:
    file: str
    status: str          # "patched" | "already-present" | "skipped" | "error"
    detail: str = ""
    diff_preview: str = ""


@dataclass
class ApplyReport:
    results: list[PatchResult] = field(default_factory=list)

    def add(self, r: PatchResult) -> None:
        self.results.append(r)

    def touched(self) -> list[str]:
        return [r.file for r in self.results if r.status == "patched"]

    def any_errors(self) -> bool:
        return any(r.status == "error" for r in self.results)


# ---------------------------------------------------------------------------
# 1. src/rooms/registry.ts — import + ROOM_MANIFESTS array.
# ---------------------------------------------------------------------------

REGISTRY_IMPORT_RE = re.compile(
    r'^import (\w+) from "@/rooms/[\w-]+/room\.config";$',
    re.MULTILINE,
)

REGISTRY_ARRAY_RE = re.compile(
    r"(export const ROOM_MANIFESTS = \[)(?P<body>.*?)(\] as const;)",
    re.DOTALL,
)


def apply_registry_ts(spec: dict, repo: Path, dry_run: bool) -> PatchResult:
    """Patch `src/rooms/registry.ts` — add the import line and the array entry
    for `spec.key`, both alphabetically.

    Sentinels used:
      - the block of `import <key> from "@/rooms/<key>/room.config";` lines,
        matched by regex
      - `export const ROOM_MANIFESTS = [ ... ] as const;`
    """
    path = repo / "src" / "rooms" / "registry.ts"
    if not path.exists():
        return PatchResult(str(path), "error", "file not found")
    key = str(spec["key"])
    text = path.read_text(encoding="utf-8")

    import_line = f'import {key} from "@/rooms/{key}/room.config";'
    array_entry = f"  {key},"

    # ── the import ────────────────────────────────────────────────────────
    imports = REGISTRY_IMPORT_RE.findall(text)
    if not imports:
        return PatchResult(str(path), "error",
                           "no `import … from \"@/rooms/…/room.config\"` lines found")

    import_present = key in imports

    if not import_present:
        merged = sorted(set(imports) | {key})
        idx = merged.index(key)
        if idx == 0:
            # insert before the first existing import
            anchor = f'import {imports_sorted_first(imports)} from "@/rooms/{imports_sorted_first(imports)}/room.config";'
            new_text = text.replace(anchor, f"{import_line}\n{anchor}", 1)
        else:
            anchor_key = merged[idx - 1]
            anchor = f'import {anchor_key} from "@/rooms/{anchor_key}/room.config";'
            new_text = text.replace(anchor, f"{anchor}\n{import_line}", 1)
    else:
        new_text = text

    # ── the ROOM_MANIFESTS array entry ───────────────────────────────────
    m = REGISTRY_ARRAY_RE.search(new_text)
    if not m:
        return PatchResult(str(path), "error",
                           "no `export const ROOM_MANIFESTS = [ ... ] as const;` block found")
    body = m.group("body")
    # Parse entries preserving their trailing commas.
    entries = [ln.strip().rstrip(",") for ln in body.strip().splitlines() if ln.strip().rstrip(",")]

    entry_present = key in entries

    if not entry_present:
        merged_entries = sorted(set(entries) | {key})
        new_body = "\n  " + ",\n  ".join(merged_entries) + ",\n"
        new_text = new_text.replace(m.group(0),
                                    f"{m.group(1)}{new_body}{m.group(3)}", 1)

    if import_present and entry_present:
        return PatchResult(str(path), "already-present",
                           f"{key} already in imports and ROOM_MANIFESTS")

    detail = []
    if not import_present:
        detail.append("added import")
    if not entry_present:
        detail.append("added ROOM_MANIFESTS entry")
    diff = ""
    if not import_present:
        diff += f"+ {import_line}\n"
    if not entry_present:
        diff += f"+   {key},   (in ROOM_MANIFESTS)\n"
    if dry_run:
        return PatchResult(str(path), "patched", ", ".join(detail) + " [dry-run]", diff)
    atomic_write(path, new_text)
    return PatchResult(str(path), "patched", ", ".join(detail), diff)


def imports_sorted_first(imports: list[str]) -> str:
    """The first import in current *file order* — not alphabetically. Used
    as an anchor when the new key sorts before every existing one."""
    return imports[0]


# ---------------------------------------------------------------------------
# 2. src/lib/room-registry.ts — ROOM_REGISTRY entry.
# ---------------------------------------------------------------------------

# The sentinel comment above the alphabetical manifest-spread section. Every
# entry after this comment is a manifest-spread room and their `key` fields
# sort alphabetically. New entries go in alphabetical order within this block.
ROOM_REGISTRY_SECTION_MARKER = "// Manifest-spread rooms at the SITE_ROUTES tail"

# End of the ROOM_REGISTRY array — the closing bracket `];` at column 0 (or
# indented to match `export const ROOM_REGISTRY: RoomEntry[] = [`).
ROOM_REGISTRY_CLOSE_RE = re.compile(
    r"^\];",
    re.MULTILINE,
)


def apply_room_registry_ts(spec: dict, repo: Path, dry_run: bool) -> PatchResult:
    """Patch `src/lib/room-registry.ts` — insert one RoomEntry into the
    alphabetical manifest-spread section at the tail of ROOM_REGISTRY.

    Sentinel: `// Manifest-spread rooms at the SITE_ROUTES tail`
    """
    path = repo / "src" / "lib" / "room-registry.ts"
    if not path.exists():
        return PatchResult(str(path), "error", "file not found")

    key = str(spec["key"])
    text = path.read_text(encoding="utf-8")

    # Idempotency guard.
    if re.search(r'^\s*key:\s*"' + re.escape(key) + r'"', text, re.MULTILINE):
        return PatchResult(str(path), "already-present",
                           f'"{key}" already appears in ROOM_REGISTRY')

    if ROOM_REGISTRY_SECTION_MARKER not in text:
        return PatchResult(str(path), "error",
                           f"sentinel not found: {ROOM_REGISTRY_SECTION_MARKER!r}")

    # Build the entry from spec.
    entry_text = _room_registry_entry(spec)

    # Walk the entries *after* the sentinel to find the alphabetical insertion
    # point. Each entry is `  { ... key: "<name>", ... },` — we split by looking
    # for the top-level `{` at column 2 (two-space indent).
    lines = text.splitlines(keepends=True)
    marker_line_idx = _find_line_starting_with(lines, ROOM_REGISTRY_SECTION_MARKER)
    if marker_line_idx is None:
        return PatchResult(str(path), "error",
                           f"marker line not found in split lines: {ROOM_REGISTRY_SECTION_MARKER!r}")

    # Find every entry-opening line "  {" after the marker.
    entry_starts: list[int] = []
    for i in range(marker_line_idx + 1, len(lines)):
        stripped = lines[i].rstrip("\n")
        if stripped == "  {":
            entry_starts.append(i)
        elif stripped == "];":
            # end of ROOM_REGISTRY array
            close_idx = i
            break
    else:
        return PatchResult(str(path), "error",
                           "reached EOF before finding ROOM_REGISTRY closing `];`")

    # Pull each entry's key by looking two lines ahead of its `{`.
    entries: list[tuple[int, str]] = []  # (start_line, key)
    for start in entry_starts:
        entry_key = None
        for j in range(start, min(start + 4, len(lines))):
            m = re.match(r'\s*key:\s*"([^"]+)"', lines[j])
            if m:
                entry_key = m.group(1)
                break
        if entry_key is None:
            return PatchResult(str(path), "error",
                               f"could not read key: from entry at line {start + 1}")
        entries.append((start, entry_key))

    # Find alphabetical predecessor / successor.
    keys_after = [ek for _, ek in entries]
    all_keys = sorted(set(keys_after) | {key})
    pos = all_keys.index(key)

    if pos == 0:
        # Insert before the first entry in this section.
        if entries:
            insert_at = entries[0][0]
        else:
            insert_at = close_idx
    else:
        prev_key = all_keys[pos - 1]
        prev_start = None
        for i, (start, ek) in enumerate(entries):
            if ek == prev_key:
                prev_start = start
                # find the closing `},` for this entry
                for j in range(start, close_idx):
                    if lines[j].rstrip("\n") == "  },":
                        prev_end = j
                        break
                else:
                    return PatchResult(str(path), "error",
                                       f"could not find closing `  }},` for entry `{prev_key}`")
                insert_at = prev_end + 1
                break
        else:
            insert_at = close_idx

    new_lines = lines[:insert_at] + [entry_text] + lines[insert_at:]
    new_text = "".join(new_lines)

    detail = f"inserted `{key}` RoomEntry (alphabetical among manifest-spread rooms)"
    diff = _first_lines(entry_text, 4).replace("\n", "\n+ ").rstrip("+ ")
    diff = "+ " + diff
    if dry_run:
        return PatchResult(str(path), "patched", detail + " [dry-run]", diff)
    atomic_write(path, new_text)
    return PatchResult(str(path), "patched", detail, diff)


def _room_registry_entry(spec: dict) -> str:
    """Render the ROOM_REGISTRY entry for a spec. Fields:

        key       — spec.key
        href      — /<key>
        kind      — "room" (manifest-spread rooms are always room-kind)
        source    — src/components/<Component>.tsx
        page      — src/app/<key>/page.tsx
        address   — { band: "<band>" } (from spec.placement.band)
        frame     — "yield" (default for consolidated rooms; ScaleTravel owns)
        chrome    — "axis" (default for compiler-generated rooms — spring/geyser/atmosphere/…)
        keeps     — spec.storage_key, or null if room does not persist
        creates   — "a <noun>" or "an <noun>" from spec.noun
        exempt    — {}  (verbs_answered covers the grammar or extra bindings need hand review)
    """
    key = str(spec["key"])
    component = pascal_case(key)
    placement = spec.get("placement") or {}
    band = str(placement.get("band") or "drop")
    storage_key = spec.get("storage_key")
    noun = str(spec.get("noun") or "").strip()

    if storage_key:
        keeps_field = f'"{storage_key}"'
    else:
        keeps_field = "null"

    if noun:
        creates_field = f'"{article_for(noun)} {noun}"'
    else:
        creates_field = "null"

    # Chrome — the spec's `chrome:` block has `travel/peers` booleans; the
    # RoomEntry field is a single string. Every compiler-generated room in the
    # record uses "axis". We default to that; if the spec asked for something
    # else via `spec.chrome_style` we honor it verbatim.
    chrome = str(spec.get("chrome_style") or "axis")

    return (
        "  {\n"
        f'    key: "{key}",\n'
        f'    href: "/{key}",\n'
        f'    kind: "room",\n'
        f'    source: "src/components/{component}.tsx",\n'
        f'    page: "src/app/{key}/page.tsx",\n'
        f'    address: {{ band: "{band}" }},\n'
        f'    frame: "yield",\n'
        f'    chrome: "{chrome}",\n'
        f"    keeps: {keeps_field},\n"
        f"    creates: {creates_field},\n"
        f"    exempt: {{}},\n"
        "  },\n"
    )


def _find_line_starting_with(lines: list[str], substr: str) -> int | None:
    for i, ln in enumerate(lines):
        if substr in ln:
            return i
    return None


def _first_lines(text: str, n: int) -> str:
    return "\n".join(text.splitlines()[:n]) + "\n"


# ---------------------------------------------------------------------------
# 3. src/lib/scale.ts — LATERAL_ROUTE_BANDS entry.
# ---------------------------------------------------------------------------

SCALE_ARRAY_RE = re.compile(
    r"(export const LATERAL_ROUTE_BANDS: \{ prefix: string; band: ScaleBandId \}\[\] = \[)"
    r"(?P<body>.*?)"
    r"(^\];)",
    re.DOTALL | re.MULTILINE,
)


def apply_scale_ts(spec: dict, repo: Path, dry_run: bool) -> PatchResult:
    """Patch `src/lib/scale.ts` — add `{ prefix: "/<key>", band: "<band>" }`
    to `LATERAL_ROUTE_BANDS` when `spec.placement.kind == "peer"`.

    Sentinel: the `LATERAL_ROUTE_BANDS` array literal opening.

    Insertion: after the last entry whose band matches. If no entry with a
    matching band exists, append at the end.
    """
    path = repo / "src" / "lib" / "scale.ts"
    if not path.exists():
        return PatchResult(str(path), "error", "file not found")

    placement = spec.get("placement") or {}
    kind = placement.get("kind")
    if kind != "peer":
        return PatchResult(str(path), "skipped",
                           f"placement.kind is {kind!r} (LATERAL_ROUTE_BANDS is for peers only)")

    key = str(spec["key"])
    band = placement.get("band")
    if not band:
        return PatchResult(str(path), "error",
                           "peer placement is missing a `band`")

    text = path.read_text(encoding="utf-8")
    entry_line = f'  {{ prefix: "/{key}", band: "{band}" }},'

    # Idempotency guard.
    if re.search(r'prefix:\s*"/' + re.escape(key) + r'"', text):
        return PatchResult(str(path), "already-present",
                           f'"/{key}" already appears in LATERAL_ROUTE_BANDS')

    m = SCALE_ARRAY_RE.search(text)
    if not m:
        return PatchResult(str(path), "error",
                           "LATERAL_ROUTE_BANDS array not found")

    body = m.group("body")
    body_lines = body.splitlines()

    # Find the last line inside body whose `band: "<X>"` matches. Skip comment lines.
    band_line_re = re.compile(r'band:\s*"(' + re.escape(band) + r')"')
    last_match_idx: int | None = None
    for i, ln in enumerate(body_lines):
        if band_line_re.search(ln):
            last_match_idx = i

    if last_match_idx is None:
        # No entry with this band — append at the end of body.
        # body starts with a newline and ends with a newline before `];`.
        new_body = body.rstrip("\n") + "\n" + entry_line + "\n"
    else:
        # Insert immediately after the last matching line.
        insert_at = last_match_idx + 1
        new_body_lines = body_lines[:insert_at] + [entry_line] + body_lines[insert_at:]
        # Preserve trailing newline of the original body.
        trailing = "\n" if body.endswith("\n") else ""
        new_body = "\n".join(new_body_lines) + trailing

    new_text = text[:m.start()] + m.group(1) + new_body + m.group(3) + text[m.end():]

    detail = f'inserted `{{ prefix: "/{key}", band: "{band}" }}`'
    diff = f"+ {entry_line}\n"
    if dry_run:
        return PatchResult(str(path), "patched", detail + " [dry-run]", diff)
    atomic_write(path, new_text)
    return PatchResult(str(path), "patched", detail, diff)


# ---------------------------------------------------------------------------
# 4. scripts/test-routes.mjs — expectedKeys.
# ---------------------------------------------------------------------------

TEST_ROUTES_SECTION_MARKER = "// rooms that arrived through src/rooms/<key>/room.config.ts"

EXPECTED_KEYS_ARRAY_RE = re.compile(
    r"(const expectedKeys = \[)"
    r"(?P<body>.*?)"
    r"(^\];)",
    re.DOTALL | re.MULTILINE,
)


def apply_test_routes(spec: dict, repo: Path, dry_run: bool) -> PatchResult:
    """Patch `scripts/test-routes.mjs` — add `"<key>"` to `expectedKeys` inside
    the `// rooms that arrived through src/rooms/<key>/room.config.ts` section,
    alphabetically.
    """
    path = repo / "scripts" / "test-routes.mjs"
    if not path.exists():
        return PatchResult(str(path), "error", "file not found")

    key = str(spec["key"])
    text = path.read_text(encoding="utf-8")

    m = EXPECTED_KEYS_ARRAY_RE.search(text)
    if not m:
        return PatchResult(str(path), "error", "expectedKeys array not found")
    body = m.group("body")

    # Idempotency guard.
    body_lines = body.splitlines()
    quoted_key = f'"{key}"'

    if any(line.strip().rstrip(",") == quoted_key for line in body_lines):
        return PatchResult(str(path), "already-present",
                           f'"{key}" already appears in expectedKeys')

    # Find the marker line inside body.
    marker_idx: int | None = None
    for i, ln in enumerate(body_lines):
        if TEST_ROUTES_SECTION_MARKER in ln:
            marker_idx = i
            break
    if marker_idx is None:
        return PatchResult(str(path), "error",
                           f"sentinel not found in expectedKeys: {TEST_ROUTES_SECTION_MARKER!r}")

    # Everything after marker_idx up to (but not including) the last close is
    # the "manifest-spread" region.
    section_start = marker_idx + 1
    section = body_lines[section_start:]

    # Extract existing keys in the manifest-spread region.
    existing_keys: list[tuple[int, str]] = []  # (section-relative idx, key)
    for i, ln in enumerate(section):
        m2 = re.match(r'^\s*"([^"]+)",?\s*$', ln)
        if m2:
            existing_keys.append((i, m2.group(1)))

    all_keys = sorted(set(k for _, k in existing_keys) | {key})
    pos = all_keys.index(key)

    if pos == 0:
        # First in the section — insert immediately after the marker line.
        insert_body_idx = section_start
    else:
        prev_key = all_keys[pos - 1]
        prev_idx = None
        for si, ek in existing_keys:
            if ek == prev_key:
                prev_idx = si
        if prev_idx is None:
            insert_body_idx = section_start
        else:
            insert_body_idx = section_start + prev_idx + 1

    # Indent — match neighbours (two spaces is the convention).
    new_line = f'  "{key}",'
    new_body_lines = body_lines[:insert_body_idx] + [new_line] + body_lines[insert_body_idx:]
    trailing = "\n" if body.endswith("\n") else ""
    new_body = "\n".join(new_body_lines) + trailing
    new_text = text[:m.start()] + m.group(1) + new_body + m.group(3) + text[m.end():]

    detail = f'inserted `"{key}"` in expectedKeys (manifest-spread section, alphabetical)'
    diff = f"+ {new_line}\n"
    if dry_run:
        return PatchResult(str(path), "patched", detail + " [dry-run]", diff)
    atomic_write(path, new_text)
    return PatchResult(str(path), "patched", detail, diff)


# ---------------------------------------------------------------------------
# Driver.
# ---------------------------------------------------------------------------

def apply_all(spec: dict, repo: Path, dry_run: bool) -> ApplyReport:
    report = ApplyReport()
    for fn in (apply_registry_ts,
               apply_room_registry_ts,
               apply_scale_ts,
               apply_test_routes):
        try:
            report.add(fn(spec, repo, dry_run))
        except Exception as exc:
            report.add(PatchResult(fn.__name__, "error", str(exc)))
    return report


def verify_tsc(repo: Path, touched: list[str]) -> tuple[bool, str]:
    """Run `npx tsc --noEmit` restricted to touched files. We call `tsc` on
    the whole project because the shared registries reference each other; a
    file-scoped tsc invocation lies about broken types."""
    try:
        proc = subprocess.run(
            ["npx", "--no-install", "tsc", "--noEmit"],
            cwd=str(repo),
            capture_output=True,
            text=True,
            timeout=180,
        )
    except FileNotFoundError:
        return False, "npx not on PATH — install Node.js"
    except subprocess.TimeoutExpired:
        return False, "tsc timed out after 180s"
    if proc.returncode == 0:
        return True, "tsc clean"
    body = (proc.stdout + "\n" + proc.stderr).strip()
    return False, body


def _print_report(report: ApplyReport) -> None:
    for r in report.results:
        indicator = {
            "patched":         "✓",
            "already-present": "•",
            "skipped":         "-",
            "error":           "!",
        }.get(r.status, "?")
        print(f"  {indicator} {r.file}")
        print(f"      {r.status}: {r.detail}")
        if r.diff_preview:
            for line in r.diff_preview.splitlines():
                print(f"      {line}")


# ---------------------------------------------------------------------------
# CLI.
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="apply-side-patches.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--spec", required=True, type=Path,
                    help="path to the room spec.yaml")
    ap.add_argument("--repo", type=Path, default=REPO_DEFAULT,
                    help="repo root (default: %(default)s)")
    ap.add_argument("--dry-run", action="store_true",
                    help="preview each patch; do not write files")
    ap.add_argument("--verify", action="store_true",
                    help="after applying, run `npx tsc --noEmit` and report")
    args = ap.parse_args(argv)

    if not args.spec.exists():
        raise SystemExit(f"spec not found: {args.spec}")
    if not args.repo.exists():
        raise SystemExit(f"repo not found: {args.repo}")

    spec_root = load_yaml(args.spec)
    spec = spec_root["spec"] if isinstance(spec_root.get("spec"), dict) else spec_root
    if "key" not in spec:
        raise SystemExit("spec.key is required")

    print(f"apply-side-patches: /{spec['key']} into {args.repo}"
          + (" [dry-run]" if args.dry_run else ""))
    report = apply_all(spec, args.repo, args.dry_run)
    _print_report(report)

    if args.verify and not args.dry_run:
        touched = report.touched()
        if not touched:
            print("verify: nothing was patched, skipping tsc")
        else:
            print("verify: running `npx tsc --noEmit`…")
            ok, msg = verify_tsc(args.repo, touched)
            print(f"  {'✓' if ok else '!'} {msg[:2000]}")
            if not ok:
                return 2

    return 1 if report.any_errors() else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
