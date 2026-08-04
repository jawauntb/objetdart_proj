#!/usr/bin/env python3
"""
harness.py — M5 of the Object Compiler plan.

Wraps `scripts/object-compiler/compile-room.py` in an auditable, repeatable loop
against the site's own test bar: `tsc` + `npm test` (contract laws) + `next build`
+ a landed `/guide` screenshot. The harness never merges, never pushes, never
commits — it leaves a branch and a JSONL run log for a human to read.

Companion to:
    docs/plans/object-compiler.md  (M5 — The Harness)

Pipeline (each step is a `subprocess.run` call):
    (a) create a fresh worktree at `.claude/worktrees/harness-<timestamp>/`
        branched from the current HEAD
    (b) invoke `scripts/object-compiler/compile-room.py` inside the worktree
        with the given `--spec` or `--prose`
    (c) `npx tsc --noEmit`                                 (record first 20 errors)
    (d) `npm test`                                          (parse test:room-contract)
    (e) `npm run build`             (only if tests green)
    (f) `npm run shoot:guide -- --only <key>`              (if guide layer needs it)
    (g) compute reward
            r = 0.3 * tsc + 0.3 * npm_test + 0.2 * build + 0.2 * guide
        where each layer is a 0/1 indicator.
    (h) write full log to `<log-dir>/<timestamp>-<key>.jsonl`, one line per record
    (i) print a summary; if r >= 0.6 print the branch for review, else print the
        top failure and a suggested repair.

Soft-fail retry (`--retry-on-soft-fail`, default on): if a single class of tsc /
lint / test failure is detected, the failing slot is re-filled by re-invoking
compile-room.py with a `--repair-prompt` carrying the first error string. Up to
`--max-retries` attempts (default 3, including the first). Every attempt is
recorded; only the last attempt's reward is used for M6.

Constraints (from the plan):
    - No LLM calls happen here. Slot-fill is compile-room.py's job.
    - No `git commit`, no `git push`, no auto-merge.
    - The output of a successful run is a *branch* and a *log*.

Interface contract with compile-room.py (must accept):
    --spec <path>            OR  --prose "..."
    --target-dir <path>          the worktree to write into
    --repair-prompt "..."        optional; the harness passes this on retry
    --repair-slot <name>         optional; the slot to re-fill (shader | domain | verbs)
    --key <string>               optional override for the spec's room key
    --json-summary               emit a single JSON line to stdout summarising the
                                 spec key, files written, prompt tokens
    (exit code 0 on success, non-zero on failure)

If compile-room.py is missing the harness fails fast with a helpful message —
this milestone assumes M4 has landed.
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
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# defaults
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_LOG_DIR = REPO_ROOT / "data" / "object-compiler" / "runs"
DEFAULT_WORKTREE_ROOT = REPO_ROOT / ".claude" / "worktrees"
COMPILE_ROOM_SCRIPT = REPO_ROOT / "scripts" / "object-compiler" / "compile-room.py"

# Reward weights — mirrors the task's 0.3/0.3/0.2/0.2 formula. Sum is 1.0; any
# change here must be justified against the plan's stationary-reward assumption.
REWARD_WEIGHTS = {
    "tsc": 0.3,
    "npm_test": 0.3,
    "build": 0.2,
    "guide": 0.2,
}

# Cap the tsc/npm error tail so a broken run does not fill the JSONL with MBs.
MAX_ERROR_LINES = 20

# Command timeouts (seconds). tsc + build + tests can all run long; be generous
# but not infinite so a hung child doesn't wedge the whole harness.
CMD_TIMEOUT = {
    "compile": 60 * 15,
    "tsc": 60 * 5,
    "npm_test": 60 * 10,
    "build": 60 * 15,
    "shoot": 60 * 10,
}


# ---------------------------------------------------------------------------
# data types
# ---------------------------------------------------------------------------


@dataclass
class LayerResult:
    layer: str
    passed: bool
    exit_code: int | None
    duration_s: float
    error_head: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class AttemptRecord:
    attempt_index: int
    started_at: str
    finished_at: str
    layers: list[LayerResult]
    reward: float
    repair_prompt: str | None
    repair_slot: str | None
    compile_stdout_tail: list[str]
    compile_exit_code: int | None


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _read_spec_key(spec_path: Path) -> str:
    """Cheap YAML sniff for the room key. We don't need a full YAML parser —
    the schema pins `key: <slug>` at top level, and PyYAML is optional in this
    tool. Fall back to filename stem if the sniff fails."""
    try:
        for raw in spec_path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^key:\s*['\"]?([a-z0-9_-]+)['\"]?\s*$", raw.strip())
            if m:
                return m.group(1)
    except OSError:
        pass
    return spec_path.stem.replace(".spec", "")


def _tail(text: str, n: int) -> list[str]:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return lines[-n:]


def _first_error_class(text: str) -> str | None:
    """Best-effort: find the first tsc / jest / node error class in the output.
    Returns something like `TS2322` or `AssertionError` or `error TS...`, or
    None if no recognisable error line is present."""
    patterns = [
        r"error (TS\d{3,5}):",           # tsc
        r"\berror\s+([A-Z][A-Za-z0-9_]+):",
        r"\b(Assertion(?:Error)?)\b",    # node:assert
        r"^\s*(FAIL)\s",                  # jest/vitest banner
    ]
    for pat in patterns:
        m = re.search(pat, text, flags=re.MULTILINE)
        if m:
            return m.group(1)
    return None


def _run_cmd(
    cmd: list[str],
    *,
    cwd: Path,
    timeout: int,
    env_extra: dict[str, str] | None = None,
) -> tuple[int, str, str, float]:
    """Run a command, return (exit_code, stdout, stderr, duration_s). Never
    raises on a nonzero exit — the caller decides what a nonzero code means."""
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    started = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.returncode, proc.stdout, proc.stderr, time.monotonic() - started
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        return 124, stdout, stderr + f"\n[harness] timed out after {timeout}s", time.monotonic() - started


# ---------------------------------------------------------------------------
# worktree lifecycle
# ---------------------------------------------------------------------------


def _create_worktree(branch: str, worktree_dir: Path) -> None:
    """`git worktree add -b <branch> <dir>` from repo HEAD.

    Fails loud if either the worktree path already exists or the branch already
    exists — the harness owns freshness and will not silently reuse either."""
    if worktree_dir.exists():
        raise RuntimeError(f"worktree dir already exists: {worktree_dir}")
    worktree_dir.parent.mkdir(parents=True, exist_ok=True)
    rc, out, err, _ = _run_cmd(
        ["git", "worktree", "add", "-b", branch, str(worktree_dir), "HEAD"],
        cwd=REPO_ROOT,
        timeout=60,
    )
    if rc != 0:
        raise RuntimeError(
            f"git worktree add failed (rc={rc}):\n{out}\n{err}"
        )


def _diff_stat(worktree_dir: Path) -> str:
    """`git diff --stat HEAD` inside the worktree, returned as one string. Used
    for the run log's `final_diff_stat` field."""
    rc, out, _, _ = _run_cmd(
        ["git", "diff", "--stat", "HEAD"],
        cwd=worktree_dir,
        timeout=30,
    )
    if rc != 0:
        return ""
    return out.strip()


# ---------------------------------------------------------------------------
# layer runners
# ---------------------------------------------------------------------------


def _run_tsc(worktree: Path) -> LayerResult:
    rc, out, err, dur = _run_cmd(
        ["npx", "tsc", "--noEmit"],
        cwd=worktree,
        timeout=CMD_TIMEOUT["tsc"],
    )
    combined = (out + "\n" + err).strip()
    # tsc prints error lines to stdout; grab the first MAX_ERROR_LINES that
    # look like error diagnostics rather than "info" chatter.
    error_lines = [
        ln for ln in combined.splitlines()
        if re.search(r"error TS\d+", ln)
    ][:MAX_ERROR_LINES]
    return LayerResult(
        layer="tsc",
        passed=(rc == 0),
        exit_code=rc,
        duration_s=dur,
        error_head=error_lines,
        extra={"error_class": _first_error_class(combined)},
    )


_TEST_SCRIPT_RE = re.compile(r"^\s*(?:>|✓|✗|PASS|FAIL|ok|not ok)\s.*(test:[a-z0-9-]+)")


def _run_npm_test(worktree: Path) -> LayerResult:
    rc, out, err, dur = _run_cmd(
        ["npm", "test", "--silent"],
        cwd=worktree,
        timeout=CMD_TIMEOUT["npm_test"],
    )
    combined = (out + "\n" + err).strip()
    # Count test:room-contract explicitly — it is the load-bearing contract.
    room_contract_line = ""
    for ln in combined.splitlines():
        if "test:room-contract" in ln:
            room_contract_line = ln.strip()
    room_contract_passed = bool(room_contract_line) and "FAIL" not in room_contract_line.upper() and rc == 0
    # Total tests / failures — parsed loosely; different runners format differently.
    total_match = re.search(r"(\d+)\s+tests?\s+(?:total|passed|passing)", combined, re.IGNORECASE)
    fail_match = re.search(r"(\d+)\s+(?:failed|failing)", combined, re.IGNORECASE)
    error_lines = _tail(combined, MAX_ERROR_LINES) if rc != 0 else []
    return LayerResult(
        layer="npm_test",
        passed=(rc == 0),
        exit_code=rc,
        duration_s=dur,
        error_head=error_lines,
        extra={
            "room_contract_line": room_contract_line,
            "room_contract_passed": room_contract_passed,
            "total_tests_seen": int(total_match.group(1)) if total_match else None,
            "failures_seen": int(fail_match.group(1)) if fail_match else None,
            "error_class": _first_error_class(combined),
        },
    )


def _run_build(worktree: Path) -> LayerResult:
    rc, out, err, dur = _run_cmd(
        ["npm", "run", "build"],
        cwd=worktree,
        timeout=CMD_TIMEOUT["build"],
    )
    combined = (out + "\n" + err).strip()
    return LayerResult(
        layer="build",
        passed=(rc == 0),
        exit_code=rc,
        duration_s=dur,
        error_head=_tail(combined, MAX_ERROR_LINES) if rc != 0 else [],
    )


def _run_shoot_guide(worktree: Path, key: str) -> LayerResult:
    rc, out, err, dur = _run_cmd(
        ["npm", "run", "shoot:guide", "--", "--only", key],
        cwd=worktree,
        timeout=CMD_TIMEOUT["shoot"],
    )
    combined = (out + "\n" + err).strip()
    screenshot_path = worktree / "public" / "guide" / f"{key}.jpg"
    landed = screenshot_path.exists()
    return LayerResult(
        layer="guide",
        passed=(rc == 0 and landed),
        exit_code=rc,
        duration_s=dur,
        error_head=_tail(combined, MAX_ERROR_LINES) if not landed else [],
        extra={"screenshot_present": landed, "screenshot_path": str(screenshot_path)},
    )


# ---------------------------------------------------------------------------
# compile-room invocation
# ---------------------------------------------------------------------------


def _invoke_compile_room(
    worktree: Path,
    *,
    spec: Path | None,
    prose: str | None,
    key_hint: str | None,
    repair_prompt: str | None,
    repair_slot: str | None,
) -> tuple[int, str, str]:
    if not COMPILE_ROOM_SCRIPT.exists():
        raise RuntimeError(
            f"compile-room.py not found at {COMPILE_ROOM_SCRIPT}. "
            "The harness assumes M4 has landed; run the M4 milestone first."
        )
    cmd = [sys.executable, str(COMPILE_ROOM_SCRIPT), "--target-dir", str(worktree)]
    if spec is not None:
        cmd += ["--spec", str(spec)]
    if prose is not None:
        cmd += ["--prose", prose]
    if key_hint:
        cmd += ["--key", key_hint]
    if repair_prompt:
        cmd += ["--repair-prompt", repair_prompt]
    if repair_slot:
        cmd += ["--repair-slot", repair_slot]
    cmd += ["--json-summary"]
    rc, out, err, _ = _run_cmd(cmd, cwd=REPO_ROOT, timeout=CMD_TIMEOUT["compile"])
    return rc, out, err


# ---------------------------------------------------------------------------
# reward + soft-fail classification
# ---------------------------------------------------------------------------


def _compute_reward(layers: list[LayerResult]) -> float:
    by_layer = {L.layer: L for L in layers}
    r = 0.0
    for name, w in REWARD_WEIGHTS.items():
        if name in by_layer and by_layer[name].passed:
            r += w
    return round(r, 4)


def _soft_fail_repair_hint(layers: list[LayerResult]) -> tuple[str, str] | None:
    """If the failing layers point at a single class of error, return
    `(repair_slot, repair_prompt)` for the next retry. Return None if the
    failure is diffuse (e.g. build + tsc + tests all broken in different ways)
    — nothing to gain from another slot-fill in that case."""
    failing = [L for L in layers if not L.passed]
    if not failing:
        return None
    # Exactly one failing layer with a recognisable error class is the ideal
    # soft-fail signature: one thing missed, worth one more shot.
    if len(failing) == 1:
        L = failing[0]
        klass = L.extra.get("error_class") if isinstance(L.extra, dict) else None
        head = "\n".join(L.error_head[:5]) if L.error_head else ""
        # Route error classes to slots. tsc → likely a verb handler or shader
        # arg mismatch (VERB_HANDLERS or SHADER_BODY); test failures on the
        # domain module → DOMAIN_LAW; guide → not slot-fillable (shoot:guide is
        # deterministic), skip.
        if L.layer == "tsc":
            slot = "verbs" if "verb" in head.lower() else "shader"
        elif L.layer == "npm_test":
            slot = "domain"
        else:
            return None
        prompt = (
            f"Re-fill slot `{slot}` to fix the following {L.layer} failure. "
            f"First error class: {klass}. Error tail:\n{head}"
        )
        return slot, prompt
    return None


# ---------------------------------------------------------------------------
# top-level orchestration
# ---------------------------------------------------------------------------


def run_harness(args: argparse.Namespace) -> int:
    ts = _timestamp_slug()
    log_dir = Path(args.log_dir).expanduser().resolve()
    log_dir.mkdir(parents=True, exist_ok=True)

    # resolve spec / prose
    spec_path: Path | None = None
    key = "unknown"
    if args.spec:
        spec_path = Path(args.spec).expanduser().resolve()
        if not spec_path.exists():
            print(f"[harness] spec not found: {spec_path}", file=sys.stderr)
            return 2
        key = _read_spec_key(spec_path)
    elif args.prose:
        key = args.key or "prose"
    else:
        print("[harness] one of --spec or --prose is required", file=sys.stderr)
        return 2

    branch = args.branch or f"harness/{key}-{ts}"
    worktree_dir = (DEFAULT_WORKTREE_ROOT / f"harness-{ts}").resolve()
    log_path = log_dir / f"{ts}-{key}.jsonl"

    if args.dry_run:
        print("[harness] --dry-run; would run:")
        print(f"  git worktree add -b {branch} {worktree_dir} HEAD")
        print(f"  compile-room.py {'--spec ' + str(spec_path) if spec_path else '--prose ...'} --target-dir {worktree_dir}")
        print("  npx tsc --noEmit")
        print("  npm test")
        print("  npm run build")
        print(f"  npm run shoot:guide -- --only {key}")
        print(f"  log -> {log_path}")
        return 0

    _create_worktree(branch, worktree_dir)

    attempts: list[AttemptRecord] = []
    repair_prompt: str | None = None
    repair_slot: str | None = None

    for attempt_i in range(args.max_retries):
        started = _now_iso()
        rc, cout, cerr = _invoke_compile_room(
            worktree_dir,
            spec=spec_path,
            prose=args.prose,
            key_hint=key if key != "unknown" else None,
            repair_prompt=repair_prompt,
            repair_slot=repair_slot,
        )
        # If compile-room emitted --json-summary, its last stdout line is the
        # JSON blob; harvest a fresh key from it if we didn't have one.
        if key in ("prose", "unknown"):
            for ln in reversed(cout.splitlines()):
                ln = ln.strip()
                if ln.startswith("{") and ln.endswith("}"):
                    try:
                        obj = json.loads(ln)
                        if isinstance(obj, dict) and "key" in obj:
                            key = obj["key"]
                    except json.JSONDecodeError:
                        pass
                    break

        layers: list[LayerResult] = []
        if rc != 0:
            layers.append(LayerResult(
                layer="compile", passed=False, exit_code=rc,
                duration_s=0.0, error_head=_tail(cout + cerr, MAX_ERROR_LINES),
            ))
        else:
            layers.append(_run_tsc(worktree_dir))
            layers.append(_run_npm_test(worktree_dir))
            if all(L.passed for L in layers if L.layer in {"tsc", "npm_test"}):
                layers.append(_run_build(worktree_dir))
            else:
                layers.append(LayerResult(
                    layer="build", passed=False, exit_code=None,
                    duration_s=0.0, error_head=[],
                    extra={"skipped": "tests or tsc failed"},
                ))
            # guide: always attempt if we have a key; the shot itself is the
            # test signal.
            if key and key not in ("prose", "unknown"):
                layers.append(_run_shoot_guide(worktree_dir, key))
            else:
                layers.append(LayerResult(
                    layer="guide", passed=False, exit_code=None,
                    duration_s=0.0, error_head=[],
                    extra={"skipped": "no room key resolved"},
                ))

        reward = _compute_reward(layers)
        attempts.append(AttemptRecord(
            attempt_index=attempt_i,
            started_at=started,
            finished_at=_now_iso(),
            layers=layers,
            reward=reward,
            repair_prompt=repair_prompt,
            repair_slot=repair_slot,
            compile_stdout_tail=_tail(cout, 10),
            compile_exit_code=rc,
        ))

        if reward >= 1.0 or not args.retry_on_soft_fail:
            break
        # Ask for a repair hint. If none, stop retrying — nothing to reuse.
        hint = _soft_fail_repair_hint(layers)
        if hint is None:
            break
        repair_slot, repair_prompt = hint

    final = attempts[-1]
    diff_stat = _diff_stat(worktree_dir)

    # Log record — one JSONL line per attempt so a downstream reader can
    # separate retries from first-attempt reward.
    with log_path.open("w", encoding="utf-8") as fh:
        for a in attempts:
            record = {
                "timestamp": a.started_at,
                "spec_path": str(spec_path) if spec_path else None,
                "prose": args.prose if not spec_path else None,
                "worktree_path": str(worktree_dir),
                "branch": branch,
                "attempt_index": a.attempt_index,
                "layer_outcomes": {
                    L.layer: {
                        "passed": L.passed,
                        "exit_code": L.exit_code,
                        "duration_s": round(L.duration_s, 2),
                        "error_head": L.error_head,
                        "extra": L.extra,
                    } for L in a.layers
                },
                "reward": a.reward,
                "retries": a.attempt_index,
                "agent_repair_prompts": (
                    [a.repair_prompt] if a.repair_prompt else []
                ),
                "final_diff_stat": diff_stat if a is final else "",
                "notes": (
                    "final attempt" if a is final
                    else f"soft-fail retry follows (slot={a.repair_slot or '-'})"
                ),
            }
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    # Summary
    print(f"[harness] key={key} branch={branch}")
    print(f"[harness] worktree={worktree_dir}")
    print(f"[harness] log={log_path}")
    print(f"[harness] attempts={len(attempts)} final_reward={final.reward}")
    for L in final.layers:
        print(f"[harness]   {L.layer:<10} {'PASS' if L.passed else 'FAIL'}  {round(L.duration_s,1)}s")
    if final.reward >= 0.6:
        print(f"[harness] REVIEW-READY branch: {branch}")
    else:
        failing = [L for L in final.layers if not L.passed]
        top = failing[0] if failing else None
        if top is not None:
            head = "\n    ".join(top.error_head[:3])
            print(f"[harness] TOP-FAILURE {top.layer}:\n    {head}")
            hint = _soft_fail_repair_hint(final.layers)
            if hint:
                print(f"[harness] SUGGESTED-REPAIR slot={hint[0]}: {hint[1][:200]}")

    return 0 if final.reward >= 0.6 else 1


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="harness.py",
        description="Object Compiler M5 harness — wrap compile-room.py, compute reward, log.",
    )
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--spec", help="Path to a spec.yaml.")
    grp.add_argument("--prose", help="One-paragraph brief; compile-room.py derives the spec.")

    p.add_argument("--branch", help="Branch name for the fresh worktree. Default: harness/<key>-<ts>.")
    p.add_argument("--key", help="Room key hint (used when --prose is given).")
    p.add_argument(
        "--retry-on-soft-fail",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Re-invoke slot-fill on a single-class failure; up to --max-retries.",
    )
    p.add_argument("--max-retries", type=int, default=3, help="Max attempts including the first.")
    p.add_argument("--log-dir", default=str(DEFAULT_LOG_DIR), help="Directory for JSONL run logs.")
    p.add_argument("--dry-run", action="store_true", help="Print what would run and exit.")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    try:
        return run_harness(args)
    except RuntimeError as e:
        print(f"[harness] FATAL: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
