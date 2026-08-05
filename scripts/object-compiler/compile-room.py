#!/usr/bin/env python3
"""
compile-room.py — the Object Compiler CLI.

Companion to:
    docs/plans/object-compiler.md   (M4 — First Generation, end to end)

One prose paragraph OR one spec.yaml in, one landed-in-a-worktree room out.
The pipeline is:

    (a) if --prose: intent-to-spec prompt → validated spec.yaml
    (b) validate spec against object-compiler/schema/room-spec.schema.yaml
    (c) call scripts/object-compiler/render-template.py → skeleton in out-dir
    (d) for each SLOT marker in the skeleton, call `claude --print` with the
        appropriate slot prompt from object-compiler/prompts/ + retrieval
        context (2–3 nearest past rooms by `invariant_type`) → replace the
        marker in place
    (e) patch src/rooms/registry.ts to import the new manifest and add it
        to ROOM_MANIFESTS in alphabetical order
    (f) print a summary and the next command the human should run

Design constraints from docs/plans/object-compiler.md:
    - Never touch main. Worktree branches only. No auto-commit, no auto-push,
      no auto-merge. The compiler's output is a branch, not a PR.
    - Resumable: running twice against the same --out-dir skips any slot
      whose marker is already filled. The marker's absence IS the filled
      signal — no side-log.
    - Every subprocess call has a timeout and surfaces its stderr.
    - No time.sleep polling. Waits use blocking subprocess.run.

Voice — this file speaks the same operational-and-load-bearing dialect the
plan doc does. Comments here are for the next agent, not for the user.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NoReturn

# ---------------------------------------------------------------------------
# constants — paths, timeouts, slot markers
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
"""Absolute path to the objetdart_proj checkout this script runs from."""

CLAUDE_BIN = Path("/Users/jawaun/.local/bin/claude")
"""The claude CLI binary the compiler shells out to. Path is intentionally
absolute — the compiler must not depend on the caller's PATH."""

COMPILER_ROOT = REPO_ROOT / "object-compiler"
PROMPTS_DIR = COMPILER_ROOT / "prompts"
SCHEMA_PATH = COMPILER_ROOT / "schema" / "room-spec.schema.yaml"
EXAMPLES_DIR = COMPILER_ROOT / "schema" / "examples"

RENDER_TEMPLATE = REPO_ROOT / "scripts" / "object-compiler" / "render-template.py"
APPLY_SIDE_PATCHES = REPO_ROOT / "scripts" / "object-compiler" / "apply-side-patches.py"
REGISTRY_PATH = REPO_ROOT / "src" / "rooms" / "registry.ts"

WORKTREE_ROOT = REPO_ROOT / ".claude" / "worktrees"

# The four in-file markers the template pass writes. Filling replaces the
# marker with its LLM output; leaving the marker in place means the slot is
# still open. Resumability is a textual property, not a database one.
SLOT_MARKERS = {
    "shader": "__SLOT_SHADER_BODY__",
    "domain": "__SLOT_DOMAIN_LAW__",
    "verbs":  "__SLOT_VERB_HANDLERS__",
    "pins":   "__SLOT_PINS__",
}

# Which slot prompt each marker calls into.
SLOT_PROMPTS = {
    "shader": "slot-shader.md",
    "domain": "slot-domain.md",
    "verbs":  "slot-verbs.md",
    "pins":   "slot-pins.md",
}

# Which file each slot lands in, relative to the worktree root, with a key
# whose {name} is substituted from spec.key. Multiple slots may share a file
# (shader + verbs both live in Room.tsx).
SLOT_TARGET_TEMPLATES = {
    "shader": "src/components/{Room}.tsx",
    "domain": "src/lib/{domain}.ts",
    "verbs":  "src/components/{Room}.tsx",
    "pins":   "scripts/test-{domain}.mjs",
}

# Timeouts (seconds). Every subprocess call names one; there is no default.
TIMEOUT_INTENT_TO_SPEC = 180
TIMEOUT_SLOT_FILL      = 300
TIMEOUT_RENDER         = 60
TIMEOUT_GIT            = 30
TIMEOUT_SIDE_PATCHES   = 60

# The registry-patch instructions live here when a supplementary prompt file
# is used; the compiler also has a programmatic fallback (see _patch_registry).
REGISTRY_PATCH_HINT = PROMPTS_DIR / "registry-patch.md"


# ---------------------------------------------------------------------------
# data shapes
# ---------------------------------------------------------------------------

@dataclass
class CompileConfig:
    spec_path: Path | None       # existing spec.yaml, or None if --prose
    prose: str | None            # paragraph of intent, or None if --spec
    out_dir: Path                # the worktree root (or --out-dir if not making one)
    make_worktree: bool
    branch: str
    no_llm: bool
    dry_run: bool
    apply_side_patches: bool     # run apply-side-patches.py after slot-fill


@dataclass
class Spec:
    """A parsed spec.yaml — we don't need the whole shape, only the fields
    the pipeline reads. Everything else is passed through unchanged."""
    raw: dict[str, Any]
    text: str  # the on-disk YAML text, kept so the LLM prompts see it verbatim

    @property
    def key(self) -> str:
        return str(self.raw["key"])

    @property
    def domain_module(self) -> str:
        # M2 schema names this `domain_lib.name`. Fall back to legacy
        # `domain.module` so pre-schema specs still parse during migration.
        return str(self.raw.get("domain_lib", self.raw.get("domain", {})).get(
            "name", self.raw.get("domain_lib", self.raw.get("domain", {})).get("module", "")))

    @property
    def invariant_type(self) -> str:
        return str(self.raw.get("domain_lib", self.raw.get("domain", {})).get(
            "invariant_type", "unknown"))

    @property
    def room_component_name(self) -> str:
        # `spring` → `Spring`; `air_column` → `AirColumn`. Matches the
        # naming convention `src/components/AirColumn.tsx`.
        return "".join(part.capitalize() for part in re.split(r"[_\-]", self.key))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args(argv: list[str] | None = None) -> CompileConfig:
    p = argparse.ArgumentParser(
        prog="compile-room.py",
        description="Object Compiler — turn a spec.yaml (or a paragraph of prose) "
                    "into a landed-in-a-worktree new room, with the three creative "
                    "slots filled by claude --print.",
    )
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--spec", metavar="PATH", help="path to a spec.yaml")
    src.add_argument("--prose", metavar="TEXT", help="one paragraph of intent")

    p.add_argument("--out-dir", metavar="PATH",
                   help="target directory (default: create a worktree under "
                        ".claude/worktrees/object-compiler-<key>-<timestamp>)")
    p.add_argument("--worktree", action=argparse.BooleanOptionalAction, default=True,
                   help="create a git worktree (default: yes)")
    p.add_argument("--branch", metavar="NAME",
                   help="target branch name (default: object-compiler/<key>-<timestamp>)")
    p.add_argument("--no-llm", action="store_true",
                   help="skip slot-fill; leave __SLOT_*__ markers in place and report")
    p.add_argument("--dry-run", action="store_true",
                   help="print planned actions, do not modify anything")
    p.add_argument("--apply-side-patches",
                   action=argparse.BooleanOptionalAction, default=True,
                   help="after slot-fill, auto-patch src/rooms/registry.ts, "
                        "src/lib/room-registry.ts, src/lib/scale.ts and "
                        "scripts/test-routes.mjs via apply-side-patches.py "
                        "(default: yes)")

    a = p.parse_args(argv)

    return CompileConfig(
        spec_path=Path(a.spec).resolve() if a.spec else None,
        prose=a.prose,
        out_dir=Path(a.out_dir).resolve() if a.out_dir else Path(),  # filled in later
        make_worktree=bool(a.worktree) and a.out_dir is None,
        branch=a.branch or "",  # filled in later once we know the key
        no_llm=a.no_llm,
        dry_run=a.dry_run,
        apply_side_patches=bool(a.apply_side_patches),
    )


# ---------------------------------------------------------------------------
# spec loading and validation
# ---------------------------------------------------------------------------

def _load_spec(path: Path) -> Spec:
    """Parse a spec.yaml. Uses a minimal YAML dependency-free parser so the
    compiler runs on a fresh checkout without a `pip install`."""
    text = path.read_text(encoding="utf-8")
    try:
        raw = _parse_yaml(text)
    except Exception as e:
        _die(f"spec.yaml at {path} did not parse: {e}")
    if not isinstance(raw, dict):
        _die(f"spec.yaml at {path} is not a mapping at the top level")
    return Spec(raw=raw, text=text)


def _parse_yaml(text: str) -> Any:
    """Minimal YAML load: prefer PyYAML if installed, fall back to json if the
    file happens to already be JSON, else die with a clear message. The compiler
    only ever reads YAML the LLM or the schema examples emit, so a fully-
    featured parser is nice-to-have, not load-bearing."""
    try:
        import yaml  # type: ignore
        return yaml.safe_load(text)
    except ImportError:
        pass
    # Fallback: try JSON — an LLM occasionally emits YAML-flavoured JSON that
    # still parses as JSON. If neither works, name the missing dep.
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        _die("PyYAML is not installed and the spec is not JSON-loadable. "
             "Install PyYAML (`pip install pyyaml`) or emit JSON-compatible YAML.")


def _validate_spec(spec: Spec) -> list[str]:
    """Minimal validator. Returns a list of human-readable errors; empty on
    valid. Deliberately not a full JSON Schema implementation — the compiler
    checks the fields it will consume, not the full shape. Field names track
    `object-compiler/schema/room-spec.schema.yaml`: the schema is the
    contract, so this list is the schema's `required` block plus a couple
    of cross-field invariants the schema cannot express."""
    errors: list[str] = []
    required_top = ["key", "placement", "sigil", "desc", "cluster",
                    "ambient_profile", "invariant", "material", "noun",
                    "domain_lib", "palette", "verbs_answered", "guide",
                    "shader_intent", "domain_intent", "verb_intent"]
    for f in required_top:
        if f not in spec.raw:
            errors.append(f"missing required field: {f}")

    # Placement is the ordinal decision; check its shape.
    place = spec.raw.get("placement")
    if isinstance(place, dict):
        kind = place.get("kind")
        if kind not in {"band", "peer"}:
            errors.append(f"placement.kind must be band|peer, got {kind!r}")
        if kind == "peer":
            for f in ["circle", "band", "label"]:
                if f not in place:
                    errors.append(f"peer placement missing {f}")
        if kind == "band" and "band" not in place:
            errors.append("band placement missing band")

    # domain_lib.name is what the render pass and slot-fill pass both consume.
    dl = spec.raw.get("domain_lib")
    if isinstance(dl, dict):
        if "name" not in dl:
            errors.append("domain_lib.name missing (the src/lib/<name>.ts stem)")
        if "invariant_type" not in dl:
            errors.append("domain_lib.invariant_type missing (retrieval key)")

    # verbs_answered must be a non-empty list from the fixed grammar.
    va = spec.raw.get("verbs_answered", [])
    if isinstance(va, list):
        if len(va) < 3:
            errors.append(f"verbs_answered has {len(va)} entries; the grammar's minimum is 3")

    # guide.moves must be at least three lines; one per non-vessel verb is
    # what the schema and the room contract expect, but a moves line may
    # aggregate the four vessel verbs. Length check only — the LLM is what
    # enforces one-to-one at write time.
    guide = spec.raw.get("guide", {})
    if isinstance(guide, dict):
        moves = guide.get("moves", [])
        if isinstance(moves, list) and len(moves) < 3:
            errors.append(f"guide.moves has {len(moves)} entries; the schema minimum is 3")

    # palette must have the six keys the room-manifest expects.
    palette = spec.raw.get("palette", {})
    if isinstance(palette, dict):
        for k in ["bg", "bg2", "glow", "accent", "accent2", "ink"]:
            if k not in palette:
                errors.append(f"palette missing {k}")

    return errors


# ---------------------------------------------------------------------------
# claude --print — the one LLM interface the compiler talks through
# ---------------------------------------------------------------------------

def _claude_print(prompt: str, timeout: int, label: str) -> str:
    """Call `claude --print <prompt>` and return the model's reply. Blocking.
    Every call names its own timeout; there is no default. Errors are printed
    to stderr and re-raised as `RuntimeError` — the compiler's caller decides
    whether to retry or abort."""
    if not CLAUDE_BIN.exists():
        raise RuntimeError(f"claude CLI not found at {CLAUDE_BIN}")
    _log(f"[llm] {label} — calling claude --print (timeout {timeout}s)")
    try:
        proc = subprocess.run(
            [str(CLAUDE_BIN), "--print", prompt],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(REPO_ROOT),
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"[llm] {label} timed out after {timeout}s")
    if proc.returncode != 0:
        # Surface stderr in full; the compiler shouldn't paper over model
        # errors, and the user needs the message to know whether to retry.
        sys.stderr.write(f"[llm] {label} stderr:\n{proc.stderr}\n")
        raise RuntimeError(f"[llm] {label} exited {proc.returncode}")
    return proc.stdout


# ---------------------------------------------------------------------------
# intent-to-spec — pass (a)
# ---------------------------------------------------------------------------

def _intent_to_spec(prose: str, out_dir: Path) -> Path:
    """Run the intent-to-spec prompt over `prose` and return the path to the
    resulting spec.yaml. Deliberately not resumable at this level: if the
    LLM returned an invalid spec, the human edits the paragraph and reruns."""
    prompt_template = (PROMPTS_DIR / "intent-to-spec.md").read_text(encoding="utf-8")
    schema_text = SCHEMA_PATH.read_text(encoding="utf-8") if SCHEMA_PATH.exists() else \
        "# (schema file not yet produced by the parallel M2 agent; see plan §M2)"
    examples_text = _load_all_examples()

    prompt = (prompt_template
              .replace("{{schema}}", schema_text)
              .replace("{{examples}}", examples_text)
              .replace("{{prose}}", prose))

    reply = _claude_print(prompt, TIMEOUT_INTENT_TO_SPEC, "intent-to-spec")

    # Strip any accidental code fences.
    yaml_text = _strip_fences(reply)

    spec_path = out_dir / "spec.yaml"
    spec_path.parent.mkdir(parents=True, exist_ok=True)
    spec_path.write_text(yaml_text, encoding="utf-8")
    _log(f"[spec] wrote {spec_path}")
    return spec_path


def _load_all_examples() -> str:
    """Concatenate every spec.yaml in `object-compiler/schema/examples/` with
    a `--- # <filename>` divider between them. Used as one-shot context for
    the intent-to-spec pass."""
    out: list[str] = []
    if not EXAMPLES_DIR.exists():
        return "# (no example specs available yet)"
    for f in sorted(EXAMPLES_DIR.glob("*.yaml")):
        out.append(f"--- # {f.name}")
        out.append(f.read_text(encoding="utf-8"))
    return "\n".join(out) if out else "# (no example specs available yet)"


# ---------------------------------------------------------------------------
# template render — pass (c)
# ---------------------------------------------------------------------------

def _render_template(spec_path: Path, out_dir: Path) -> None:
    """Shell out to scripts/object-compiler/render-template.py — the pure
    template pass produced by the M3 agent. The compiler does not have its
    own template engine; if that script is missing, this is a plan-level
    dependency the user must resolve before running M4."""
    if not RENDER_TEMPLATE.exists():
        _die(
            f"render-template.py not found at {RENDER_TEMPLATE}. "
            "This is the M3 deliverable; run the compiler after that agent lands, "
            "or point --out-dir at a directory that already has the skeleton."
        )
    _log(f"[render] calling {RENDER_TEMPLATE.name} (timeout {TIMEOUT_RENDER}s)")
    try:
        proc = subprocess.run(
            [sys.executable, str(RENDER_TEMPLATE),
             "--spec", str(spec_path),
             "--out-dir", str(out_dir)],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_RENDER,
            cwd=str(REPO_ROOT),
        )
    except subprocess.TimeoutExpired:
        _die(f"[render] template pass timed out after {TIMEOUT_RENDER}s")
    if proc.returncode != 0:
        sys.stderr.write(f"[render] stderr:\n{proc.stderr}\n")
        _die(f"[render] template pass exited {proc.returncode}")
    _log(f"[render] template written to {out_dir}")


# ---------------------------------------------------------------------------
# slot fill — pass (d)
# ---------------------------------------------------------------------------

def _fill_slots(spec: Spec, out_dir: Path, no_llm: bool) -> dict[str, str]:
    """For each slot, find its target file inside `out_dir`, check for the
    marker, and if present call claude --print with the slot prompt +
    retrieval context. Returns a dict mapping slot name → 'filled' / 'skipped'
    / 'no-marker' / 'error: <msg>' for the summary."""
    outcomes: dict[str, str] = {}
    for slot, marker in SLOT_MARKERS.items():
        target_rel = SLOT_TARGET_TEMPLATES[slot].format(
            Room=spec.room_component_name,
            domain=spec.domain_module,
        )
        target = out_dir / target_rel
        if not target.exists():
            outcomes[slot] = f"error: target file not found: {target_rel}"
            continue
        text = target.read_text(encoding="utf-8")
        if marker not in text:
            outcomes[slot] = "skipped (marker already filled)"
            continue
        if no_llm:
            outcomes[slot] = "no-llm — marker preserved"
            continue
        try:
            filled = _call_slot_prompt(slot, spec)
        except Exception as e:
            outcomes[slot] = f"error: {e}"
            continue
        cleaned = _strip_fences(filled).strip()
        if marker in cleaned:
            outcomes[slot] = "error: LLM output still contained the slot marker"
            continue
        new_text = text.replace(marker, cleaned, 1)
        target.write_text(new_text, encoding="utf-8")
        outcomes[slot] = "filled"
    return outcomes


def _call_slot_prompt(slot: str, spec: Spec) -> str:
    prompt_path = PROMPTS_DIR / SLOT_PROMPTS[slot]
    if not prompt_path.exists():
        raise RuntimeError(f"prompt file missing: {prompt_path}")
    template = prompt_path.read_text(encoding="utf-8")

    one_shots = _retrieve_one_shots(slot, spec)

    # visual_style is the design-context block consumed by slot-shader.md
    # (and, in principle, any future slot prompt that wants it). Emit it as a
    # yaml block; an empty block is legal (older specs may not carry the
    # field yet), and the prompt handles the absent-visual-style case.
    visual_style_block = _yaml_block(spec.raw.get("visual_style", {}))

    subs: dict[str, str] = {
        "one_shot_examples":         one_shots,
        "shader_intent":             str(spec.raw.get("shader_intent", "")),
        "domain_intent":             str(spec.raw.get("domain_intent", "")),
        "verb_intent":               str(spec.raw.get("verb_intent", "")),
        "palette_and_uniforms":      _yaml_block(spec.raw.get("palette", {})),
        "visual_style":              visual_style_block,
        "declared_surface":          _read_declared_surface(slot, spec),
        "verbs_answered_with_briefs": _yaml_block({
            v: spec.raw.get("verbs", {}).get(v, "")
            for v in spec.raw.get("verbs_answered", [])
        }),
        "domain_api_surface":        _read_declared_surface("domain", spec),
    }

    prompt = template
    for k, v in subs.items():
        prompt = prompt.replace("{{" + k + "}}", v)

    return _claude_print(prompt, TIMEOUT_SLOT_FILL, f"slot-{slot}")


def _retrieve_one_shots(slot: str, spec: Spec) -> str:
    """The retrieval bank. Rank all example specs against the target `spec`
    by a four-tier key — invariant_type, composition, form_language,
    motion_character — and return the top K anchors' source sections.

    The K=2 default is a deliberate response to the /geyser audit finding
    that a *retrieval bank of one* biases toward *copying* rather than
    *differentiating*. When the top hit dominates by invariant_type
    (i.e. there is only one room in the target family), the second slot
    is *forced* to a next-best DIFFERENT-invariant-type room so the LLM
    sees a foil — the room's identity shape, plus a contrast that says
    "you are not any of these other rooms either."

    Sources — spec.yaml files with a full `visual_style` block — are
    read from `object-compiler/schema/examples/`. The retrieval bank
    used to live at `object-compiler/reference/<key>/spec.yaml`, but
    that directory was never populated (M7 was designed to pack it and
    never landed); the examples dir carries the authoritative specs
    and is checked in already.

    The code (shader / domain / verbs / pins) is still pulled from the
    landed `src/` tree via the domain module name — the retrieval
    picks WHICH rooms to anchor against; `_read_slot_section_from_main`
    then reads the *actual code* those rooms shipped, exactly as
    before.
    """
    inv = spec.invariant_type
    target_style = spec.raw.get("visual_style", {}) or {}
    target_composition = str(target_style.get("composition", ""))
    target_form_langs = set(target_style.get("form_language", []) or [])
    target_motion = str(target_style.get("motion_character", ""))
    target_key = spec.key

    # Rank every example spec by a four-tier score. Ties broken by name.
    candidates: list[dict[str, Any]] = []
    if EXAMPLES_DIR.exists():
        for spec_yaml in sorted(EXAMPLES_DIR.glob("*.yaml")):
            if spec_yaml.stem == target_key:
                continue  # do not retrieve the spec we are compiling
            try:
                other = _parse_yaml(spec_yaml.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(other, dict):
                continue
            other_inv = other.get("domain_lib", other.get("domain", {})).get(
                "invariant_type", ""
            )
            other_style = other.get("visual_style", {}) or {}
            other_composition = str(other_style.get("composition", ""))
            other_form_langs = set(other_style.get("form_language", []) or [])
            other_motion = str(other_style.get("motion_character", ""))
            other_module = other.get("domain_lib", other.get("domain", {})).get(
                "name", ""
            )
            # Score: (invariant_match, composition_match, form_language_overlap,
            #        motion_match). Higher is better.
            score = (
                int(other_inv == inv),
                int(bool(other_composition) and other_composition == target_composition),
                len(target_form_langs & other_form_langs),
                int(bool(other_motion) and other_motion == target_motion),
            )
            candidates.append({
                "key":       spec_yaml.stem,
                "score":     score,
                "invariant": other_inv,
                "module":    other_module,
            })

    if not candidates:
        # No specs on disk — fall through to the hand-map on src/.
        fallback_map = {
            "field":   ["spiral", "hearth", "wavefield"],
            "flock":   ["flock"],
            "column":  ["aircolumn"],
            "ledger":  ["humus", "springflow", "geyserflow"],
            "lattice": ["crystal"],
            "orbit":   ["orbits"],
            "latent":  ["worldforge"],
            "chain":   [],
        }
        return _fallback_one_shots(slot, fallback_map.get(inv, ["aircolumn", "humus"]))

    # Sort best-first by score.
    candidates.sort(key=lambda c: c["score"], reverse=True)

    # Assemble top-K = 2, forcing invariant-type diversity when the top hit is
    # the ONLY member of its family. That is the geyser-audit fix: a retrieval
    # bank of one biases toward copying; a foil corrects it.
    K = 2
    picked: list[dict[str, Any]] = []
    if candidates:
        picked.append(candidates[0])
        top_inv = candidates[0]["invariant"]
        # Count how many share top's invariant across ALL candidates. If exactly
        # one, force the second slot to be a different invariant_type; otherwise
        # the next-best (same-family or not) is fine.
        same_family = [c for c in candidates if c["invariant"] == top_inv]
        different_family = [c for c in candidates if c["invariant"] != top_inv]
        if len(same_family) == 1 and different_family:
            picked.append(different_family[0])
        elif len(candidates) >= 2:
            picked.append(candidates[1])
        # Trim to K.
        picked = picked[:K]

    parts: list[str] = []
    for cand in picked:
        parts.append(
            f"# --- one-shot from /{cand['key']} "
            f"(invariant_type={cand['invariant']}, score={cand['score']}) ---"
        )
        source = _read_slot_section_from_main(slot, cand["module"])
        if source:
            parts.append(source)
        else:
            parts.append(f"# (source unavailable for module: {cand['module']})")
    return "\n\n".join(parts) or "# (no one-shot examples available)"


def _fallback_one_shots(slot: str, module_names: list[str]) -> str:
    """When the retrieval bank has no matches, read directly from `src/` on
    main. This is what the compiler does on a fresh checkout before M7 packs
    the reference bank."""
    parts: list[str] = []
    for m in module_names[:3]:
        section = _read_slot_section_from_main(slot, m)
        if section:
            parts.append(f"# --- fallback one-shot from src/ (module: {m}) ---")
            parts.append(section)
    return "\n\n".join(parts) or "# (no one-shot examples available)"


def _read_slot_section_from_main(slot: str, module: str) -> str:
    """Read the slot-relevant section from a canonical past room on main.
    Deliberately narrow: for the shader slot we pull the largest FRAG-ish
    template literal; for the domain slot the whole lib file; for verbs
    the `voice = useMemo(...)` or `voiceRef = useRef(...)` block; for
    pins the whole test file.

    When a room's physics lives inline in its component (pre-consolidation
    rooms like /fire and /waves do this), the domain slot falls back to
    the component's own file — a good-enough anchor for what the module
    would look like if it were extracted, and honest about the fact that
    not every ancestor room has been factored into `src/lib/`.
    """
    if slot == "shader":
        component = _guess_component_for_domain(module)
        path = REPO_ROOT / "src" / "components" / f"{component}.tsx"
        if not path.exists():
            return ""
        text = path.read_text(encoding="utf-8")
        # Match the largest FRAG-ish shader literal in the file. Rooms use
        # a variety of names — const FRAG, SKY_FRAG, FIELD_CORE, FRAG_GL1,
        # or an inline const frag = `...`. Pick the longest hit.
        candidates = re.findall(
            r"const\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*`([^`]+)`",
            text,
            re.DOTALL,
        )
        shader_candidates = [
            c for c in candidates
            if ("precision" in c or "gl_Position" in c or "gl_FragColor" in c
                or "FRAG_COLOR" in c or "fragColor" in c)
        ]
        if shader_candidates:
            return max(shader_candidates, key=len)
        # Legacy exact-name fallback if nothing matched the heuristic.
        m = re.search(r"const FRAG = `(.*?)`;", text, re.DOTALL)
        return m.group(1) if m else ""
    if slot == "domain":
        path = REPO_ROOT / "src" / "lib" / f"{module}.ts"
        if path.exists():
            return path.read_text(encoding="utf-8")
        # Fallback: the room's physics lives inline in its component. Return
        # the component file as a coarser anchor. Better than empty context
        # when the retrieval bank names a pre-consolidation room.
        component = _guess_component_for_domain(module)
        component_path = REPO_ROOT / "src" / "components" / f"{component}.tsx"
        if component_path.exists():
            return (
                f"# (no src/lib/{module}.ts — physics is inline in "
                f"{component}.tsx; the whole component follows)\n"
                + component_path.read_text(encoding="utf-8")
            )
        return ""
    if slot == "verbs":
        component = _guess_component_for_domain(module)
        path = REPO_ROOT / "src" / "components" / f"{component}.tsx"
        if not path.exists():
            return ""
        text = path.read_text(encoding="utf-8")
        # Match either the useMemo form or the useRef form.
        for pattern in [
            r"const voice = useMemo<RoomVoice>\(\s*\(\)\s*=>\s*\((\{.*?\})\),\s*\[\]\s*,?\s*\)",
            r"const voiceRef = useRef<RoomVoice>\((\{.*?\})\);",
        ]:
            m = re.search(pattern, text, re.DOTALL)
            if m:
                return m.group(1)
        # Fallback: return the attachGestures block — pre-consolidation rooms
        # wire verbs there directly rather than through a RoomVoice ref.
        m = re.search(
            r"attachGestures\s*\([^,]+,\s*(\{.*?\})\s*\)", text, re.DOTALL
        )
        return m.group(1) if m else ""
    if slot == "pins":
        path = REPO_ROOT / "scripts" / f"test-{module}.mjs"
        return path.read_text(encoding="utf-8") if path.exists() else ""
    return ""


def _guess_component_for_domain(module: str) -> str:
    """Best-effort mapping from a domain-lib module name to its Room
    component name. Tracked by hand for the canonical five/seven rooms
    because the M2 corpus is small enough that this cost is worth its
    determinism."""
    known = {
        "aircolumn":  "AirColumn",
        "humus":      "SoilGround",
        "orbits":     "SolarSystem",
        "flock":      "Murmuration",
        "chemistry":  "AtomsField",
        "spiral":     "GalaxyArms",
        "worldforge": "PlanetForge",
        "crystal":    "RockShelf",
        "springflow": "Spring",
        "geyserflow": "Geyser",
        "hearth":     "Fire",
        "wavefield":  "Waves",
        "pebblecore": "Pebble",
    }
    return known.get(module, module.capitalize())


def _room_source_for_slot(room_dir: Path, slot: str) -> str:
    """Read the slot section from a room living inside
    `object-compiler/reference/<key>/`. That layout is M7's convention;
    if it's populated we prefer it over the src/ fallback."""
    if slot == "shader":
        f = room_dir / "shader.glsl"
        return f.read_text(encoding="utf-8") if f.exists() else ""
    if slot == "domain":
        f = room_dir / "domain.ts"
        return f.read_text(encoding="utf-8") if f.exists() else ""
    if slot == "verbs":
        f = room_dir / "verbs.tsx"
        return f.read_text(encoding="utf-8") if f.exists() else ""
    if slot == "pins":
        f = room_dir / "pins.mjs"
        return f.read_text(encoding="utf-8") if f.exists() else ""
    return ""


def _read_declared_surface(slot: str, spec: Spec) -> str:
    """Return the domain module's currently-declared exports, from the
    skeleton that render-template.py wrote. That skeleton is what the LLM
    is filling *into* — so the surface it sees is the surface it must
    honour."""
    if slot in {"domain", "pins", "verbs"}:
        candidate = spec.raw.get("out_dir")  # not actually stored; use path
        # We can't recover out_dir from spec alone; the caller passes it via
        # the substitution map. Leave the placeholder; the caller can
        # override this by pre-computing declared_surface and passing it.
        return "# (declared surface — read from the rendered domain skeleton)"
    return ""


# ---------------------------------------------------------------------------
# registry patch — pass (e)
# ---------------------------------------------------------------------------

def _patch_registry(spec: Spec, out_dir: Path) -> str:
    """Insert the new room's manifest import + array entry into
    `src/rooms/registry.ts`, preserving alphabetical order.

    The compiler prefers the programmatic patch over reading a
    `registry-patch.md` instructions file: the mechanics are small enough
    that generating them from the spec is cheaper than parsing English."""
    registry_target = out_dir / "src" / "rooms" / "registry.ts"
    if not registry_target.exists():
        return "skipped (registry.ts not present under out-dir)"

    key = spec.key
    text = registry_target.read_text(encoding="utf-8")

    # Guard against a second run — if the import is already there, do nothing.
    import_line = f'import {key} from "@/rooms/{key}/room.config";'
    if import_line in text:
        return "already patched"

    # ── insert the import in alphabetical order ────────────────────────────
    imports = re.findall(
        r'^import (\w+) from "@/rooms/\w+/room\.config";$',
        text,
        re.MULTILINE,
    )
    if not imports:
        return "error: no manifest imports found in registry.ts"
    imports_sorted = sorted(imports + [key])
    idx = imports_sorted.index(key)
    if idx == 0:
        # place before the first existing import
        before = f'import {imports[0]} from "@/rooms/{imports[0]}/room.config";'
        text = text.replace(before, f"{import_line}\n{before}", 1)
    else:
        anchor = imports_sorted[idx - 1]
        anchor_line = f'import {anchor} from "@/rooms/{anchor}/room.config";'
        text = text.replace(anchor_line, f"{anchor_line}\n{import_line}", 1)

    # ── insert the array entry in alphabetical order ───────────────────────
    array_match = re.search(
        r"export const ROOM_MANIFESTS = \[(.*?)\] as const;",
        text,
        re.DOTALL,
    )
    if not array_match:
        return "error: ROOM_MANIFESTS array not found in registry.ts"
    body = array_match.group(1)
    entries = [e.strip().rstrip(",") for e in body.strip().split("\n") if e.strip().rstrip(",")]
    if key in entries:
        return "already patched"
    entries_sorted = sorted(entries + [key])
    new_body = "\n  " + ",\n  ".join(entries_sorted) + ",\n"
    text = text.replace(array_match.group(0),
                        f"export const ROOM_MANIFESTS = [{new_body}] as const;", 1)

    registry_target.write_text(text, encoding="utf-8")
    return f"patched (import + ROOM_MANIFESTS[{key}])"


# ---------------------------------------------------------------------------
# side-file patches — pass (e.b)
# ---------------------------------------------------------------------------

def _run_side_patches(spec_path: Path, out_dir: Path) -> list[str]:
    """Invoke `apply-side-patches.py` against the worktree to auto-apply the
    four side-file edits (registry.ts + room-registry.ts + scale.ts +
    test-routes.mjs). Returns a small list of report lines for the summary.

    Not fatal on error — the caller still gets the summary and can inspect
    the failure. The patcher itself is idempotent, so a partial success
    followed by a rerun of `compile-room.py --apply-side-patches` heals."""
    if not APPLY_SIDE_PATCHES.exists():
        return [f"skipped (apply-side-patches.py not found at {APPLY_SIDE_PATCHES})"]
    _log(f"[side-patch] calling {APPLY_SIDE_PATCHES.name} (timeout {TIMEOUT_SIDE_PATCHES}s)")
    try:
        proc = subprocess.run(
            [sys.executable, str(APPLY_SIDE_PATCHES),
             "--spec", str(spec_path),
             "--repo", str(out_dir)],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SIDE_PATCHES,
        )
    except subprocess.TimeoutExpired:
        return [f"error: timed out after {TIMEOUT_SIDE_PATCHES}s"]
    lines = proc.stdout.strip().splitlines() if proc.stdout else []
    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip().splitlines()[:5]
        return lines + ["error: exit " + str(proc.returncode)] + stderr
    return lines


# ---------------------------------------------------------------------------
# worktree + branch
# ---------------------------------------------------------------------------

def _make_worktree(key: str, branch: str) -> Path:
    """Create a git worktree at `.claude/worktrees/object-compiler-<key>-<ts>/`
    branched from origin/main. No auto-push, no auto-commit. If the branch
    exists already, the compiler picks a new timestamp — never rewrite an
    existing branch."""
    ts = int(time.time())
    wt_path = WORKTREE_ROOT / f"object-compiler-{key}-{ts}"
    wt_path.parent.mkdir(parents=True, exist_ok=True)
    _log(f"[worktree] creating {wt_path} on branch {branch}")
    try:
        subprocess.run(
            ["git", "worktree", "add", "-b", branch, str(wt_path), "origin/main"],
            check=True,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_GIT,
            cwd=str(REPO_ROOT),
        )
    except subprocess.CalledProcessError as e:
        _die(f"[worktree] git worktree add failed: {e.stderr}")
    except subprocess.TimeoutExpired:
        _die(f"[worktree] git worktree add timed out after {TIMEOUT_GIT}s")
    return wt_path


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _strip_fences(text: str) -> str:
    """LLMs sometimes wrap outputs in ```yaml … ``` or ```glsl … ``` fences.
    The compiler strips the outermost fence if present. Inner fences are
    preserved (e.g., a markdown-flavoured YAML comment)."""
    t = text.strip()
    if t.startswith("```"):
        # drop the opening fence line and the trailing ``` if present
        parts = t.split("\n")
        parts = parts[1:]
        if parts and parts[-1].strip().startswith("```"):
            parts = parts[:-1]
        return "\n".join(parts)
    return text


def _yaml_block(obj: Any) -> str:
    """Render a small dict/list as YAML for prompt substitution. Uses PyYAML
    when available, falls back to json.dumps for a legibly-different shape."""
    try:
        import yaml  # type: ignore
        return yaml.safe_dump(obj, sort_keys=False)
    except ImportError:
        return json.dumps(obj, indent=2)


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _die(msg: str) -> NoReturn:
    _log(f"[compile-room] ERROR: {msg}")
    sys.exit(1)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    cfg = _parse_args(argv)

    # ── (a) spec source ───────────────────────────────────────────────────
    if cfg.prose is not None:
        # We need a landing spot for the temp spec.yaml before we know the
        # key. Land it in the compiler's scratchpad and move it into the
        # worktree once the key is resolved.
        tmp_dir = REPO_ROOT / ".claude" / "worktrees" / "object-compiler-tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        if cfg.dry_run:
            _log(f"[dry-run] would call intent-to-spec prompt with prose (chars={len(cfg.prose)})")
            _log(f"[dry-run] would write spec.yaml under {tmp_dir}")
            return 0
        spec_path = _intent_to_spec(cfg.prose, tmp_dir)
    else:
        spec_path = cfg.spec_path
        if spec_path is None or not spec_path.exists():
            _die(f"--spec path does not exist: {spec_path}")

    spec = _load_spec(spec_path)
    errors = _validate_spec(spec)
    if errors:
        _log("[validate] spec.yaml failed schema check:")
        for e in errors:
            _log(f"  - {e}")
        _die("aborting — fix the spec or the schema and rerun.")

    # ── worktree / out-dir resolution ─────────────────────────────────────
    key = spec.key
    if not cfg.branch:
        cfg.branch = f"object-compiler/{key}-{int(time.time())}"
    if cfg.make_worktree:
        if cfg.dry_run:
            _log(f"[dry-run] would create worktree for /{key} on {cfg.branch}")
            return 0
        out_dir = _make_worktree(key, cfg.branch)
    else:
        out_dir = cfg.out_dir
        if not out_dir or not out_dir.exists():
            _die(f"--out-dir does not exist: {out_dir}")

    # Move the temp spec into the worktree, so a rerun with `--spec
    # <worktree>/spec.yaml --no-worktree` is idempotent.
    if cfg.prose is not None:
        landed_spec = out_dir / "spec.yaml"
        if spec_path.resolve() != landed_spec.resolve():
            shutil.copy2(spec_path, landed_spec)
            _log(f"[spec] copied spec.yaml into worktree at {landed_spec}")
            spec_path = landed_spec

    # ── (c) template render ───────────────────────────────────────────────
    if cfg.dry_run:
        _log(f"[dry-run] would render template for /{key} into {out_dir}")
    else:
        _render_template(spec_path, out_dir)

    # ── (d) slot fill ─────────────────────────────────────────────────────
    if cfg.dry_run:
        _log(f"[dry-run] would fill {len(SLOT_MARKERS)} slots (no-llm={cfg.no_llm})")
        outcomes = {slot: "dry-run" for slot in SLOT_MARKERS}
    else:
        outcomes = _fill_slots(spec, out_dir, cfg.no_llm)

    # ── (e) registry patch ────────────────────────────────────────────────
    if cfg.dry_run:
        registry_result = "dry-run"
    else:
        registry_result = _patch_registry(spec, out_dir)

    # ── (e.b) side-file patches ───────────────────────────────────────────
    # After the registry is patched, apply the three other side files
    # (`src/lib/room-registry.ts`, `src/lib/scale.ts`,
    # `scripts/test-routes.mjs`) that spring flagged and geyser confirmed as
    # derivable from the spec. The registry.ts patch above overlaps with
    # apply-side-patches.py's first patch — that's fine, both are idempotent.
    side_patch_results: list[str] = []
    if cfg.apply_side_patches:
        if cfg.dry_run:
            side_patch_results = ["dry-run"]
        else:
            side_patch_results = _run_side_patches(spec_path, out_dir)

    # ── (f) summary ───────────────────────────────────────────────────────
    _log("")
    _log("── object-compiler summary ─────────────────────────────────────")
    _log(f"  room key:     /{key}")
    _log(f"  worktree:     {out_dir}")
    _log(f"  branch:       {cfg.branch}")
    _log(f"  registry:     {registry_result}")
    if cfg.apply_side_patches:
        _log(f"  side-patches:")
        for line in side_patch_results:
            _log(f"    {line}")
    for slot, outcome in outcomes.items():
        marker = SLOT_MARKERS[slot]
        target = SLOT_TARGET_TEMPLATES[slot].format(
            Room=spec.room_component_name, domain=spec.domain_module)
        _log(f"  slot {slot:<7} → {outcome} ({target})")
    _log("")
    _log(f"  next: cd {out_dir} && npm install && npm test")
    _log("")

    return 0


if __name__ == "__main__":
    sys.exit(main())
