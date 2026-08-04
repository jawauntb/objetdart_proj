#!/usr/bin/env python3
"""
ecology.py — M6 of the Object Compiler plan.

Boltzmann reweighting of the generation *strategy* over accumulated run logs.
This is CT-2 (Compiler Tomography, 2026-08-03) turned on:

    K_{t+1}(dx | s)  =  K_t(dx | s) · exp(β · r(s, x))  /  Ξ_t(s)

    where Ξ_t(s) := Σ_{q^{-1}(s)} exp(β · r(s, x)) · K_t(dx | s)

The paper's monotone-improvement guarantee (Theorem CT-2):

    E_{K_{t+1}}[r(s, X) | s]  ≥  E_{K_t}[r(s, X) | s]   for every s, every t,

    with equality iff r is K_t(· | s)-a.s. constant on the fiber q^{-1}(s).

In words: as long as the reward has any variance across the strategy variants
the harness happened to sample, this update strictly improves expected reward.
Fixed points are exactly the reward-maximising kernels within the concern-
parameterised family. The exploration-exploitation dial is β: β → 0 gives the
identity update (no learning), β → ∞ collapses onto the empirical argmax.

Reference: `~/Metaphysics of Intelligence/Compiler_Tomography_2026_08_03.pdf`
§3 (Theorem CT-2) and §4 (worked example, 4-bit Boolean world).

This script is a stub-with-teeth: the algorithm is real, but the strategy
fingerprint we extract from a run log is coarse until compile-room.py starts
emitting an explicit `strategy` block. Once ≥10 runs exist in
`data/object-compiler/runs/`, running `python3 ecology.py` produces a fresh
`strategy.yaml` and prints the Boltzmann gradient direction (which parameters
would change and by how much). Below 10 runs it prints a wait-for-more-data
message and exits nonzero — CT-2's bound is asymptotic and applying it to two
runs is worse than useless.

Not learned here (from the plan):
    - the *schema* itself; that is hand-authored at M2 and stays there
    - the reward; if it starts moving under the compiler, the loop is off
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_RUNS_DIR = REPO_ROOT / "data" / "object-compiler" / "runs"
DEFAULT_STRATEGY_OUT = REPO_ROOT / "data" / "object-compiler" / "strategy.yaml"

MIN_RUNS_FOR_UPDATE = 10

# The Boltzmann update is applied to a distribution over *strategy variants*.
# A strategy variant is a joint choice of these parameters — the finite grid
# CT-1's identifiability guarantee lives on. The names match the fields the
# task requires in the output yaml.
STRATEGY_PARAMS: dict[str, list[Any]] = {
    "model_temperature": [0.2, 0.4, 0.7, 1.0],
    "n_shot_count":      [1, 2, 3, 5],
    "retrieval_top_k":   [1, 3, 5],
    "repair_max_tries":  [1, 2, 3],
    "template_variant":  ["baseline", "narrow-shader", "narrow-domain"],
}

# Uniform prior over each parameter's grid — this is K_0 for the fibre-wise
# Boltzmann update. In the parent paper's language, K_0 = K* (uniform base
# compiler) for the worked example. We start there too.
def _uniform_prior() -> dict[str, dict[Any, float]]:
    return {
        name: {v: 1.0 / len(values) for v in values}
        for name, values in STRATEGY_PARAMS.items()
    }


# ---------------------------------------------------------------------------
# fingerprint extraction from a run log
# ---------------------------------------------------------------------------


@dataclass
class Run:
    reward: float
    retries: int
    repair_prompt_count: int
    layer_outcomes: dict[str, bool]
    timestamp: str
    spec_path: str | None
    # coarse strategy fingerprint bucketed onto the STRATEGY_PARAMS grid
    fingerprint: dict[str, Any] = field(default_factory=dict)


def _bucket_temperature_from_prompts(prompt_count: int) -> float:
    # More repair prompts implies a hotter first pass (or a harder brief).
    # Coarse map until compile-room.py starts recording temperature directly.
    if prompt_count == 0: return 0.4
    if prompt_count == 1: return 0.7
    return 1.0


def _bucket_variant_from_repair_slot(prompts: list[str]) -> str:
    joined = " ".join(prompts).lower()
    if "shader" in joined:  return "narrow-shader"
    if "domain" in joined:  return "narrow-domain"
    return "baseline"


def _fingerprint_run(rec: dict[str, Any]) -> dict[str, Any]:
    """Extract the coarse strategy fingerprint from a harness JSONL record.

    Fields consulted, per the task: `agent_repair_prompts`, `retries`,
    `reward` (implicitly, via bucketing). When compile-room.py starts writing
    an explicit `strategy` block, this reader will prefer it; today it is
    inferred from what the harness recorded."""
    explicit = rec.get("strategy")
    if isinstance(explicit, dict):
        return {k: explicit.get(k) for k in STRATEGY_PARAMS}

    prompts = rec.get("agent_repair_prompts") or []
    retries = int(rec.get("retries") or 0)
    return {
        "model_temperature": _bucket_temperature_from_prompts(len(prompts)),
        "n_shot_count":      3,   # coarse default until recorded
        "retrieval_top_k":   3,   # coarse default until recorded
        "repair_max_tries":  max(1, min(3, retries + 1)),
        "template_variant":  _bucket_variant_from_repair_slot(prompts),
    }


def _iter_run_records(runs_dir: Path) -> Iterable[dict[str, Any]]:
    """Yield the *final attempt* record from each JSONL log. The final attempt
    is the one whose reward we treat as the sample's realised reward — retries
    are part of the strategy, not separate samples."""
    for path in sorted(runs_dir.glob("*.jsonl")):
        try:
            lines = [
                json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines()
                if ln.strip()
            ]
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[ecology] skipping {path}: {exc}", file=sys.stderr)
            continue
        if not lines:
            continue
        yield lines[-1]


def _load_runs(runs_dir: Path) -> list[Run]:
    runs: list[Run] = []
    for rec in _iter_run_records(runs_dir):
        fp = _fingerprint_run(rec)
        layers = rec.get("layer_outcomes") or {}
        layer_bool = {k: bool(v.get("passed")) if isinstance(v, dict) else bool(v) for k, v in layers.items()}
        runs.append(Run(
            reward=float(rec.get("reward") or 0.0),
            retries=int(rec.get("retries") or 0),
            repair_prompt_count=len(rec.get("agent_repair_prompts") or []),
            layer_outcomes=layer_bool,
            timestamp=str(rec.get("timestamp") or ""),
            spec_path=rec.get("spec_path"),
            fingerprint=fp,
        ))
    return runs


# ---------------------------------------------------------------------------
# CT-2 update
# ---------------------------------------------------------------------------


def _boltzmann_update(
    prior: dict[Any, float],
    samples: list[tuple[Any, float]],   # (value, reward) per run for one parameter
    beta: float,
) -> dict[Any, float]:
    """Apply K_{t+1}(v) ∝ K_t(v) · exp(β · r_hat(v)) marginally per parameter.

    r_hat(v) is the empirical mean reward over runs whose fingerprint had
    parameter = v. Values with no samples fall through as prior · exp(β · 0) =
    prior itself — they neither gain nor lose weight. Ξ is the parameter's
    partition function, computed at the end so the return is a proper
    probability distribution."""
    per_value_rewards: dict[Any, list[float]] = defaultdict(list)
    for v, r in samples:
        per_value_rewards[v].append(r)
    updated: dict[Any, float] = {}
    for v, p in prior.items():
        if per_value_rewards.get(v):
            r_hat = statistics.fmean(per_value_rewards[v])
        else:
            r_hat = 0.0
        updated[v] = p * math.exp(beta * r_hat)
    Z = sum(updated.values()) or 1.0
    return {v: w / Z for v, w in updated.items()}


def _argmax_value(dist: dict[Any, float]) -> Any:
    return max(dist.items(), key=lambda kv: kv[1])[0]


def _kl_divergence(p: dict[Any, float], q: dict[Any, float]) -> float:
    """KL(p || q) — nats. Small guard against log(0)."""
    eps = 1e-12
    total = 0.0
    for v, pv in p.items():
        qv = q.get(v, eps) or eps
        if pv > 0:
            total += pv * math.log(pv / qv)
    return total


# ---------------------------------------------------------------------------
# yaml emit (stdlib, no PyYAML — this file is small and shape-fixed)
# ---------------------------------------------------------------------------


def _yaml_scalar(v: Any) -> str:
    if isinstance(v, bool):   return "true" if v else "false"
    if isinstance(v, (int, float)): return repr(v)
    if v is None:             return "null"
    s = str(v)
    if any(c in s for c in ": #{}[]&*!|>'\"%@`,\n"):
        return json.dumps(s)
    return s


def _emit_strategy_yaml(
    updated: dict[str, dict[Any, float]],
    prior: dict[str, dict[Any, float]],
    n_runs: int,
    beta: float,
) -> str:
    lines: list[str] = []
    lines.append(f"# strategy.yaml — Boltzmann-updated generation strategy")
    lines.append(f"# generated_at: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append(f"# runs_used: {n_runs}")
    lines.append(f"# beta: {beta}")
    lines.append(f"# reference: docs/plans/object-compiler.md M6; Compiler Tomography §3")
    lines.append("")
    for name in STRATEGY_PARAMS:
        recommended = _argmax_value(updated[name])
        prior_dist = prior[name]
        post_dist = updated[name]
        kl = _kl_divergence(post_dist, prior_dist)
        prior_arg = _argmax_value(prior_dist)
        changed = recommended != prior_arg
        lines.append(f"{name}:")
        lines.append(f"  recommended: {_yaml_scalar(recommended)}")
        lines.append(f"  prior_argmax: {_yaml_scalar(prior_arg)}")
        lines.append(f"  changed: {'true' if changed else 'false'}")
        lines.append(f"  kl_from_prior_nats: {round(kl, 6)}")
        lines.append(f"  distribution:")
        for v, w in sorted(post_dist.items(), key=lambda kv: -kv[1]):
            lines.append(f"    - value: {_yaml_scalar(v)}")
            lines.append(f"      weight: {round(w, 6)}")
    lines.append("")
    lines.append("template_variant_weights:")
    for v, w in sorted(updated["template_variant"].items(), key=lambda kv: -kv[1]):
        lines.append(f"  {_yaml_scalar(v)}: {round(w, 6)}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def run_ecology(args: argparse.Namespace) -> int:
    runs_dir = Path(args.runs_dir).expanduser().resolve()
    if not runs_dir.exists():
        print(f"[ecology] runs dir does not exist: {runs_dir}", file=sys.stderr)
        return 2

    runs = _load_runs(runs_dir)
    print(f"[ecology] loaded {len(runs)} runs from {runs_dir}")

    if len(runs) < MIN_RUNS_FOR_UPDATE:
        print(
            f"[ecology] fewer than {MIN_RUNS_FOR_UPDATE} runs available; "
            f"CT-2's bound is asymptotic. Skipping update.",
            file=sys.stderr,
        )
        return 1

    prior = _uniform_prior()
    updated: dict[str, dict[Any, float]] = {}
    for name in STRATEGY_PARAMS:
        samples = [(r.fingerprint.get(name), r.reward) for r in runs]
        # Drop samples whose fingerprint value isn't on the finite grid — CT-1
        # is stated on the finite family; an off-grid sample is a bug in the
        # fingerprint extractor, not a data point.
        samples = [(v, r) for (v, r) in samples if v in prior[name]]
        updated[name] = _boltzmann_update(prior[name], samples, args.beta)

    # Log what would change and why
    print(f"[ecology] beta = {args.beta}")
    for name in STRATEGY_PARAMS:
        before = _argmax_value(prior[name])
        after = _argmax_value(updated[name])
        kl = _kl_divergence(updated[name], prior[name])
        direction = "→ shift" if before != after else "hold"
        print(f"[ecology]   {name:<20} {direction:<9} {before!r}  →  {after!r}   (KL={round(kl,4)})")

    yaml_text = _emit_strategy_yaml(updated, prior, len(runs), args.beta)

    if args.dry_run:
        print("[ecology] --dry-run; would write:")
        print(yaml_text)
        return 0

    out = Path(args.strategy_out).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(yaml_text, encoding="utf-8")
    print(f"[ecology] wrote {out}")
    return 0


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="ecology.py",
        description="CT-2 Boltzmann update on the generation strategy distribution.",
    )
    p.add_argument("--runs-dir", default=str(DEFAULT_RUNS_DIR),
                   help="Directory of harness JSONL run logs.")
    p.add_argument("--beta", type=float, default=1.0,
                   help="Sharpness of the Boltzmann update (β → 0: identity; β → ∞: argmax).")
    p.add_argument("--strategy-out", default=str(DEFAULT_STRATEGY_OUT),
                   help="Output path for the updated strategy.yaml.")
    p.add_argument("--dry-run", action="store_true",
                   help="Print the update summary and the yaml body without writing.")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    return run_ecology(args)


if __name__ == "__main__":
    raise SystemExit(main())
