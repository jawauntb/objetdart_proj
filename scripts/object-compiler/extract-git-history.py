#!/usr/bin/env python3
"""
extract-git-history.py — walk the merged PR archive of objetdart_proj and emit
one line per PR to `data/object-compiler/prs.jsonl`, joinable to session
transcripts by branch name and merge timestamp.

Companion to:
    docs/plans/object-compiler.md   (M1 — The Corpus)
    scripts/object-compiler/extract-corpus.py   (the s-side extractor)

This script produces the x-side: the realized code, its landing metadata, its
CI outcome, and a coarse task-family label. `pairs.jsonl` (the join of
sessions × PRs) is downstream of both extractors and lives elsewhere.

Approach:
    1. One `gh pr list --state merged --json ...` call fetches PR metadata,
       files, and the merge SHA for every merged PR in one shot. We
       deliberately do NOT ask gh for `commits` — GitHub's GraphQL layer
       expands each commit's `authors` connection and at limit=500 that
       exceeds the 500,000-node ceiling. Local `git log` is cheaper anyway.
    2. `git log <merge_sha>^..<merge_sha>` walks the feature-branch commits
       for each PR locally. No API budget, fast on a warm object database.
    3. One `gh pr checks <n>` call per PR resolves the CI outcome. This is
       ~260 calls; we back off on rate-limit and accept "unknown" if the API
       stops answering.
    4. Task-family inference is a small deterministic classifier over the
       (title, files, additions, deletions) tuple. See `_infer_task_family`
       for the rule ladder; `unknown` is a legitimate output.

Filters:
    - Only PRs with state=MERGED are emitted. Draft/closed/open are skipped
      by default. (The schema retains a `state` field for future extension.)
    - Pure branch-merge PRs (no file changes, or all commit subjects start
      with "Merge") are skipped.

Constraints (from the plan):
    - Stdlib only. No `requests`, no third-party YAML.
    - `subprocess.run` for every external tool; explicit timeouts and errors.
    - No random values, no wall-clock in the emitted rows (only in log lines).

Emitted line schema (per line of `prs.jsonl`):
    {
      "pr_number": int,
      "title": str,
      "body": str,                  first 2000 chars of PR description
      "state": "merged"|"closed"|"open",
      "author_login": str,
      "branch": str,                head branch — the pairing key to sessions
      "base_branch": str,           usually "main"
      "created_at": str (ISO),
      "merged_at": str (ISO) | null,
      "merge_sha": str | null,
      "commit_count": int,
      "files_touched": [str],       unique paths across the PR
      "additions": int,             total lines added
      "deletions": int,             total lines removed
      "commit_messages": [str],     each commit's subject+body
      "ci_outcome": "success"|"failure"|"cancelled"|"unknown",
      "task_family": str | null,    coarse label; may be "unknown"

      # Only when --include-patches is passed:
      "patch_path": str,            repo-relative path to the saved .patch file
      "patch_bytes": int,           size on disk of the patch file
      "patch_hunks": int,           count of "@@" hunk headers in the patch
    }

Also emits `data/object-compiler/prs-census.md`: totals, date range, family
breakdown, author breakdown, size distribution.

Usage:
    python3 scripts/object-compiler/extract-git-history.py --help
    python3 scripts/object-compiler/extract-git-history.py --limit 500
    python3 scripts/object-compiler/extract-git-history.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

GH = "/usr/local/bin/gh"
GIT = "git"

# Default output paths, relative to the repo root.
DEFAULT_OUT = "data/object-compiler/prs.jsonl"
DEFAULT_CENSUS = "data/object-compiler/prs-census.md"
DEFAULT_PATCHES_DIR = "data/object-compiler/pr-diffs"

# 512 KB — patches larger than this are still saved, but logged as "big" so
# a downstream consumer can budget accordingly. Never silently truncated.
BIG_PATCH_THRESHOLD = 512 * 1024

# Fields we request from `gh pr list` in one shot.
# NOTE: `commits` is deliberately omitted — including it triggers a GraphQL
# node-count overflow ("up to 1,000,000 possible nodes exceeds 500,000")
# because each commit's authors connection multiplies out at limit=500. We
# read commits locally via `git log` instead.
PR_LIST_FIELDS = ",".join([
    "number", "title", "body", "state", "author",
    "headRefName", "baseRefName",
    "createdAt", "mergedAt", "mergeCommit",
    "additions", "deletions",
    "files",
])

# Body cap per schema.
BODY_MAX = 2000

# --- subprocess wrappers --------------------------------------------------


def _run(cmd: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess:
    """Run a subprocess with a hard timeout, capturing stdout+stderr."""
    return subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, check=False,
    )


def _looks_like_rate_limit(text: str) -> bool:
    """Heuristic — gh emits 'rate limit', '403', or 'secondary rate' on throttle."""
    t = (text or "").lower()
    return (
        "rate limit" in t
        or "secondary rate" in t
        or "api rate" in t
        or "403" in t
        or "was submitted too quickly" in t
    )


# --- gh queries -----------------------------------------------------------


def fetch_prs(
    *,
    repo: Path,
    limit: int,
    since: str | None,
    state: str = "merged",
) -> list[dict[str, Any]]:
    """Fetch merged-PR metadata in one `gh pr list` call.

    `--since` isn't a supported flag on `gh pr list`, so we over-fetch by
    `limit` and post-filter on `mergedAt >= since` (ISO-8601 lexical compare
    works for Z-suffixed timestamps).
    """
    cmd = [
        GH, "pr", "list",
        "--repo", _repo_slug(repo),
        "--state", state,
        "--limit", str(limit),
        "--json", PR_LIST_FIELDS,
    ]
    proc = _run(cmd, timeout=180)
    if proc.returncode != 0:
        raise RuntimeError(
            f"gh pr list failed (exit {proc.returncode}):\n{proc.stderr.strip()}"
        )
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"gh pr list returned non-JSON: {exc}") from exc

    if since:
        data = [p for p in data if (p.get("mergedAt") or "") >= since]
    # Deterministic ordering: newest first (gh's default), then by number desc.
    data.sort(key=lambda p: p.get("number", 0), reverse=True)
    return data


def fetch_ci_outcome(repo: Path, pr_number: int) -> str:
    """Resolve CI outcome for one PR via `gh pr checks --json state,name`.

    Semantics:
        - If any check is failing/error → "failure"
        - Else if any check is cancelled → "cancelled"
        - Else if any check is pending → "unknown"
        - Else if there is at least one success → "success"
        - Else (no checks reported) → "unknown"

    On rate limit or transient failure, returns "unknown" and the caller
    handles backoff.
    """
    cmd = [
        GH, "pr", "checks", str(pr_number),
        "--repo", _repo_slug(repo),
        "--json", "state,name",
    ]
    proc = _run(cmd, timeout=45)
    if proc.returncode != 0:
        combined = (proc.stderr or "") + (proc.stdout or "")
        if _looks_like_rate_limit(combined):
            # Signal caller to back off.
            raise _RateLimit(combined.strip()[:200])
        # Some PRs simply have no checks — gh returns nonzero for that.
        # Treat as unknown rather than crashing.
        return "unknown"
    try:
        checks = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return "unknown"
    if not checks:
        return "unknown"

    states = [str(c.get("state", "")).upper() for c in checks]
    if any(s in {"FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED"} for s in states):
        return "failure"
    if any(s in {"CANCELLED", "CANCELED"} for s in states):
        return "cancelled"
    if any(s in {"PENDING", "QUEUED", "IN_PROGRESS", "WAITING"} for s in states):
        return "unknown"
    if any(s in {"SUCCESS", "NEUTRAL", "SKIPPED"} for s in states):
        return "success"
    return "unknown"


class _RateLimit(RuntimeError):
    """Raised when gh signals we've been throttled."""


# --- git queries ----------------------------------------------------------


# Record and field separators for `git log --format`. Using ASCII control
# codes avoids escaping headaches with commit messages that contain any
# amount of quoting, backticks, colons, or newlines.
_GIT_REC_SEP = "\x1e"  # \036 = record separator
_GIT_FLD_SEP = "\x1f"  # \037 = field separator
_GIT_FORMAT = f"%H{_GIT_FLD_SEP}%s{_GIT_FLD_SEP}%b{_GIT_REC_SEP}"


def git_log_commits(repo: Path, merge_sha: str | None) -> list[str]:
    """Return the commit subjects+bodies on the PR branch, via `git log`.

    Semantics:
        - `git log <merge>^..<merge>` walks everything reachable from the
          merge commit but not from its first parent. For a merge-commit-
          style PR that is: the merge commit itself + the feature branch's
          commits. For a squash- or rebase-merged PR that is just the
          single landed commit. Either way we get the commit messages
          attributed to this PR.
        - Empty return means we couldn't resolve the range (e.g., the merge
          commit was pruned by `git gc`, or the SHA is missing locally).
          The caller falls back to the PR body.

    Output shape (per commit): `"<subject>\\n\\n<body>"` when body is
    non-empty, else just `"<subject>"`. Matches gh's `messageHeadline +
    messageBody` shape so downstream consumers don't have to branch.
    """
    if not merge_sha:
        return []

    # `git rev-parse` first — quick check the SHA exists locally. Cheaper
    # than launching a full `git log` that will fail on the same condition.
    check = _run(
        [GIT, "-C", str(repo), "rev-parse", "--verify", f"{merge_sha}^{{commit}}"],
        timeout=15,
    )
    if check.returncode != 0:
        return []

    # `--no-merges` skips the merge commit itself when the PR landed as a
    # merge commit; its "message" is just GitHub's autogenerated summary
    # + a duplicate of the PR body, which we already keep separately.
    proc = _run(
        [
            GIT, "-C", str(repo), "log",
            "--no-merges",
            f"--format={_GIT_FORMAT}",
            f"{merge_sha}^..{merge_sha}",
        ],
        timeout=30,
    )
    if proc.returncode != 0:
        return []

    messages: list[str] = []
    for record in proc.stdout.split(_GIT_REC_SEP):
        record = record.strip("\n")
        if not record:
            continue
        parts = record.split(_GIT_FLD_SEP)
        if len(parts) < 3:
            continue
        _sha, subject, body = parts[0], parts[1], _GIT_FLD_SEP.join(parts[2:])
        subject = subject.strip()
        body = body.strip()
        if subject and body:
            messages.append(f"{subject}\n\n{body}")
        elif subject:
            messages.append(subject)
        elif body:
            messages.append(body)

    return messages


def git_added_paths(repo: Path, merge_sha: str | None) -> set[str]:
    """Return the paths this PR *added* (not just modified) as of merge.

    Uses `git diff <merge>^..<merge> --name-status --diff-filter=A`, which
    works uniformly for merge-commit, squash-merge, and rebase-merge PRs.

    Used by the classifier to distinguish `new-room` (a room.config.ts that
    didn't exist before this PR) from `mechanic-improvement` (a room.config.ts
    that already existed and got a few lines added).
    """
    if not merge_sha:
        return set()
    proc = _run(
        [
            GIT, "-C", str(repo), "diff",
            f"{merge_sha}^..{merge_sha}",
            "--name-status",
            "--diff-filter=A",
        ],
        timeout=20,
    )
    if proc.returncode != 0:
        return set()
    paths: set[str] = set()
    for line in proc.stdout.splitlines():
        # Format is "A\t<path>" (possibly with a rename suffix column we don't need).
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].startswith("A"):
            paths.add(parts[-1])
    return paths


def git_commit_count(repo: Path, merge_sha: str | None) -> int:
    """Count the commits attributed to a PR via the same range as
    `git_log_commits`. Returns 0 when the SHA is missing or the range
    resolves to nothing (e.g., first-ever commit on a branch)."""
    if not merge_sha:
        return 0
    proc = _run(
        [
            GIT, "-C", str(repo), "rev-list", "--count",
            "--no-merges",
            f"{merge_sha}^..{merge_sha}",
        ],
        timeout=15,
    )
    if proc.returncode != 0:
        return 0
    try:
        return int((proc.stdout or "0").strip())
    except ValueError:
        return 0


# --- patch extraction ----------------------------------------------------


def _git_patch_bytes(repo: Path, merge_sha: str, *, timeout: int = 60) -> bytes:
    """Return the PR's patch as raw bytes, or b'' if unavailable.

    Strategy (in order):
      1. `git show --format='' --patch <sha>` — this is the spec-mandated
         primary path. It works cleanly for squash- and rebase-merged PRs.
         For a **merge commit** (two parents) `git show` emits the *combined*
         diff, which is empty for a clean merge — we detect that and fall
         through to (2).
      2. `git diff <sha>^..<sha>` — first-parent to merge, which yields the
         full set of changes the feature branch introduced. Works uniformly
         for merge-commit, squash, and rebase merges. Empty return means
         the SHA is missing locally.

    Byte-mode is deliberate: patches routinely contain non-UTF-8 payloads
    (binary blobs, mixed encodings inside GLSL string literals, snapshot
    fixtures). Text mode would raise on the first offender.
    """
    show_cmd = [
        GIT, "-C", str(repo), "show",
        "--format=",  # empty format — suppress the commit header
        "--patch",
        "--no-color",
        merge_sha,
    ]
    proc = subprocess.run(
        show_cmd, capture_output=True, timeout=timeout, check=False,
    )
    if proc.returncode == 0 and proc.stdout:
        return proc.stdout

    diff_cmd = [
        GIT, "-C", str(repo), "diff",
        "--no-color",
        f"{merge_sha}^..{merge_sha}",
    ]
    proc = subprocess.run(
        diff_cmd, capture_output=True, timeout=timeout, check=False,
    )
    if proc.returncode == 0 and proc.stdout:
        return proc.stdout

    return b""


def _gh_pr_diff_bytes(repo: Path, pr_number: int, *, timeout: int = 90) -> bytes:
    """Fetch a PR's diff via `gh pr diff` — the last-resort fallback.

    Only invoked when both git strategies come back empty (missing SHA,
    shallow clone, empty combined diff). Byte-mode so the same encoding
    quirks handled in `_git_patch_bytes` don't crash us here.
    """
    cmd = [
        GH, "pr", "diff", str(pr_number),
        "--repo", _repo_slug(repo),
    ]
    proc = subprocess.run(
        cmd, capture_output=True, timeout=timeout, check=False,
    )
    if proc.returncode != 0:
        return b""
    return proc.stdout or b""


def _count_hunks(patch: bytes) -> int:
    """Count `@@` hunk headers in a unified-diff payload.

    A hunk header is a line whose first two characters are `@@`. Chunks of
    context inside a patch also may show `@@` inside indented lines (e.g., a
    file whose contents mention `@@`), which is why we anchor to
    start-of-line only. Robust enough for corpus stats.
    """
    if not patch:
        return 0
    count = 0
    # Iterate line-by-line without splitting into a huge list.
    start = 0
    n = len(patch)
    while start < n:
        end = patch.find(b"\n", start)
        if end == -1:
            end = n
        line = patch[start:end]
        if line.startswith(b"@@ "):
            count += 1
        start = end + 1
    return count


def extract_patch(
    *,
    repo: Path,
    pr_number: int,
    merge_sha: str | None,
    patch_path: Path,
    existing_bytes: int | None,
    quiet: bool,
) -> tuple[int, int, bool] | None:
    """Materialize one PR's patch on disk. Returns (bytes, hunks, was_regenerated).

    Idempotent: if `patch_path` already exists AND `existing_bytes` matches
    the on-disk size, we neither re-run git nor rewrite the file — we just
    read the existing patch to recount hunks and return.

    Returns None on hard failure (both git and gh came back empty and no
    prior patch file existed on disk).
    """
    # Fast path: prior run's file is present and its size matches what
    # `prs.jsonl` recorded — trust it, recount hunks from disk.
    if (
        existing_bytes is not None
        and patch_path.exists()
        and patch_path.stat().st_size == existing_bytes
    ):
        try:
            data = patch_path.read_bytes()
        except OSError:
            data = b""
        return existing_bytes, _count_hunks(data), False

    # Try git first (whether or not a stale file exists — we regenerate).
    data = b""
    if merge_sha:
        try:
            data = _git_patch_bytes(repo, merge_sha)
        except subprocess.TimeoutExpired:
            _log(f"  patch: git timeout for PR #{pr_number}", quiet=quiet)
            data = b""

    # Fallback: gh pr diff.
    if not data:
        try:
            data = _gh_pr_diff_bytes(repo, pr_number)
        except subprocess.TimeoutExpired:
            _log(f"  patch: gh timeout for PR #{pr_number}", quiet=quiet)
            data = b""

    if not data:
        # Preserve any pre-existing file on disk — don't wipe it with an
        # empty write. If none existed either, this PR has no patch.
        if patch_path.exists() and patch_path.stat().st_size > 0:
            existing = patch_path.read_bytes()
            return patch_path.stat().st_size, _count_hunks(existing), False
        _log(
            f"  patch: no diff available for PR #{pr_number} "
            f"(sha={merge_sha or 'None'})",
            quiet=quiet,
        )
        return None

    patch_path.parent.mkdir(parents=True, exist_ok=True)
    patch_path.write_bytes(data)
    n_bytes = len(data)
    hunks = _count_hunks(data)
    if n_bytes > BIG_PATCH_THRESHOLD:
        _log(
            f"  patch: PR #{pr_number} is {n_bytes / 1024:.0f} KB "
            f"({hunks} hunks) — larger than {BIG_PATCH_THRESHOLD // 1024} KB",
            quiet=quiet,
        )
    return n_bytes, hunks, True


def _load_previous_patch_stats(
    prs_jsonl: Path,
) -> dict[int, tuple[int, str]]:
    """Read the existing prs.jsonl (if any) and return {pr_number: (patch_bytes, patch_path)}.

    Missing file, missing fields, or a malformed row → that PR simply isn't
    in the returned dict. Callers treat that as "no prior state".
    """
    stats: dict[int, tuple[int, str]] = {}
    if not prs_jsonl.exists():
        return stats
    try:
        with prs_jsonl.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                num = row.get("pr_number")
                pb = row.get("patch_bytes")
                pp = row.get("patch_path")
                if isinstance(num, int) and isinstance(pb, int) and isinstance(pp, str):
                    stats[num] = (pb, pp)
    except OSError:
        pass
    return stats


def _load_previous_ci_outcomes(prs_jsonl: Path) -> dict[int, str]:
    """Read the existing prs.jsonl (if any) and return {pr_number: ci_outcome}.

    Used by --skip-ci to preserve prior CI outcomes across reruns instead of
    silently downgrading them to "unknown" — critical when re-running to
    add patches without re-polling the GitHub API.
    """
    outcomes: dict[int, str] = {}
    if not prs_jsonl.exists():
        return outcomes
    try:
        with prs_jsonl.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                num = row.get("pr_number")
                oc = row.get("ci_outcome")
                if isinstance(num, int) and isinstance(oc, str) and oc:
                    outcomes[num] = oc
    except OSError:
        pass
    return outcomes


# Fields written by downstream passes (e.g. classify-task-family.py) that
# extract-git-history.py must copy through on rerun rather than overwrite.
# The extractor owns everything shipped in `build_row`; these belong to
# other stages of the pipeline and are load-bearing for phase-2+ analyses.
_DOWNSTREAM_FIELDS = (
    "task_family_llm",
    "task_family_llm_confidence",
    "task_family_llm_reasoning",
)


def _load_previous_downstream_fields(
    prs_jsonl: Path,
) -> dict[int, dict[str, Any]]:
    """Return {pr_number: {field: value}} for any downstream-owned fields
    already present on the existing prs.jsonl rows.

    This preserves LLM-classifier verdicts and other analyses across
    reruns of extract-git-history.py. Without it, rerunning the extractor
    (even to only re-classify with a tightened heuristic) would silently
    wipe every task_family_llm on disk.
    """
    preserved: dict[int, dict[str, Any]] = {}
    if not prs_jsonl.exists():
        return preserved
    try:
        with prs_jsonl.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                num = row.get("pr_number")
                if not isinstance(num, int):
                    continue
                keep: dict[str, Any] = {}
                for field in _DOWNSTREAM_FIELDS:
                    if field in row:
                        keep[field] = row[field]
                if keep:
                    preserved[num] = keep
    except OSError:
        pass
    return preserved


def _repo_slug(repo: Path) -> str:
    """Resolve `owner/repo` from a local git checkout (fed to `gh --repo`)."""
    # Prefer the remote URL — `gh` needs owner/repo, not a filesystem path.
    proc = _run([GIT, "-C", str(repo), "remote", "get-url", "origin"], timeout=15)
    if proc.returncode != 0:
        raise RuntimeError(
            f"could not read git remote at {repo}: {proc.stderr.strip()}"
        )
    url = proc.stdout.strip()
    # Handle both git@github.com:owner/repo.git and https://github.com/owner/repo(.git)
    m = re.search(r"[:/]([^/:]+/[^/]+?)(?:\.git)?$", url)
    if not m:
        raise RuntimeError(f"could not parse remote URL: {url!r}")
    return m.group(1)


# --- classification -------------------------------------------------------


_TITLE_FIX = re.compile(r"^\s*(fix|hotfix|bug)\b", re.IGNORECASE)
_TITLE_CHORE = re.compile(r"^\s*chore\b", re.IGNORECASE)
_TITLE_DOCS = re.compile(r"^\s*docs?\b", re.IGNORECASE)
_TITLE_MIGRATION = re.compile(r"\b(migrat|migration|schema)\b", re.IGNORECASE)

# `feat(<key>): ...` — the site-wide commit convention. The <key> group is
# the room / subsystem the PR is scoped to.
_TITLE_FEAT_SCOPE = re.compile(r"^\s*feat\(([\w-]+)\):", re.IGNORECASE)

# Paths inside src/app/<key>/ that Next.js treats as the room entry-point.
_APP_ROOM_PAGE_RE = re.compile(r"^src/app/([^/]+)/page\.tsx$")
_APP_ROOM_LAYOUT_RE = re.compile(r"^src/app/([^/]+)/layout\.tsx$")
_COMPONENT_TSX_RE = re.compile(r"^src/components/[^/]+\.tsx$")

# feat(<key>): scopes that are cross-cutting system concepts, not rooms.
# When one of these appears as the title scope, the PR touches shared
# infrastructure and should NOT be flagged as a room mechanic improvement
# even when its footprint looks single-room-ish. Derived from the LLM
# `other-*` labels that contaminated a title-only rule (see phase-6 audit).
_NON_ROOM_TITLE_SCOPES = frozenset({
    "world",
    "scale",
    "guide",
    "home",
    "site",
    "gesture",
    "grammar",
    "rooms",
    "travel",
})


def _infer_task_family(
    *,
    title: str,
    files: list[dict[str, Any]],
    additions: int,
    deletions: int,
    added_paths: set[str] | None = None,
) -> str:
    """Classify a PR by its file footprint plus a light title override.

    Rules cascade: the first matching rule wins. Prefer specific patterns
    (a newly-created room manifest) over broad ones (a title starting with
    "fix"). Returns "unknown" when no rule fires — never crashes.
    """
    paths = [f.get("path", "") for f in files if isinstance(f, dict)]
    if not paths:
        # Merge-only PR or empty diff — let the caller drop it upstream, but
        # if we're asked to classify, "chore" is the closest safe answer.
        return "chore"

    added = added_paths or set()

    # 1. New room — a room.config.ts that was ADDED (not merely modified)
    #    in this PR. `added_paths` comes from `git diff --diff-filter=A`,
    #    which correctly separates a real new room from an edit to an
    #    existing one. Falls back to a size heuristic on the file's
    #    additions if we couldn't run git (e.g., shallow clone).
    for f in files:
        p = f.get("path", "")
        if not (p.startswith("src/rooms/") and p.endswith("/room.config.ts")):
            continue
        if p in added:
            return "new-room"
        # No git signal — fall back to "created" == addition-only file with
        # a size consistent with a real room manifest (~60+ lines).
        if not added_paths and int(f.get("additions", 0)) >= 40 and int(f.get("deletions", 0)) == 0:
            return "new-room"

    # 1b. New room (modern App Router convention) — rooms added after the
    #     src/rooms/<key>/ config migration land as a new src/app/<key>/
    #     directory with BOTH page.tsx and layout.tsx created in the same
    #     PR. Requires exactly one such <key> so multi-page PRs (grammar
    #     enforcement, peer-room rollouts) don't match, and excludes the
    #     'guide' key (the field guide adds page+layout but is documented
    #     surface, not a room).
    #     Phase-6 LLM-discovered pattern; purity = 23/25 = 92% on the
    #     heuristic-`unknown` bucket resolved to `new-room` by the LLM.
    if added:
        page_keys: set[str] = set()
        layout_keys: set[str] = set()
        for a in added:
            m = _APP_ROOM_PAGE_RE.match(a)
            if m:
                page_keys.add(m.group(1))
            m = _APP_ROOM_LAYOUT_RE.match(a)
            if m:
                layout_keys.add(m.group(1))
        if len(page_keys) == 1 and len(layout_keys) == 1 and page_keys == layout_keys:
            (only_key,) = page_keys
            if only_key != "guide":
                return "new-room"

    # 2. Guide update — the guide index or a landed screenshot.
    if any(
        p == "src/data/guide.ts"
        or p.startswith("public/guide/")
        for p in paths
    ):
        # Only tag as guide-update if the changes are guide-heavy; otherwise
        # fall through to more specific classifiers below.
        guide_paths = [
            p for p in paths
            if p == "src/data/guide.ts" or p.startswith("public/guide/")
        ]
        if len(guide_paths) / max(1, len(paths)) >= 0.5:
            return "guide-update"

    # 3. Docs-only.
    if all(p.startswith("docs/") or p.lower().startswith("readme") for p in paths):
        return "docs"

    # 4. Contract audit — the test scripts under `scripts/`.
    test_paths = [
        p for p in paths
        if p.startswith("scripts/test-") and p.endswith(".mjs")
    ]
    if test_paths and len(test_paths) / len(paths) >= 0.5:
        return "contract-audit"

    # 5. Infra — CI/deploy/config surfaces.
    infra_hits = [
        p for p in paths
        if p.startswith(".github/")
        or p == "railway.toml"
        or p.startswith("next.config")
        or p in {"package.json", "package-lock.json", "tsconfig.json", "vercel.json"}
    ]
    if infra_hits and len(infra_hits) / len(paths) >= 0.5:
        return "infra"

    # 6. Refactor-shared — only shared library modules touched.
    if paths and all(p.startswith("src/lib/") for p in paths):
        return "refactor-shared"

    # 7. Migration — title-signalled (there aren't many in this repo).
    if _TITLE_MIGRATION.search(title or ""):
        return "migration"

    # 8. Title-signalled bugfix or chore.
    if _TITLE_FIX.match(title or ""):
        return "bugfix"
    if _TITLE_CHORE.match(title or ""):
        return "chore"
    if _TITLE_DOCS.match(title or ""):
        return "docs"

    # 9a. Mechanic improvement (single-component signature) — polishes a
    #     specific room by modifying exactly one existing src/components/
    #     <Name>.tsx and touching at most 4 files total, without creating
    #     any new page/layout under src/app/. This is the "Redesign X",
    #     "Polish X", "<room>: rework" pattern that dominated pre-2026
    #     merges when titles didn't yet follow feat(<key>): convention.
    #     Phase-6 LLM-discovered pattern; purity = 47/49 = 96% on the
    #     heuristic-`unknown` bucket resolved by the LLM.
    modified_components = [
        p for p in paths
        if _COMPONENT_TSX_RE.match(p) and p not in added
    ]
    adds_app_path = any(p.startswith("src/app/") for p in added)
    if (
        len(modified_components) == 1
        and not adds_app_path
        and len(paths) <= 4
    ):
        return "mechanic-improvement"

    # 9b. Mechanic improvement (feat(<room>) scoped signature) — modern
    #     commits titled `feat(<key>): ...` where <key> is a room name
    #     (not one of the cross-cutting system scopes) that modify
    #     src/components/*.tsx without creating a new src/app/ entry,
    #     with a moderate footprint (<= 8 files, <= 1500 added lines).
    #     Phase-6 LLM-discovered pattern; purity = 35/38 = 92% on the
    #     heuristic-`unknown` bucket resolved by the LLM.
    title_scope = _TITLE_FEAT_SCOPE.match(title or "")
    if (
        title_scope
        and title_scope.group(1).lower() not in _NON_ROOM_TITLE_SCOPES
        and modified_components
        and not adds_app_path
        and len(paths) <= 8
        and int(additions or 0) <= 1500
    ):
        return "mechanic-improvement"

    # 9c. Mechanic improvement (legacy small-diff signature) — the original
    #     rule: any small (< 200 lines) change scoped to at most 3 files
    #     under src/components/, src/rooms/, or src/lib/. Kept as the final
    #     safety net for pre-convention PRs; the tighter rules above catch
    #     the modern shapes with higher precision.
    total_lines = int(additions or 0) + int(deletions or 0)
    if total_lines < 200:
        component_hits = [
            p for p in paths
            if p.startswith("src/components/")
            or p.startswith("src/rooms/")
            or p.startswith("src/lib/")
        ]
        if len(component_hits) <= 3:
            return "mechanic-improvement"

    return "unknown"


# --- row building ---------------------------------------------------------


def _norm_state(raw: str | None) -> str:
    """Normalize gh's uppercase state to the schema's lowercase enum."""
    s = (raw or "").lower()
    if s in {"merged", "closed", "open"}:
        return s
    # A merged PR is technically CLOSED with mergedAt set; gh uses "MERGED"
    # in the enum, so this branch is defensive.
    return "closed"


def _is_branch_merge_only(pr: dict[str, Any], commit_messages: list[str]) -> bool:
    """Detect a PR that is just merging one feature branch into main with no
    substantive changes — those aren't real (spec, realization) samples.

    Heuristics (any one triggers):
      - Zero files changed AND zero additions AND zero deletions.
      - Every commit message starts with "Merge " (case-insensitive) AND
        the file diff is small (<50 total lines).
    """
    additions = int(pr.get("additions", 0) or 0)
    deletions = int(pr.get("deletions", 0) or 0)
    files = pr.get("files") or []

    if not files and additions == 0 and deletions == 0:
        return True

    if commit_messages:
        subjects = [
            m.split("\n", 1)[0].strip().lower() for m in commit_messages if m
        ]
        if subjects and all(s.startswith("merge ") for s in subjects):
            if (additions + deletions) < 50:
                return True

    return False


def build_row(
    pr: dict[str, Any],
    *,
    commit_messages: list[str],
    commit_count: int,
    ci_outcome: str,
    added_paths: set[str] | None = None,
) -> dict[str, Any]:
    """Shape one merged-PR dict from `gh pr list` into the emitted schema.

    `commit_messages` and `commit_count` come from `git log` — we no longer
    ask gh for the commits field (see PR_LIST_FIELDS note).
    """
    files = pr.get("files") or []

    body = str(pr.get("body") or "")
    if len(body) > BODY_MAX:
        body = body[:BODY_MAX]

    # Fall back to the merge commit's own body / PR body if the git walk
    # was empty (e.g., merge_sha missing locally, or shallow clone).
    if not commit_messages and body:
        commit_messages = [body]

    files_touched: list[str] = []
    seen: set[str] = set()
    for f in files:
        p = str(f.get("path", "") or "")
        if p and p not in seen:
            seen.add(p)
            files_touched.append(p)

    merge_commit = pr.get("mergeCommit") or {}
    merge_sha = merge_commit.get("oid") if isinstance(merge_commit, dict) else None

    author = pr.get("author") or {}
    author_login = str(author.get("login", "") or "") if isinstance(author, dict) else ""

    title = str(pr.get("title", "") or "")
    additions = int(pr.get("additions", 0) or 0)
    deletions = int(pr.get("deletions", 0) or 0)

    task_family = _infer_task_family(
        title=title,
        files=files,
        additions=additions,
        deletions=deletions,
        added_paths=added_paths,
    )

    return {
        "pr_number": int(pr.get("number", 0) or 0),
        "title": title,
        "body": body,
        "state": _norm_state(pr.get("state")),
        "author_login": author_login,
        "branch": str(pr.get("headRefName", "") or ""),
        "base_branch": str(pr.get("baseRefName", "") or ""),
        "created_at": str(pr.get("createdAt", "") or ""),
        "merged_at": pr.get("mergedAt") or None,
        "merge_sha": merge_sha,
        "commit_count": commit_count if commit_count else len(commit_messages),
        "files_touched": files_touched,
        "additions": additions,
        "deletions": deletions,
        "commit_messages": commit_messages,
        "ci_outcome": ci_outcome,
        "task_family": task_family,
    }


# --- census ---------------------------------------------------------------


def _size_bucket(total_lines: int) -> str:
    """Coarse size buckets for the census — additions+deletions."""
    if total_lines < 50:
        return "xs (<50)"
    if total_lines < 200:
        return "s (50-199)"
    if total_lines < 1000:
        return "m (200-999)"
    if total_lines < 5000:
        return "l (1000-4999)"
    return "xl (5000+)"


_SIZE_ORDER = ["xs (<50)", "s (50-199)", "m (200-999)", "l (1000-4999)", "xl (5000+)"]


def write_census(rows: list[dict[str, Any]], out_path: Path) -> None:
    """Render the human-readable census summary at `out_path`."""
    total = len(rows)

    merged_dates = sorted(r["merged_at"] for r in rows if r.get("merged_at"))
    date_range = (
        f"{merged_dates[0]} → {merged_dates[-1]}" if merged_dates else "no merged PRs"
    )

    family_counts = Counter(r.get("task_family") or "unknown" for r in rows)
    author_counts = Counter(r.get("author_login") or "unknown" for r in rows)
    size_counts = Counter(
        _size_bucket(int(r.get("additions", 0)) + int(r.get("deletions", 0)))
        for r in rows
    )
    ci_counts = Counter(r.get("ci_outcome") or "unknown" for r in rows)

    lines: list[str] = []
    lines.append("# PR archive census")
    lines.append("")
    lines.append(f"- Total merged PRs: **{total}**")
    lines.append(f"- Merge date range: **{date_range}**")
    lines.append("")

    lines.append("## By task family")
    lines.append("")
    lines.append("| family | count |")
    lines.append("| --- | ---: |")
    for family, count in sorted(family_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"| {family} | {count} |")
    lines.append("")

    lines.append("## By author")
    lines.append("")
    lines.append("| author | count |")
    lines.append("| --- | ---: |")
    for author, count in sorted(author_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"| {author} | {count} |")
    lines.append("")

    lines.append("## By PR size (additions + deletions)")
    lines.append("")
    lines.append("| bucket | count |")
    lines.append("| --- | ---: |")
    for bucket in _SIZE_ORDER:
        count = size_counts.get(bucket, 0)
        lines.append(f"| {bucket} | {count} |")
    lines.append("")

    lines.append("## By CI outcome")
    lines.append("")
    lines.append("| outcome | count |")
    lines.append("| --- | ---: |")
    for outcome, count in sorted(ci_counts.items(), key=lambda kv: (-kv[1], kv[0])):
        lines.append(f"| {outcome} | {count} |")
    lines.append("")

    # --- patch archive section ---------------------------------------------
    # Only render when at least one row carries the patch_bytes field, i.e.
    # the extractor was run with --include-patches. Otherwise this section
    # would be empty noise.
    patch_sizes = [
        int(r["patch_bytes"]) for r in rows
        if isinstance(r.get("patch_bytes"), int) and r["patch_bytes"] > 0
    ]
    if patch_sizes:
        total_bytes = sum(patch_sizes)
        sorted_sizes = sorted(patch_sizes)
        n = len(sorted_sizes)

        def _pct(p: float) -> int:
            # Nearest-rank percentile (safe on tiny samples).
            k = max(0, min(n - 1, int(round(p * (n - 1)))))
            return sorted_sizes[k]

        median = _pct(0.5)
        p95 = _pct(0.95)
        max_bytes = sorted_sizes[-1]

        big_hunk_rows = [
            r for r in rows
            if isinstance(r.get("patch_hunks"), int) and r["patch_hunks"] > 50
        ]
        empty_patches = [
            r for r in rows
            if isinstance(r.get("patch_bytes"), int) and r["patch_bytes"] == 0
        ]
        big_patch_rows = [
            r for r in rows
            if isinstance(r.get("patch_bytes"), int)
            and r["patch_bytes"] > BIG_PATCH_THRESHOLD
        ]

        def _fmt_bytes(b: int) -> str:
            if b >= 1024 * 1024:
                return f"{b / (1024 * 1024):.2f} MB"
            if b >= 1024:
                return f"{b / 1024:.1f} KB"
            return f"{b} B"

        lines.append("## Patch archive")
        lines.append("")
        lines.append("Per-PR patch content extracted with `--include-patches`.")
        lines.append(
            "Patches live at `data/object-compiler/pr-diffs/<pr_number>.patch` "
            "(gitignored — corpus artifact, not repo asset)."
        )
        lines.append("")
        lines.append("| stat | value |")
        lines.append("| --- | ---: |")
        lines.append(f"| PRs with a patch | {n} |")
        lines.append(f"| PRs with no patch available | {len(empty_patches)} |")
        lines.append(f"| Total patch bytes | {total_bytes} ({_fmt_bytes(total_bytes)}) |")
        lines.append(f"| Median patch size | {median} ({_fmt_bytes(median)}) |")
        lines.append(f"| P95 patch size | {p95} ({_fmt_bytes(p95)}) |")
        lines.append(f"| Max patch size | {max_bytes} ({_fmt_bytes(max_bytes)}) |")
        lines.append(
            f"| PRs with > 50 hunks (big-refactor tail) | {len(big_hunk_rows)} |"
        )
        lines.append(
            f"| PRs above 512 KB threshold | {len(big_patch_rows)} |"
        )
        lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")


# --- driver ---------------------------------------------------------------


def _log(msg: str, *, quiet: bool) -> None:
    if not quiet:
        print(msg, file=sys.stderr, flush=True)


def _resolve_out(repo: Path, out_arg: str) -> Path:
    p = Path(out_arg)
    if not p.is_absolute():
        p = repo / p
    return p


def _iter_ci_outcomes(
    repo: Path,
    prs: Iterable[dict[str, Any]],
    *,
    quiet: bool,
) -> dict[int, str]:
    """Poll `gh pr checks` per PR, with exponential backoff on rate limits.

    Returns a `{pr_number: ci_outcome}` map. On persistent rate limits the
    remaining PRs are assigned "unknown" and the walk exits cleanly.
    """
    results: dict[int, str] = {}
    backoff = 2.0
    max_backoff = 90.0
    consecutive_failures = 0
    total_giveup = 3  # after 3 backoffs in a row, mark the rest unknown

    prs_list = list(prs)
    n = len(prs_list)
    for i, pr in enumerate(prs_list, start=1):
        num = int(pr.get("number", 0) or 0)
        if not num:
            continue
        try:
            outcome = fetch_ci_outcome(repo, num)
            results[num] = outcome
            consecutive_failures = 0
            if i % 25 == 0:
                _log(f"  checks: {i}/{n} PRs polled", quiet=quiet)
        except _RateLimit as exc:
            consecutive_failures += 1
            _log(
                f"  rate limit at PR #{num}: {exc} — sleeping {backoff:.0f}s",
                quiet=quiet,
            )
            time.sleep(backoff)
            backoff = min(max_backoff, backoff * 2)
            if consecutive_failures >= total_giveup:
                _log(
                    f"  giving up on CI checks after {consecutive_failures} "
                    f"consecutive rate limits — remaining PRs marked unknown",
                    quiet=quiet,
                )
                # Fill the rest as unknown and bail out of the loop.
                for later_pr in prs_list[i - 1:]:
                    later_num = int(later_pr.get("number", 0) or 0)
                    if later_num and later_num not in results:
                        results[later_num] = "unknown"
                return results
            # Retry the current PR on next loop iteration by adjusting index?
            # We simply skip it — an "unknown" is fine.
            results[num] = "unknown"
        except subprocess.TimeoutExpired:
            results[num] = "unknown"

    return results


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract merged PRs from a git repository (via `gh`) into a JSONL "
            "corpus for the Object Compiler's paired-data pipeline."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--repo",
        default=os.getcwd(),
        help="path to the local git checkout (used to resolve owner/repo)",
    )
    parser.add_argument(
        "--out",
        default=DEFAULT_OUT,
        help="output JSONL path (repo-relative or absolute)",
    )
    parser.add_argument(
        "--census",
        default=DEFAULT_CENSUS,
        help="output census markdown path (repo-relative or absolute)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="maximum PRs to fetch (phase-1 target: 500)",
    )
    parser.add_argument(
        "--since",
        default=None,
        help="ISO-8601 lower bound on mergedAt (e.g., 2026-07-01T00:00:00Z)",
    )
    parser.add_argument(
        "--state",
        default="merged",
        choices=["merged", "closed", "open", "all"],
        help="PR state filter passed to `gh pr list`",
    )
    parser.add_argument(
        "--skip-ci",
        action="store_true",
        help="skip the per-PR `gh pr checks` call (mark every ci_outcome unknown)",
    )
    parser.add_argument(
        "--include-patches",
        action="store_true",
        help=(
            "extract each PR's patch (git show / gh pr diff fallback) to "
            "--pr-diffs-dir and add patch_path/patch_bytes/patch_hunks "
            "fields to every row. I/O-heavier; opt-in."
        ),
    )
    parser.add_argument(
        "--pr-diffs-dir",
        default=DEFAULT_PATCHES_DIR,
        help=(
            "directory to write per-PR .patch files into "
            "(repo-relative or absolute; only used with --include-patches)"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="fetch and classify but do not write output files",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="suppress progress output on stderr",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo = Path(args.repo).resolve()
    if not (repo / ".git").exists():
        print(f"error: {repo} is not a git checkout (no .git dir)", file=sys.stderr)
        return 2

    out_path = _resolve_out(repo, args.out)
    census_path = _resolve_out(repo, args.census)

    _log(f"repo: {repo}", quiet=args.quiet)
    _log(f"output: {out_path}", quiet=args.quiet)
    _log(f"census: {census_path}", quiet=args.quiet)
    _log(f"fetching up to {args.limit} PRs (state={args.state})...", quiet=args.quiet)

    t0 = time.time()
    prs = fetch_prs(
        repo=repo,
        limit=args.limit,
        since=args.since,
        state=args.state,
    )
    _log(f"  got {len(prs)} PRs in {time.time() - t0:.1f}s", quiet=args.quiet)

    # Walk local git history for each PR's commit messages up front.
    _log(f"  reading git log for {len(prs)} merge commits...", quiet=args.quiet)
    commits_by_pr: dict[int, tuple[list[str], int]] = {}
    added_by_pr: dict[int, set[str]] = {}
    for pr in prs:
        num = int(pr.get("number", 0) or 0)
        merge = (pr.get("mergeCommit") or {}).get("oid")
        msgs = git_log_commits(repo, merge)
        count = git_commit_count(repo, merge)
        commits_by_pr[num] = (msgs, count)
        added_by_pr[num] = git_added_paths(repo, merge)

    # Filter out branch-merge-only PRs before spending API budget on their checks.
    kept: list[dict[str, Any]] = []
    dropped_branch_merge = 0
    for pr in prs:
        num = int(pr.get("number", 0) or 0)
        msgs, _ = commits_by_pr.get(num, ([], 0))
        if _is_branch_merge_only(pr, msgs):
            dropped_branch_merge += 1
            continue
        kept.append(pr)
    if dropped_branch_merge:
        _log(
            f"  dropped {dropped_branch_merge} branch-merge-only PRs",
            quiet=args.quiet,
        )

    if args.skip_ci:
        # Preserve prior CI outcomes from the existing prs.jsonl (if any)
        # rather than downgrading every row to "unknown". Any PR not in the
        # prior file is left as "unknown" — which is what --skip-ci would
        # have produced anyway.
        prior_ci = _load_previous_ci_outcomes(out_path)
        ci_map = {
            int(p["number"]): prior_ci.get(int(p["number"]), "unknown")
            for p in kept
        }
        preserved = sum(1 for v in ci_map.values() if v != "unknown")
        _log(
            f"  --skip-ci: preserved {preserved}/{len(kept)} prior CI outcomes; "
            f"remainder marked unknown",
            quiet=args.quiet,
        )
    else:
        _log(f"  polling CI outcomes for {len(kept)} PRs...", quiet=args.quiet)
        ci_map = _iter_ci_outcomes(repo, kept, quiet=args.quiet)

    # Preserve downstream-owned fields (LLM classifier, etc.) from any
    # existing prs.jsonl. build_row only emits the extractor's own schema;
    # without this the next stage's verdicts would be silently wiped on
    # every extractor rerun.
    prior_downstream = _load_previous_downstream_fields(out_path)

    rows: list[dict[str, Any]] = []
    for pr in kept:
        num = int(pr.get("number", 0) or 0)
        msgs, count = commits_by_pr.get(num, ([], 0))
        row = build_row(
            pr,
            commit_messages=msgs,
            commit_count=count,
            ci_outcome=ci_map.get(num, "unknown"),
            added_paths=added_by_pr.get(num, set()),
        )
        preserved = prior_downstream.get(num)
        if preserved:
            for k, v in preserved.items():
                row[k] = v
        rows.append(row)

    if prior_downstream:
        _log(
            f"  preserved downstream fields on {len(prior_downstream)} rows "
            f"(e.g., task_family_llm)",
            quiet=args.quiet,
        )

    # Optional: extract per-PR patches to disk and stamp the three new fields
    # onto each row. Opt-in via --include-patches because it is I/O-heavier
    # (a `git show` per PR, ~a few seconds of wall time for a 261-PR archive).
    if args.include_patches:
        patches_dir = _resolve_out(repo, args.pr_diffs_dir)
        patches_dir.mkdir(parents=True, exist_ok=True)
        prev_stats = _load_previous_patch_stats(out_path)
        _log(
            f"  extracting patches for {len(rows)} PRs -> {patches_dir}",
            quiet=args.quiet,
        )

        n_ok = 0
        n_reused = 0
        n_regen = 0
        n_missing = 0
        n_big = 0
        for i, row in enumerate(rows, start=1):
            num = int(row["pr_number"])
            patch_rel = f"{args.pr_diffs_dir.rstrip('/')}/{num}.patch"
            patch_abs = _resolve_out(repo, patch_rel)
            prev = prev_stats.get(num)
            prev_bytes = prev[0] if prev else None

            result = extract_patch(
                repo=repo,
                pr_number=num,
                merge_sha=row.get("merge_sha"),
                patch_path=patch_abs,
                existing_bytes=prev_bytes,
                quiet=args.quiet,
            )

            if result is None:
                n_missing += 1
                # No patch anywhere — leave the three fields empty/zero so
                # downstream consumers can filter them out.
                row["patch_path"] = patch_rel
                row["patch_bytes"] = 0
                row["patch_hunks"] = 0
                continue

            n_bytes, hunks, was_regen = result
            n_ok += 1
            if was_regen:
                n_regen += 1
            else:
                n_reused += 1
            if n_bytes > BIG_PATCH_THRESHOLD:
                n_big += 1
            row["patch_path"] = patch_rel
            row["patch_bytes"] = n_bytes
            row["patch_hunks"] = hunks

            if i % 50 == 0:
                _log(
                    f"    patches: {i}/{len(rows)} processed "
                    f"({n_reused} reused, {n_regen} regenerated)",
                    quiet=args.quiet,
                )

        _log(
            f"  patches: {n_ok} ok ({n_reused} reused, {n_regen} regenerated); "
            f"{n_missing} unavailable; {n_big} > {BIG_PATCH_THRESHOLD // 1024} KB",
            quiet=args.quiet,
        )

    if args.dry_run:
        _log(
            f"  --dry-run: would write {len(rows)} rows to {out_path}",
            quiet=args.quiet,
        )
        if rows:
            _log("  sample row:", quiet=args.quiet)
            _log(json.dumps(rows[0], indent=2)[:1200], quiet=args.quiet)
        return 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False))
            fh.write("\n")
    _log(f"  wrote {len(rows)} rows to {out_path}", quiet=args.quiet)

    census_path.parent.mkdir(parents=True, exist_ok=True)
    write_census(rows, census_path)
    _log(f"  wrote census to {census_path}", quiet=args.quiet)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
