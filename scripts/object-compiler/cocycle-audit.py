#!/usr/bin/env python3
"""
cocycle-audit.py — M7 of the Object Compiler plan.

The Theory Atlas cocycle diagnostic (Theory_Atlas_2026_08_03.pdf, Theorem TA-2)
applied to *adjacent* rooms in the compiler's own output — the rooms that share
a peer circle in `src/lib/peers.ts::PEER_CIRCLES`.

Frame (TA-2 in one paragraph). Each room's spec is a *chart* on a shared context;
the transition T_αβ carries chart-α's field-values into chart-β's language on
their overlap. On a triple (A, B, C) the cocycle demands

    T_αγ  =  T_βγ  ∘  T_αβ                as maps on the label alphabet.

The cocycle discrepancy is

    D_αβγ  :=  T_αγ^{-1}  ∘  T_βγ  ∘  T_αβ

and its rank (the number of labels it moves) shreds the failure into three
regimes (TA-2, §3):

    rank == 0                                 →  glue: the compiler is self-consistent
    rank ≥ 1 and supp is a strict subset      →  phase transition / boundary
                                                 (a legitimate scale-change edge)
    rank ≥ 1 with every pairwise T_αβ ≠ id    →  missing latent: the schema is
                                                 quotienting over a coordinate all
                                                 charts have been implicitly hiding.
                                                 The schema needs a new field.

Operational reading for the compiler:
    - "glue"              — nothing to do; the spec basis is coherent.
    - "phase transition"  — legitimate; document the edge in the plan.
    - "missing latent"    — the schema is under-specified. Add the coordinate
                            named by the field with the widest discrepancy.

Inputs. For each room in `--rooms` (default: the members of one peer circle),
the audit needs a `spec.yaml`. If `scripts/object-compiler/derive-spec.py`
exists it is called to reverse-derive the spec from the landed code; otherwise
the audit reads the hand-authored spec at
`object-compiler/schema/examples/<key>.spec.yaml`.

Output. A markdown report at `--report` naming, per triple, the fields whose
transitions fail the cocycle and TA-2's classification.

Reference: `~/Metaphysics of Intelligence/Theory_Atlas_2026_08_03.pdf` §3.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_SCHEMA = REPO_ROOT / "object-compiler" / "schema" / "room-spec.schema.yaml"
DEFAULT_EXAMPLES_DIR = REPO_ROOT / "object-compiler" / "schema" / "examples"
DEFAULT_REPORT = REPO_ROOT / "data" / "object-compiler" / "cocycle-report.md"
DERIVE_SPEC_SCRIPT = REPO_ROOT / "scripts" / "object-compiler" / "derive-spec.py"

# Default room list — the `cabinet` peer circle (drop / seed / coin / jewel /
# tourbillon / …) is a good triple space because those rooms share the `drop`
# band and are the compiler's densest neighbourhood. Callers can override with
# --rooms. Slash-prefix is accepted for symmetry with the plan's docs.
DEFAULT_ROOMS = ["rocks", "soil", "seed", "drop"]


# ---------------------------------------------------------------------------
# tiny yaml loader — stdlib only, enough for these hand-authored specs
# ---------------------------------------------------------------------------


def _try_pyyaml_load(text: str) -> Any:
    try:
        import yaml  # type: ignore
    except ImportError:
        return None
    return yaml.safe_load(text)


def _mini_yaml_load(text: str) -> dict[str, Any]:
    """Handle the small subset of YAML the schema examples use:
        - scalar values (str, int, float, bool, null)
        - nested maps (2-space indent)
        - one-line inline lists like `[a, b, c]`
        - block lists of scalars (`- foo`)
    If a spec exceeds this subset, install PyYAML — `_try_pyyaml_load` is used
    first and this fallback catches only the small-schema case."""
    root: dict[str, Any] = {}
    # stack of (indent, container). container is dict or list.
    stack: list[tuple[int, Any]] = [(-1, root)]
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        while stack and indent <= stack[-1][0] and len(stack) > 1:
            stack.pop()
        parent = stack[-1][1]
        body = line.strip()
        if body.startswith("- "):
            value = _parse_scalar_or_inline(body[2:].strip())
            if not isinstance(parent, list):
                # convert last key of parent to list — happens on first `-`
                # after `key:`
                continue
            parent.append(value)
            continue
        if ":" not in body:
            continue
        key, _, rest = body.partition(":")
        key = key.strip()
        rest = rest.strip()
        if rest == "":
            new: dict[str, Any] = {}
            if isinstance(parent, dict):
                parent[key] = new
            stack.append((indent, new))
        elif rest.startswith("[") and rest.endswith("]"):
            lst = [_parse_scalar_or_inline(x) for x in _split_inline_list(rest[1:-1])]
            if isinstance(parent, dict):
                parent[key] = lst
        elif rest.startswith("{") and rest.endswith("}"):
            obj: dict[str, Any] = {}
            for pair in _split_inline_list(rest[1:-1]):
                if ":" not in pair:
                    continue
                k, _, v = pair.partition(":")
                obj[k.strip()] = _parse_scalar_or_inline(v.strip())
            if isinstance(parent, dict):
                parent[key] = obj
        else:
            if isinstance(parent, dict):
                parent[key] = _parse_scalar_or_inline(rest)
        # peek next non-blank line to decide if this key opens a list
        # (a `-` follows at deeper indent). We approximate by leaving the
        # dict value in place; a following `- ...` line will convert to list
        # if it arrives.
    return root


def _split_inline_list(body: str) -> list[str]:
    """Split `a, b, c` respecting matched brackets/braces (single level)."""
    parts, depth, buf = [], 0, []
    for ch in body:
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf).strip())
    return [p for p in parts if p]


def _parse_scalar_or_inline(s: str) -> Any:
    s = s.strip()
    if not s: return None
    if s.lower() in ("true", "false"): return s.lower() == "true"
    if s.lower() in ("null", "~"):     return None
    if (s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"')):
        return s[1:-1]
    try: return int(s)
    except ValueError: pass
    try: return float(s)
    except ValueError: pass
    return s


def load_spec(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    parsed = _try_pyyaml_load(text)
    if isinstance(parsed, dict):
        return parsed
    return _mini_yaml_load(text)


# ---------------------------------------------------------------------------
# chart derivation — call derive-spec.py if present, else read examples
# ---------------------------------------------------------------------------


def _derive_or_load(room_key: str) -> dict[str, Any]:
    key = room_key.lstrip("/").strip()
    if DERIVE_SPEC_SCRIPT.exists():
        rc = subprocess.run(
            [sys.executable, str(DERIVE_SPEC_SCRIPT), "--key", key, "--json"],
            capture_output=True, text=True, check=False, cwd=str(REPO_ROOT),
        )
        if rc.returncode == 0 and rc.stdout.strip():
            try:
                return json.loads(rc.stdout)
            except json.JSONDecodeError:
                pass
    example = DEFAULT_EXAMPLES_DIR / f"{key}.spec.yaml"
    if not example.exists():
        raise FileNotFoundError(
            f"no chart available for `{key}`: neither derive-spec.py nor "
            f"{example} produced a spec."
        )
    return load_spec(example)


# ---------------------------------------------------------------------------
# transition classification
# ---------------------------------------------------------------------------


HEX_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


@dataclass(frozen=True)
class Transform:
    """A field-level transformation between two chart values.

    The kind names carry the operational meaning: two `hex_shift(-40)`s do NOT
    equal a `hex_shift(-70)` — they equal `hex_shift(-80)`. The classifier
    below composes accordingly."""
    kind: str
    delta: Any = None        # numeric delta for hex_shift / num_add
    to: Any = None           # target value for set() / str_replace
    from_: Any = None        # source value

    def is_identity(self) -> bool:
        return self.kind == "identity"


def _flatten(spec: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Flatten to `dotted.path -> scalar` map. Lists are stringified as their
    JSON serialisation — the cocycle diagnostic is a bijection test on labels,
    and a JSON string is a fine finite label."""
    out: dict[str, Any] = {}
    for k, v in spec.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(_flatten(v, key))
        elif isinstance(v, list):
            out[key] = json.dumps(v, sort_keys=True)
        else:
            out[key] = v
    return out


def _hex_to_int(s: str) -> int | None:
    if not isinstance(s, str): return None
    m = HEX_RE.match(s.strip())
    if not m: return None
    body = m.group(1)
    if len(body) == 3:
        body = "".join(c*2 for c in body)
    return int(body, 16)


def _int_to_hex(n: int) -> str:
    n = max(0, min(0xFFFFFF, n))
    return f"#{n:06x}"


def _classify(a: Any, b: Any) -> Transform:
    """Compute a labelled transformation from value `a` to value `b`.

    Returned `.kind` is one of:
        identity | added | removed | hex_shift | num_add | set
    """
    if a == b:
        return Transform("identity", from_=a, to=b)
    if a is None:
        return Transform("added", to=b)
    if b is None:
        return Transform("removed", from_=a)
    if isinstance(a, str) and isinstance(b, str):
        ai, bi = _hex_to_int(a), _hex_to_int(b)
        if ai is not None and bi is not None:
            return Transform("hex_shift", delta=bi - ai, from_=a, to=b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return Transform("num_add", delta=b - a, from_=a, to=b)
    return Transform("set", from_=a, to=b)


def _compose(t_ab: Transform, t_bc: Transform) -> Transform:
    """Compose two transforms. If the kinds agree the composition is exact
    (hex_shift is additive, num_add is additive, identity absorbs). Otherwise
    we fall back to a `set(to=t_bc.to)` — the composite still lands on the
    right label, just without a semantically clean kind."""
    if t_ab.is_identity(): return t_bc
    if t_bc.is_identity(): return t_ab
    if t_ab.kind == "hex_shift" and t_bc.kind == "hex_shift":
        return Transform("hex_shift", delta=t_ab.delta + t_bc.delta,
                         from_=t_ab.from_, to=t_bc.to)
    if t_ab.kind == "num_add" and t_bc.kind == "num_add":
        return Transform("num_add", delta=t_ab.delta + t_bc.delta,
                         from_=t_ab.from_, to=t_bc.to)
    if t_ab.kind == "set" and t_bc.kind == "set":
        return Transform("set", from_=t_ab.from_, to=t_bc.to)
    # mixed kinds — collapse to a raw set of the final value
    return Transform("set", from_=t_ab.from_, to=t_bc.to)


def _same_map(t: Transform, u: Transform) -> bool:
    """TA-2 treats T_αβ as a *bijection on the target alphabet* 𝒯 — the maps
    themselves must agree, not just the images on one point. Two shifts of
    different deltas are different maps even if they happen to agree on the
    one input each spec witnesses.

    We approximate that by comparing (kind, delta): two `hex_shift(-40)`s are
    the same map; a `hex_shift(-40)` and a `set(to=…)` that land on the same
    hex are *not* — the second is not shift-shaped, and treating them as equal
    hides the very inconsistency TA-2 exists to surface."""
    if t.is_identity() and u.is_identity():
        return True
    if t.kind != u.kind:
        return False
    if t.kind in ("hex_shift", "num_add"):
        return t.delta == u.delta
    if t.kind in ("added", "removed"):
        return t.from_ == u.from_ and t.to == u.to
    # `set` — endpoint equality is the best we can do for arbitrary labels.
    return t.from_ == u.from_ and t.to == u.to


# ---------------------------------------------------------------------------
# cocycle check per triple
# ---------------------------------------------------------------------------


@dataclass
class TripleResult:
    a: str
    b: str
    c: str
    shared_fields: list[str]
    per_edge_nonid: dict[str, set[str]]  # edge label → set of fields moved
    discrepancy_fields: list[dict[str, Any]]
    rank: int
    verdict: str
    verdict_reason: str


def _pairwise_transitions(specs: dict[str, dict[str, Any]], names: tuple[str, str, str]) -> dict[str, dict[str, Transform]]:
    """Return {edge_label: {field: Transform}} for the three edges of the triple."""
    a, b, c = names
    flat = {n: _flatten(specs[n]) for n in names}
    common = set(flat[a]) & set(flat[b]) & set(flat[c])
    edges = {"AB": (a, b), "BC": (b, c), "AC": (a, c)}
    T: dict[str, dict[str, Transform]] = {}
    for label, (x, y) in edges.items():
        T[label] = {f: _classify(flat[x][f], flat[y][f]) for f in common}
    T["_common"] = list(common)  # type: ignore[assignment]
    return T


def _audit_triple(specs: dict[str, dict[str, Any]], names: tuple[str, str, str]) -> TripleResult:
    a, b, c = names
    T = _pairwise_transitions(specs, names)
    common: list[str] = T.pop("_common")  # type: ignore[assignment]
    T_AB, T_BC, T_AC = T["AB"], T["BC"], T["AC"]

    per_edge_nonid = {
        "AB": {f for f in common if not T_AB[f].is_identity()},
        "BC": {f for f in common if not T_BC[f].is_identity()},
        "AC": {f for f in common if not T_AC[f].is_identity()},
    }

    discrepancy_fields: list[dict[str, Any]] = []
    for f in common:
        composed = _compose(T_AB[f], T_BC[f])
        direct = T_AC[f]
        if not _same_map(composed, direct):
            discrepancy_fields.append({
                "field": f,
                "T_AB": T_AB[f].__dict__,
                "T_BC": T_BC[f].__dict__,
                "T_AC": T_AC[f].__dict__,
                "T_BC_o_T_AB": composed.__dict__,
            })

    rank = len(discrepancy_fields)
    all_edges_nonid = all(len(v) >= 1 for v in per_edge_nonid.values())

    # TA-2 classification (Theorem TA-2, §3, ~/Metaphysics of
    # Intelligence/Theory_Atlas_2026_08_03.pdf).
    if rank == 0:
        verdict = "glue"
        reason = "cocycle holds on every field in the shared support."
    elif all_edges_nonid:
        verdict = "missing_latent"
        sorted_edges = {k: sorted(v) for k, v in per_edge_nonid.items()}
        reason = (
            f"rank {rank}: every pairwise edge carries non-identity transitions "
            f"({sorted_edges}); no chart is individually anomalous. The schema "
            f"is quotienting over a coordinate — add a field named by the widest "
            f"discrepancy."
        )
    else:
        # rank ≥ 1 but at least one T_αβ is identity — boundary / phase.
        trivial_edges = [e for e, s in per_edge_nonid.items() if not s]
        verdict = "phase_transition"
        reason = (
            f"rank {rank}: some edges carry no transitions ({trivial_edges}); "
            "the obstruction is localised — a legitimate scale/phase boundary "
            "between two self-consistent regions."
        )

    return TripleResult(
        a=a, b=b, c=c,
        shared_fields=sorted(common),
        per_edge_nonid={k: set(v) for k, v in per_edge_nonid.items()},
        discrepancy_fields=discrepancy_fields,
        rank=rank,
        verdict=verdict,
        verdict_reason=reason,
    )


# ---------------------------------------------------------------------------
# report writer
# ---------------------------------------------------------------------------


def _emit_report(results: list[TripleResult], rooms: list[str], schema_path: Path) -> str:
    lines: list[str] = []
    lines.append("# Cocycle audit report")
    lines.append("")
    lines.append("Diagnostic per Theorem TA-2 (Theory Atlas, 2026-08-03). For each")
    lines.append("adjacent triple of rooms, we compute the cocycle discrepancy")
    lines.append("`D_ABC := T_AC⁻¹ ∘ T_BC ∘ T_AB` on the shared spec fields and")
    lines.append("classify by rank:")
    lines.append("")
    lines.append("- **rank 0** → `glue`; the compiler is self-consistent here.")
    lines.append("- **rank ≥ 1 on all edges** → `missing_latent`; the schema needs a field.")
    lines.append("- **rank ≥ 1 on some edges** → `phase_transition`; a legitimate boundary.")
    lines.append("")
    lines.append(f"Rooms audited: `{', '.join(rooms)}`")
    lines.append(f"Schema: `{schema_path}`")
    lines.append("")
    for r in results:
        lines.append(f"## triple ({r.a}, {r.b}, {r.c}) — {r.verdict}")
        lines.append("")
        lines.append(f"- rank: **{r.rank}**")
        lines.append(f"- shared fields: {len(r.shared_fields)}")
        lines.append(f"- non-identity edges: AB={len(r.per_edge_nonid['AB'])}, "
                     f"BC={len(r.per_edge_nonid['BC'])}, AC={len(r.per_edge_nonid['AC'])}")
        lines.append(f"- verdict: **{r.verdict}** — {r.verdict_reason}")
        if r.discrepancy_fields:
            lines.append("")
            lines.append("### discrepancy fields")
            lines.append("")
            for d in r.discrepancy_fields[:20]:
                lines.append(f"- `{d['field']}`")
                lines.append(f"  - T_AB: `{d['T_AB']}`")
                lines.append(f"  - T_BC: `{d['T_BC']}`")
                lines.append(f"  - T_AC (direct): `{d['T_AC']}`")
                lines.append(f"  - T_BC ∘ T_AB (composed): `{d['T_BC_o_T_AB']}`")
            if len(r.discrepancy_fields) > 20:
                lines.append(f"- … and {len(r.discrepancy_fields) - 20} more")
        lines.append("")
    if not results:
        lines.append("_No triples audited — need at least 3 rooms in `--rooms`._")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def run_audit(args: argparse.Namespace) -> int:
    rooms = [r.strip().lstrip("/") for r in args.rooms if r.strip()]
    if len(rooms) < 3:
        print("[cocycle-audit] need at least 3 rooms; TA-2 requires triples.", file=sys.stderr)
        return 2

    specs: dict[str, dict[str, Any]] = {}
    for key in rooms:
        try:
            specs[key] = _derive_or_load(key)
        except FileNotFoundError as e:
            print(f"[cocycle-audit] {e}", file=sys.stderr)
            return 2

    results: list[TripleResult] = []
    for a, b, c in combinations(rooms, 3):
        results.append(_audit_triple(specs, (a, b, c)))

    report = _emit_report(results, rooms, Path(args.schema))
    out = Path(args.report).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")

    # Console summary
    counts = {"glue": 0, "phase_transition": 0, "missing_latent": 0}
    for r in results:
        counts[r.verdict] = counts.get(r.verdict, 0) + 1
    print(f"[cocycle-audit] triples: {len(results)} — {counts}")
    for r in results:
        print(f"[cocycle-audit]   ({r.a},{r.b},{r.c})  rank={r.rank}  → {r.verdict}")
    print(f"[cocycle-audit] report: {out}")
    return 0 if counts.get("missing_latent", 0) == 0 else 1


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="cocycle-audit.py",
        description="Theory Atlas TA-2 cocycle diagnostic over adjacent room specs.",
    )
    p.add_argument("--rooms", nargs="+", default=DEFAULT_ROOMS,
                   help="Room keys (or `/routes`) to audit as one context.")
    p.add_argument("--schema", default=str(DEFAULT_SCHEMA),
                   help="Schema path (recorded in the report; not parsed).")
    p.add_argument("--report", default=str(DEFAULT_REPORT),
                   help="Output markdown report path.")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    return run_audit(args)


if __name__ == "__main__":
    raise SystemExit(main())
