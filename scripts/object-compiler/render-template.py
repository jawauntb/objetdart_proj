#!/usr/bin/env python3
"""
render-template.py — the deterministic half of the Object Compiler.

Reads a `spec.yaml` (the M2 schema instance for a room) and a directory of
`*.tmpl` files (M3 deliverables), writes the corresponding output files into
`--out-dir`, and leaves the three `__SLOT_*__` markers untouched for the
next stage (M4 `fill-slots.mjs`) to complete.

Contracts:
  - Every `{{spec.a.b.c}}` in a template MUST be resolvable in the spec.
    An unresolved substitution is a hard error — the site's law is that a
    room's manifest is complete.
  - `{{spec.field | as_list}}` renders a list of strings as a TypeScript
    array literal (pretty-printed, four-space indent).
  - `{{ComponentName}}` is derived from `spec.key` (PascalCase, splitting
    on `-` / `_`).
  - `__SLOT_*__` markers are LEFT IN THE OUTPUT verbatim. This script
    NEVER fills a slot; that is the LLM stage's job.
  - JSX `{{ ... }}` and TS `${...}` are left alone — the substitution
    regex only matches whitelisted forms.

Stdlib only. Requires Python 3.10+. If PyYAML is present it is used;
otherwise a tiny hand-written parser covers the M2 schema shape (nested
mappings, sequences of scalars/mappings, block scalars via `|`, plus the
strings/numbers/booleans/null the schema needs and nothing more).

Usage:
  scripts/object-compiler/render-template.py \\
      --spec object-compiler/schema/examples/atmosphere.spec.yaml \\
      --out-dir /tmp/render-out
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# YAML loading — PyYAML if present, else a small parser for the M2 schema.
# ---------------------------------------------------------------------------

def load_yaml(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(text)
    except ImportError:
        data = _mini_yaml_parse(text)
    if not isinstance(data, dict):
        raise SystemExit(f"spec file {path} did not parse to a mapping")
    return data


def _mini_yaml_parse(text: str) -> Any:
    """Very small YAML subset — mappings, sequences, scalars, `|` blocks.

    Not a general YAML parser. If a spec needs a feature this misses, install
    PyYAML (`pip install pyyaml`) and re-run.
    """
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        stripped = raw.split("#", 1)[0].rstrip() if not _in_string(raw) else raw.rstrip()
        if not stripped.strip():
            continue
        indent = len(stripped) - len(stripped.lstrip(" "))
        lines.append((indent, stripped.strip()))
    pos = [0]

    def parse_block(base_indent: int) -> Any:
        # Peek to decide list vs mapping.
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
            if rest == "|":
                # Block scalar — collect deeper-indented lines as-is.
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
                out[key] = "\n".join(block_lines)
            elif rest == "" or rest == ">":
                # Nested mapping or list.
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
            if indent > base_indent:
                raise SystemExit(f"mini-YAML: unexpected list indent at {line!r}")
            rest = line[2:].strip()
            pos[0] += 1
            if rest == "":
                out.append(parse_block(base_indent + 2))
            elif ":" in rest and not rest.startswith(('"', "'")):
                # Inline mapping start: pretend the `- ` was two spaces and
                # re-parse this and the following deeper lines as a map.
                # Simplest recovery: push the line back with dedented "  ".
                key, _, val = rest.partition(":")
                mp: dict[str, Any] = {}
                v = val.strip()
                if v:
                    mp[key.strip()] = _mini_scalar(v)
                # continue as a mapping at base_indent + 2
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
    # crude guard so `#` inside a "…" doesn't strip the comment
    q = 0
    for ch in line:
        if ch == '"':
            q ^= 1
    return q == 1


# ---------------------------------------------------------------------------
# Substitution engine
# ---------------------------------------------------------------------------

# {{spec.a.b.c}} or {{spec.a.b | as_list}} or {{ComponentName}}
SUB_RE = re.compile(
    r"\{\{\s*(?P<path>spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+|ComponentName)"
    r"(?:\s*\|\s*(?P<filter>as_list|as_object|as_ts))?\s*\}\}"
)

# Any remaining {{spec... or {{ComponentName after render is a bug.
LEFTOVER_SUB_RE = re.compile(r"\{\{\s*(spec\.|ComponentName)")

SLOT_RE = re.compile(r"__SLOT_[A-Z_]+__")

# The synthesized life-wire paths — pre-baked TS code the compiler emits
# deterministically from spec.life (see preprocess_spec). Kept as a set so
# render_template's substitution engine can skip the JSON-string escaping
# it applies to ordinary scalars.
_LIFE_WIRE_PATHS = frozenset({
    "life.breath_uniform_wire",
    "life.idle_writer_setup",
    "life.idle_writer_cleanup",
})


def pascal_case(key: str) -> str:
    parts = re.split(r"[-_\s]+", key)
    return "".join(p[:1].upper() + p[1:] for p in parts if p)


def get_by_path(root: dict, dotted: str) -> Any:
    node: Any = root
    for part in dotted.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            raise KeyError(dotted)
    return node


def as_list(value: Any, indent: str = "    ") -> str:
    if not isinstance(value, list):
        raise ValueError(f"as_list expected a list, got {type(value).__name__}")
    if not value:
        return "[]"
    lines = ["["]
    inner = indent + "  "
    for item in value:
        if isinstance(item, str):
            lines.append(f'{inner}{_ts_string(item)},')
        else:
            lines.append(f"{inner}{as_ts(item, inner)},")
    lines.append(indent + "]")
    return "\n".join(lines)


def as_object(value: Any, indent: str = "  ") -> str:
    if not isinstance(value, dict):
        raise ValueError(f"as_object expected a mapping, got {type(value).__name__}")
    return as_ts(value, indent)


def as_ts(value: Any, indent: str = "  ") -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return json.dumps(value)
    if isinstance(value, str):
        return _ts_string(value)
    if isinstance(value, list):
        if not value:
            return "[]"
        inner = indent + "  "
        body = ",\n".join(f"{inner}{as_ts(item, inner)}" for item in value)
        return "[\n" + body + f"\n{indent}]"
    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = indent + "  "
        parts = []
        for k, v in value.items():
            parts.append(f"{inner}{_ts_key(k)}: {as_ts(v, inner)}")
        return "{\n" + ",\n".join(parts) + f"\n{indent}}}"
    raise ValueError(f"as_ts: cannot format {type(value).__name__}")


def _ts_string(s: str) -> str:
    # JSON strings are valid TS string literals for our purposes.
    return json.dumps(s, ensure_ascii=False)


_TS_IDENT = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def _ts_key(k: Any) -> str:
    ks = str(k)
    if _TS_IDENT.match(ks):
        return ks
    return _ts_string(ks)


def render_template(text: str, spec: dict, component_name: str) -> str:
    def repl(m: re.Match) -> str:
        path = m.group("path")
        filt = m.group("filter")
        if path == "ComponentName":
            if filt:
                raise SystemExit(f"filter |{filt} not valid on ComponentName")
            return component_name
        assert path.startswith("spec.")
        dotted = path[len("spec."):]
        try:
            value = get_by_path(spec, dotted)
        except KeyError as exc:
            raise SystemExit(f"spec is missing required field: {exc}") from None
        if filt == "as_list":
            return as_list(value)
        if filt == "as_object" or filt == "as_ts":
            return as_object(value)
        # scalar substitution
        if isinstance(value, bool):
            return "true" if value else "false"
        if value is None:
            return "null"
        if isinstance(value, (int, float)):
            return json.dumps(value)
        if isinstance(value, (list, dict)):
            raise SystemExit(
                f"spec.{dotted} is a {type(value).__name__}; add | as_list "
                f"or | as_object to the template placeholder"
            )
        s = str(value)
        # Pre-baked TS literals (fields like `placement_literal`) are already
        # valid TS syntax — do not re-escape them. Detect by suffix or by the
        # opening brace/bracket that marks a literal object or array.
        #
        # The three synthesized `life.*` wires (breath uniform handle, idle
        # writer setup, idle writer cleanup) are pre-baked code the compiler
        # emits deterministically from spec.life; treat them like `_literal`.
        pre_baked = (
            dotted.endswith("_literal")
            or dotted in _LIFE_WIRE_PATHS
            or s.lstrip().startswith(("{", "["))
        )
        if pre_baked:
            return s
        # String scalar. Templates almost always embed these inside "..." string
        # literals, so JSON-escape the *interior* — that way newlines from
        # multi-line YAML (`|` and `>`) survive as `\n`, quotes get escaped,
        # backslashes get doubled, and the surrounding TS quote delimiters in
        # the template still close correctly.
        return _ts_string(s.rstrip())[1:-1]

    return SUB_RE.sub(repl, text)


# ---------------------------------------------------------------------------
# Output plan — one row per template.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Emit:
    template: str  # basename inside templates dir
    output: str    # path inside out-dir


def output_plan(component_name: str, key: str, domain_lib_name: str) -> list[Emit]:
    return [
        Emit("room.config.ts.tmpl", f"src/rooms/{key}/room.config.ts"),
        Emit("page.tsx.tmpl", f"src/app/{key}/page.tsx"),
        Emit("layout.tsx.tmpl", f"src/app/{key}/layout.tsx"),
        Emit("Component.tsx.tmpl", f"src/components/{component_name}.tsx"),
        Emit("domain-lib.ts.tmpl", f"src/lib/{domain_lib_name}.ts"),
        Emit("test-domain.mjs.tmpl", f"scripts/test-{domain_lib_name}.mjs"),
        # Both patch-audit templates render. REGISTRY_PATCH.md is the plain-prose
        # legacy version (kept as a diff-audit fallback); SIDE_FILES_PATCH.md is
        # the companion to apply-side-patches.py — one file summarising what the
        # auto-patcher wrote into the four shared side files.
        Emit("registry-patch.md.tmpl", f"REGISTRY_PATCH.md"),
        Emit("side-files-patch.md.tmpl", f"SIDE_FILES_PATCH.md"),
    ]


# ---------------------------------------------------------------------------
# Spec preprocessing — synthesize placement_literal and coerce bools.
# ---------------------------------------------------------------------------

def preprocess_spec(spec: dict) -> dict:
    """Fill in synthesized fields the templates rely on."""
    key = spec.get("key")
    if not isinstance(key, str) or not key:
        raise SystemExit("spec.key is required and must be a non-empty string")

    # placement_literal — a TS object literal string derived from spec.placement
    placement = spec.get("placement")
    if isinstance(placement, dict):
        spec.setdefault("placement_literal", as_object(placement))
    else:
        raise SystemExit("spec.placement is required and must be a mapping")

    # placement_note — one authored sentence for the header docstring, or a
    # bland default if absent (the template still parses).
    spec.setdefault(
        "placement_note",
        f"See docs/new-room.md §1 — placed once, in this manifest, and derived from there.",
    )

    # dark defaults to false; storage key defaults to `objetdart:<key>:v1`
    spec.setdefault("dark", False)
    spec.setdefault("storage_key", f"objetdart:{key}:v1")
    spec.setdefault("ambient_profile", "silent")
    spec.setdefault("aria_label", key)
    spec.setdefault("route", f"/{key}")
    spec.setdefault("cluster", "nature")
    spec.setdefault("sigil", "growth")
    spec.setdefault("desc", "")

    # domain_lib defaults
    dl = spec.get("domain_lib")
    if not isinstance(dl, dict):
        dl = {"name": key, "brief": "", "title": key}
        spec["domain_lib"] = dl
    dl.setdefault("name", key)
    dl.setdefault("brief", "")
    dl.setdefault("title", key)

    spec.setdefault("invariant_type", "state vector")

    # icon.short_name is the underscored/hyphenated version rooms use.
    # M2 schema keeps icon fields flat on the spec (sigil, palette, guide.title,
    # desc, key). If a raw `icon:` block was passed we honor it verbatim;
    # otherwise we compose one from those flat fields.
    icon = spec.get("icon")
    if not isinstance(icon, dict):
        icon = {}
        spec["icon"] = icon
    icon.setdefault("short_name", key)
    icon.setdefault("title", (spec.get("guide") or {}).get("title") or key)
    icon.setdefault("description", spec.get("desc", (spec.get("guide") or {}).get("essence", "")))
    icon.setdefault("kind", spec.get("icon_kind") or spec.get("sigil", "clouds"))
    pal = spec.get("palette") or {}
    for k in ("bg", "bg2", "glow", "accent", "accent2", "ink"):
        if k in pal:
            icon.setdefault(k, pal[k])
    icon.setdefault("path", f"/{key}")

    # guide sanity — finds/keeps are optional in RoomManifest but the template
    # writes both lines; supply empty defaults so the substitution succeeds.
    guide = spec.get("guide")
    if not isinstance(guide, dict):
        raise SystemExit("spec.guide is required and must be a mapping")
    guide.setdefault("finds", [])
    guide.setdefault("keeps", "")
    guide.setdefault("scale", "")

    # palette
    palette = spec.get("palette")
    if not isinstance(palette, dict):
        raise SystemExit("spec.palette is required and must be a mapping")
    for k in ("bg", "bg2", "glow", "accent", "accent2", "ink"):
        palette.setdefault(k, "#000000")

    # life — the schema block that makes a room feel alive: population, breath,
    # glimmer, haptics_grammar, make_unmake. Any of these missing collapses to
    # an empty block; the compiler still renders (the compiled room is just
    # less alive). The three `_wire` fields synthesized here are pre-baked TS
    # that Component.tsx.tmpl substitutes into fixed positions — the LLM never
    # sees these, they are the deterministic half of the alive-at-rest wiring.
    life = spec.get("life")
    if not isinstance(life, dict):
        life = {}
        spec["life"] = life
    _synthesize_life_wires(life)

    return spec


def _synthesize_life_wires(life: dict) -> None:
    """Fill in life.breath_uniform_wire, life.idle_writer_setup, and
    life.idle_writer_cleanup — the three deterministic sub-inserts
    Component.tsx.tmpl reads. Called by preprocess_spec.

    - breath_uniform_wire: a local handle to the shared uBreath uniform, so
      the population step context (and any JS-side beat) can read the same
      value the shader sees. Emitted only when spec.life.breath.reads
      includes "uBreath"; otherwise empty (a dead handle is a bug the
      reader spends time chasing).
    - idle_writer_setup: the glimmer clock. Runs after spec.life.glimmer's
      idle window and pulses the room's visual glimmer — never text.
    - idle_writer_cleanup: the matching teardown, emitted into the useEffect
      return so the writer detaches with the room.
    """
    breath_raw = life.get("breath")
    breath: dict = breath_raw if isinstance(breath_raw, dict) else {}
    reads = breath.get("reads") or []
    # A read entry may be the bare identifier "uBreath" or a descriptive string
    # like "uBreath uniform (fragment shader — dust glow, glint, humus)". Match
    # either shape: the spec author's voice should not decide the wire.
    reads_uBreath = isinstance(reads, list) and any(
        isinstance(r, str) and "uBreath" in r for r in reads
    )
    if reads_uBreath:
        life["breath_uniform_wire"] = (
            "// life.breath.reads includes uBreath — the harness already writes\n"
            "    // this uniform through stage.beginFrame → clocksFrom; the local\n"
            "    // handle below lets population.step read the same value.\n"
            "    const uniformBreath = prog?.location(\"uBreath\") ?? null;\n"
            "    void uniformBreath;"
        )
    else:
        life["breath_uniform_wire"] = (
            "// life.breath.reads is empty or omits uBreath — no handle emitted."
        )

    glimmer_raw = life.get("glimmer")
    glimmer: dict = glimmer_raw if isinstance(glimmer_raw, dict) else {}
    after_ms = glimmer.get("after_idle_ms")
    try:
        after_ms_int = int(after_ms) if after_ms is not None else 20000
    except (TypeError, ValueError):
        after_ms_int = 20000
    if life.get("glimmer") or after_ms is not None:
        life["idle_writer_setup"] = (
            f"const idle = createIdleWriter(surface, {{ afterMs: {after_ms_int} }});\n"
            f"    idle.attach();"
        )
        life["idle_writer_cleanup"] = "idle.detach();"
    else:
        # No glimmer block — the room takes the shell's default idle writer
        # (already wired above via `writer`) and the compiler emits nothing.
        life["idle_writer_setup"] = (
            "// life.glimmer omitted — the room takes the shell's default idle window."
        )
        life["idle_writer_cleanup"] = (
            "// life.glimmer omitted — no dedicated glimmer writer to detach."
        )
    return


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="Render M3 templates for a room from a spec.yaml.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--spec", required=True, type=Path, help="path to spec.yaml")
    ap.add_argument("--out-dir", required=True, type=Path, help="output root")
    ap.add_argument(
        "--templates-dir",
        type=Path,
        default=Path("object-compiler/templates"),
        help="where the *.tmpl files live (default: %(default)s)",
    )
    ap.add_argument(
        "--verify-only",
        action="store_true",
        help="render into memory and check invariants, but don't write files",
    )
    args = ap.parse_args(argv)

    if not args.spec.exists():
        raise SystemExit(f"spec not found: {args.spec}")
    if not args.templates_dir.exists():
        raise SystemExit(f"templates dir not found: {args.templates_dir}")

    spec_root = load_yaml(args.spec)
    # The spec might be top-level fields OR nested under a `spec:` key.
    spec = spec_root["spec"] if isinstance(spec_root.get("spec"), dict) else spec_root
    spec = preprocess_spec(spec)

    component_name = pascal_case(spec["key"])
    domain_lib_name = spec["domain_lib"]["name"]

    rendered: list[tuple[Path, str, list[str]]] = []
    for emit in output_plan(component_name, spec["key"], domain_lib_name):
        tmpl_path = args.templates_dir / emit.template
        if not tmpl_path.exists():
            raise SystemExit(f"template missing: {tmpl_path}")
        text = tmpl_path.read_text(encoding="utf-8")
        out = render_template(text, spec, component_name)

        # Contract 1: no unresolved {{spec...}} or {{ComponentName}}.
        leftover = LEFTOVER_SUB_RE.search(out)
        if leftover:
            snippet = out[max(0, leftover.start() - 40):leftover.end() + 40]
            raise SystemExit(
                f"unresolved substitution in {emit.template}: {snippet!r}"
            )

        # Contract 2: every slot marker that was in the template is still there.
        expected_slots = set(SLOT_RE.findall(text))
        actual_slots = set(SLOT_RE.findall(out))
        missing = expected_slots - actual_slots
        if missing:
            raise SystemExit(
                f"slot markers vanished during render of {emit.template}: {sorted(missing)}"
            )

        out_path = args.out_dir / emit.output
        rendered.append((out_path, out, sorted(actual_slots)))

    if args.verify_only:
        print("verify-only: rendered", len(rendered), "files without writing", file=sys.stderr)

    for out_path, out, slots in rendered:
        if not args.verify_only:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(out, encoding="utf-8")
        print(f"  {out_path}")
        if slots:
            print(f"    slots: {', '.join(slots)}")

    total_slots = sum(len(slots) for _, _, slots in rendered)
    print(
        f"\ndone: {len(rendered)} files, {total_slots} slot markers to fill "
        f"in the next stage (fill-slots.mjs)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
