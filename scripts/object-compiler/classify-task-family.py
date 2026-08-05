#!/usr/bin/env python3
"""
classify-task-family.py — LLM-assisted task-family classification for the
`unknown` bucket in `data/object-compiler/prs.jsonl`.

Companion to:
    scripts/object-compiler/extract-git-history.py   (heuristic classifier)
    docs/plans/object-compiler.md                    (phase-2 Track B)

The heuristic in `_infer_task_family` labels ~40% of the merged-PR archive
into named families (new-room, mechanic-improvement, bugfix, guide-update,
refactor-shared, contract-audit, infra, migration, docs, chore) but leaves
~60% as "unknown" — mostly `feat(<room>):` PRs that touch a mix of
components + lib + rooms directories.

This script asks a local `claude --print` (haiku by default) to classify
each unknown PR into one of those ten known families, or into an
`other-<name>` bucket if a new recurring pattern shows up. The classifier
reads title, body prefix, first three commit messages, the first thirty
files touched, and the first ~3000 characters of the saved patch. The LLM
returns a JSON verdict with a confidence score and one sentence of
reasoning; the row is stamped with three new fields:

    task_family_llm            — the LLM's chosen family
    task_family_llm_confidence — 0.0–1.0 self-reported confidence
    task_family_llm_reasoning  — one-sentence rationale

The original `task_family` field is preserved untouched, so both signals
live side by side. `--min-confidence` (default 0.6) leaves any low-conf
verdicts as `task_family_llm = "unknown"`.

Resumable:
    Rows with a non-null `task_family_llm` are skipped on the next run
    unless `--reclassify-all` is set. Progress is checkpointed to
    `prs.jsonl` every `--checkpoint-every` classifications (default 8),
    written atomically via a rename. `Ctrl+C` mid-run loses at most one
    batch's worth of work.

Rate-limit-aware:
    Bounded parallelism (`--concurrency`, default 4) via a thread pool.
    On an "api_error" or "rate limit" response the worker sleeps with
    exponential backoff (2s → 4s → 8s → 16s, capped) and retries up to
    `--max-retries` times. A PR that exhausts retries stays with
    `task_family_llm = None` and can be picked up on a rerun.

Constraints:
    - Stdlib only. No third-party HTTP or YAML.
    - subprocess.run for every external tool; explicit timeouts.
    - No wall-clock in the emitted rows (only in log lines).

Usage:
    python3 scripts/object-compiler/classify-task-family.py --help
    python3 scripts/object-compiler/classify-task-family.py
    python3 scripts/object-compiler/classify-task-family.py --dry-run
    python3 scripts/object-compiler/classify-task-family.py --reclassify-all
    python3 scripts/object-compiler/classify-task-family.py --min-confidence 0.7
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

CLAUDE = "/Users/jawaun/.local/bin/claude"

DEFAULT_PRS_JSONL = "data/object-compiler/prs.jsonl"

# The canonical family list. The LLM is asked to prefer these; it may
# emit `other-<slug>` for a novel recurring pattern.
KNOWN_FAMILIES = [
    "new-room",
    "mechanic-improvement",
    "bugfix",
    "guide-update",
    "refactor-shared",
    "contract-audit",
    "infra",
    "migration",
    "docs",
    "chore",
]

# Character budgets — cheap way to bound prompt size and cost.
BODY_MAX = 500
COMMIT_MSG_MAX = 400          # per commit message
COMMIT_MSG_COUNT = 3
FILES_MAX = 30
PATCH_MAX = 3000

# LLM guidance — read once at prompt-build time, embedded in every request.
FAMILY_GUIDANCE = """\
Task families you may choose from:

- new-room: introduces a new interactive "room" at src/rooms/<key>/.
  Signature: `room.config.ts` is newly added, plus a page.tsx/layout,
  plus a <Room>.tsx component, plus at least one src/lib/<domain>.ts
  physics module, plus an entry in src/rooms/registry.ts and often
  public/guide/<key>.jpg. Line count usually >600.
- mechanic-improvement: adds or reworks the mechanics of an existing
  single room, its shader, its physics module, or its verb wiring.
  Typical footprint: one src/components/<Room>.tsx plus one
  src/lib/<domain>.ts plus small config edits. Room already existed.
- bugfix: repairs an observable defect. Title often starts "fix(",
  "hotfix", "repair", or body describes what was wrong and what is now
  right. Small line delta, focused on the failing surface.
- guide-update: edits src/data/guide.ts or drops new public/guide/*.jpg
  screenshots. The dominant intent is guide prose / screenshots.
- refactor-shared: touches only shared code under src/lib/scene/,
  src/lib/webgl/, src/lib/gesture/, or the <RoomShell>. No room-
  specific behavior changes.
- contract-audit: adds or edits scripts/test-*.mjs contract tests
  without meaningful production code changes.
- infra: CI, deploy, Railway config, package.json, tsconfig, or other
  build/toolchain surfaces. Not code, not tests.
- migration: schema, spec, or corpus-format migrations (e.g. moving
  files between directories, renaming keys, changing the shape of
  data files). Title often contains "migrat" / "migration" / "schema".
- docs: docs/, README, INSPIRATION.md, DESIGN.md, AGENTS.md — text-
  only, no code changes.
- chore: dependency bumps, small housekeeping edits, formatting-only
  changes, gitignore, small renames.

If the PR does not fit any of the above and a recurring pattern is
visible (e.g. multiple PRs of the same shape), you may propose
`other-<short-slug>` (e.g. `other-atlas-tuning`, `other-plan-doc`,
`other-audio`). Use a family from the canonical list when at all
plausible; reserve `other-` for genuinely novel structural patterns.
"""

PROMPT_INSTRUCTIONS = """\
You are classifying a merged pull request into one task family. Read
the metadata below and output exactly one JSON object on a single line
of the form:

    {"task_family": "<name>", "confidence": 0.0-1.0, "reasoning": "<one sentence>"}

- `task_family` must be one of the canonical families above, or a new
  `other-<slug>` label if none fit.
- `confidence` is your own calibrated confidence in [0.0, 1.0].
- `reasoning` is one short sentence naming the signal that drove the
  choice (e.g. "adds new src/rooms/<key>/room.config.ts + shader +
  domain module + registry patch").

Output the JSON object and nothing else. No prose, no code fence, no
preamble. If you are unsure, still return a single best guess with a
low `confidence` — the caller has its own threshold.
"""

# --- IO helpers -----------------------------------------------------------


def _log(msg: str, *, quiet: bool) -> None:
    if not quiet:
        print(msg, file=sys.stderr, flush=True)


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def _write_jsonl_atomic(path: Path, rows: list[dict[str, Any]]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False))
            fh.write("\n")
    tmp.replace(path)


def _read_patch_prefix(patch_path: Path, limit: int) -> str:
    """Read the first `limit` characters of a patch file. Byte-safe:
    patches occasionally contain non-UTF-8 sequences inside GLSL strings
    or binary snapshot fixtures; we decode with `errors=replace`."""
    if not patch_path.exists():
        return ""
    try:
        raw = patch_path.read_bytes()
    except OSError:
        return ""
    return raw[:limit].decode("utf-8", errors="replace")


# --- prompt construction --------------------------------------------------


def _truncate(text: str, limit: int) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... [truncated at {limit} chars] ..."


def build_prompt(row: dict[str, Any], repo: Path) -> str:
    """Compose the LLM prompt for one PR."""
    title = row.get("title", "") or ""
    body = _truncate(row.get("body", "") or "", BODY_MAX)
    commit_msgs = row.get("commit_messages", []) or []
    commit_msgs = [
        _truncate(str(m), COMMIT_MSG_MAX) for m in commit_msgs[:COMMIT_MSG_COUNT]
    ]
    files = row.get("files_touched", []) or []
    files_slice = files[:FILES_MAX]
    files_note = ""
    if len(files) > FILES_MAX:
        files_note = f"\n... [{len(files) - FILES_MAX} more files omitted] ..."

    patch_prefix = ""
    patch_rel = row.get("patch_path")
    if isinstance(patch_rel, str) and patch_rel:
        patch_path = (repo / patch_rel).resolve()
        patch_prefix = _read_patch_prefix(patch_path, PATCH_MAX)

    additions = row.get("additions", 0)
    deletions = row.get("deletions", 0)
    files_touched_count = len(files)

    heuristic = row.get("task_family", "unknown")

    parts: list[str] = []
    parts.append(FAMILY_GUIDANCE)
    parts.append("")
    parts.append("=" * 60)
    parts.append(f"PR #{row.get('pr_number')} — {title}")
    parts.append("=" * 60)
    parts.append("")
    parts.append(f"Heuristic label (may be wrong): {heuristic}")
    parts.append(
        f"Size: +{additions} / -{deletions} lines across "
        f"{files_touched_count} files"
    )
    parts.append("")
    parts.append("--- PR body (prefix) ---")
    parts.append(body if body else "(empty)")
    parts.append("")
    parts.append("--- Commit messages (first 3) ---")
    if commit_msgs:
        for i, m in enumerate(commit_msgs, start=1):
            parts.append(f"[{i}] {m}")
            parts.append("")
    else:
        parts.append("(none)")
        parts.append("")
    parts.append("--- Files touched (first 30) ---")
    for p in files_slice:
        parts.append(p)
    if files_note:
        parts.append(files_note)
    parts.append("")
    parts.append("--- Patch prefix (first 3000 chars) ---")
    parts.append(patch_prefix if patch_prefix else "(no patch available)")
    parts.append("")
    parts.append(PROMPT_INSTRUCTIONS)
    return "\n".join(parts)


# --- claude call ----------------------------------------------------------


_JSON_OBJECT_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)


class _Backoff(RuntimeError):
    """Raised when the claude CLI returns a rate-limit / transient error
    and the caller should retry after sleeping."""


def _extract_json(text: str) -> dict[str, Any] | None:
    """Pull the first `{...}` object out of an LLM response, tolerating
    code fences, prose preambles, and stray trailing text."""
    if not text:
        return None
    # Strip a common ```json ... ``` fence.
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        candidate = fenced.group(1)
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    # Fall back to the first balanced-looking JSON object.
    # We look for the first `{` and try to parse successive endings.
    start = text.find("{")
    if start == -1:
        return None
    # Try progressively longer suffixes so we match a nested object.
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start : i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    return None
    return None


def call_claude(
    prompt: str,
    *,
    model: str,
    timeout: int,
) -> str:
    """One-shot invocation of the local claude CLI. Returns the raw
    `result` field (the model's text output) or raises _Backoff on a
    detected rate-limit / transient failure."""
    cmd = [
        CLAUDE,
        "--print",
        "--model", model,
        "--output-format", "json",
    ]
    proc = subprocess.run(
        cmd,
        input=prompt,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        # The CLI itself failed to launch; treat as backoff-worthy.
        raise _Backoff(f"claude exit {proc.returncode}: {proc.stderr.strip()[:200]}")

    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise _Backoff(f"claude stdout not JSON: {exc}") from exc

    if envelope.get("is_error"):
        # `terminal_reason=api_error`, rate-limit strings, etc.
        result = envelope.get("result") or ""
        reason = envelope.get("terminal_reason", "")
        raise _Backoff(f"api_error ({reason}): {str(result)[:200]}")

    result = envelope.get("result")
    if not isinstance(result, str):
        raise _Backoff("claude returned no result field")
    return result


# --- classification worker ------------------------------------------------


_PRINT_LOCK = threading.Lock()


def classify_one(
    row: dict[str, Any],
    *,
    repo: Path,
    model: str,
    timeout: int,
    max_retries: int,
    quiet: bool,
) -> dict[str, Any] | None:
    """Classify one PR. Returns a dict with the three new fields, or None
    on exhausted retries. Never raises."""
    prompt = build_prompt(row, repo)
    backoff = 2.0
    max_backoff = 32.0
    last_err = ""
    for attempt in range(max_retries + 1):
        try:
            text = call_claude(prompt, model=model, timeout=timeout)
        except (_Backoff, subprocess.TimeoutExpired) as exc:
            last_err = str(exc)[:200]
            if attempt >= max_retries:
                with _PRINT_LOCK:
                    _log(
                        f"  PR #{row.get('pr_number')}: exhausted "
                        f"{max_retries} retries: {last_err}",
                        quiet=quiet,
                    )
                return None
            with _PRINT_LOCK:
                _log(
                    f"  PR #{row.get('pr_number')}: retry {attempt + 1} "
                    f"after {backoff:.0f}s ({last_err})",
                    quiet=quiet,
                )
            time.sleep(backoff)
            backoff = min(max_backoff, backoff * 2)
            continue

        verdict = _extract_json(text)
        if not verdict:
            last_err = f"no JSON parseable from: {text[:200]!r}"
            if attempt >= max_retries:
                with _PRINT_LOCK:
                    _log(
                        f"  PR #{row.get('pr_number')}: unparseable, giving up: "
                        f"{last_err}",
                        quiet=quiet,
                    )
                return None
            with _PRINT_LOCK:
                _log(
                    f"  PR #{row.get('pr_number')}: unparseable, retry "
                    f"{attempt + 1}: {last_err}",
                    quiet=quiet,
                )
            time.sleep(backoff)
            backoff = min(max_backoff, backoff * 2)
            continue

        family = str(verdict.get("task_family", "") or "").strip()
        try:
            confidence = float(verdict.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))
        reasoning = str(verdict.get("reasoning", "") or "").strip()

        # Normalize: known family kept as-is; "other-*" kept as-is;
        # anything else coerced to "unknown".
        if family in KNOWN_FAMILIES or family.startswith("other-"):
            pass
        elif not family:
            family = "unknown"
        else:
            # Reject inventions that don't follow the "other-" convention.
            family = "other-" + re.sub(r"[^a-z0-9-]+", "-", family.lower()).strip("-")

        return {
            "task_family_llm": family,
            "task_family_llm_confidence": confidence,
            "task_family_llm_reasoning": reasoning[:400],
        }

    return None


# --- driver ---------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "LLM-assisted task-family classification for merged PRs in the "
            "Object Compiler corpus. Reads and updates prs.jsonl in place."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--repo",
        default=os.getcwd(),
        help="path to the local git checkout (for resolving patch_path)",
    )
    parser.add_argument(
        "--prs",
        default=DEFAULT_PRS_JSONL,
        help="path to prs.jsonl (repo-relative or absolute)",
    )
    parser.add_argument(
        "--model",
        default="haiku",
        help="claude model alias to use (haiku is cheap and fast enough)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="max concurrent claude calls",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="per-call subprocess timeout in seconds",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="max retries per PR on transient failure or rate-limit",
    )
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.6,
        help=(
            "PRs with LLM confidence below this stay as task_family_llm='unknown' "
            "(the raw LLM verdict is preserved in task_family_llm_reasoning)"
        ),
    )
    parser.add_argument(
        "--only-unknown",
        dest="only_unknown",
        action="store_true",
        default=True,
        help="only classify rows with task_family=='unknown' (default)",
    )
    parser.add_argument(
        "--reclassify-all",
        dest="reclassify_all",
        action="store_true",
        default=False,
        help=(
            "opt-in: reclassify every row, ignoring both the heuristic label "
            "and any prior task_family_llm value"
        ),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="if > 0, stop after this many classifications (for smoke tests)",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=8,
        help="write prs.jsonl to disk after this many completions",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="build prompts and print one, but do not call claude or write output",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="suppress progress output on stderr",
    )
    return parser.parse_args(argv)


def _select_targets(
    rows: list[dict[str, Any]],
    *,
    reclassify_all: bool,
    only_unknown: bool,
    limit: int,
) -> list[int]:
    """Return the indexes in `rows` that need a fresh LLM classification."""
    idxs: list[int] = []
    for i, row in enumerate(rows):
        if not reclassify_all and row.get("task_family_llm"):
            continue
        if only_unknown and not reclassify_all:
            if row.get("task_family") != "unknown":
                continue
        idxs.append(i)
        if limit and len(idxs) >= limit:
            break
    return idxs


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo = Path(args.repo).resolve()
    prs_path = Path(args.prs)
    if not prs_path.is_absolute():
        prs_path = repo / prs_path
    if not prs_path.exists():
        print(f"error: {prs_path} does not exist", file=sys.stderr)
        return 2

    _log(f"repo: {repo}", quiet=args.quiet)
    _log(f"prs: {prs_path}", quiet=args.quiet)
    _log(f"model: {args.model}", quiet=args.quiet)

    rows = _load_jsonl(prs_path)
    _log(f"  loaded {len(rows)} PR rows", quiet=args.quiet)

    targets = _select_targets(
        rows,
        reclassify_all=args.reclassify_all,
        only_unknown=args.only_unknown,
        limit=args.limit,
    )
    _log(
        f"  {len(targets)} PRs need classification "
        f"(only_unknown={args.only_unknown}, reclassify_all={args.reclassify_all}, "
        f"limit={args.limit or 'off'})",
        quiet=args.quiet,
    )
    if not targets:
        _log("nothing to do", quiet=args.quiet)
        return 0

    if args.dry_run:
        sample_row = rows[targets[0]]
        prompt = build_prompt(sample_row, repo)
        _log(
            f"  --dry-run: would classify {len(targets)} PRs; "
            f"first target = PR #{sample_row.get('pr_number')}",
            quiet=args.quiet,
        )
        print("=" * 60, file=sys.stderr)
        print("SAMPLE PROMPT:", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        print(prompt, file=sys.stderr)
        return 0

    # Process in batches sized to args.concurrency, checkpointing every
    # args.checkpoint_every completions. Serial across batches so a
    # checkpoint always reflects a coherent quiescent state.
    completed = 0
    since_checkpoint = 0
    t0 = time.time()

    def _process(i: int) -> tuple[int, dict[str, Any] | None]:
        return i, classify_one(
            rows[i],
            repo=repo,
            model=args.model,
            timeout=args.timeout,
            max_retries=args.max_retries,
            quiet=args.quiet,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        # Submit in chunks the size of the pool + a little extra so the
        # pool always has work but we don't lose too much on Ctrl+C.
        chunk = max(args.concurrency, 4)
        try:
            for base in range(0, len(targets), chunk):
                batch = targets[base : base + chunk]
                futures = [pool.submit(_process, i) for i in batch]
                for fut in concurrent.futures.as_completed(futures):
                    i, verdict = fut.result()
                    completed += 1
                    if verdict is None:
                        with _PRINT_LOCK:
                            _log(
                                f"  [{completed}/{len(targets)}] "
                                f"PR #{rows[i].get('pr_number')}: FAILED",
                                quiet=args.quiet,
                            )
                        continue
                    # Apply the min-confidence gate: below-threshold verdicts
                    # keep task_family_llm='unknown' but the LLM's raw
                    # opinion is preserved in the reasoning field.
                    raw_family = verdict["task_family_llm"]
                    conf = verdict["task_family_llm_confidence"]
                    if conf < args.min_confidence:
                        rows[i]["task_family_llm"] = "unknown"
                        rows[i]["task_family_llm_confidence"] = conf
                        rows[i]["task_family_llm_reasoning"] = (
                            f"[below-threshold, raw={raw_family}] "
                            + verdict["task_family_llm_reasoning"]
                        )
                    else:
                        rows[i]["task_family_llm"] = raw_family
                        rows[i]["task_family_llm_confidence"] = conf
                        rows[i]["task_family_llm_reasoning"] = verdict[
                            "task_family_llm_reasoning"
                        ]
                    since_checkpoint += 1
                    with _PRINT_LOCK:
                        _log(
                            f"  [{completed}/{len(targets)}] "
                            f"PR #{rows[i].get('pr_number')}: "
                            f"{rows[i]['task_family_llm']} "
                            f"({conf:.2f})",
                            quiet=args.quiet,
                        )
                    if since_checkpoint >= args.checkpoint_every:
                        _write_jsonl_atomic(prs_path, rows)
                        since_checkpoint = 0
                        with _PRINT_LOCK:
                            _log(
                                f"    ...checkpoint: wrote {len(rows)} rows",
                                quiet=args.quiet,
                            )
        except KeyboardInterrupt:
            _log("interrupted — flushing final checkpoint", quiet=args.quiet)
            _write_jsonl_atomic(prs_path, rows)
            raise

    # Final flush.
    if since_checkpoint:
        _write_jsonl_atomic(prs_path, rows)
        _log(f"  final checkpoint: wrote {len(rows)} rows", quiet=args.quiet)

    dt = time.time() - t0
    _log(
        f"done: classified {completed} PRs in {dt:.0f}s "
        f"({dt / max(1, completed):.1f}s/PR)",
        quiet=args.quiet,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
