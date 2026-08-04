#!/usr/bin/env python3
"""
join-timeline.py — join session transcripts to merged PRs into paired samples.

Companion to:
    docs/plans/object-compiler.md   (M1 — The Corpus)
    scripts/object-compiler/extract-corpus.py   (produces sessions.jsonl)

The compiler's paired data `(s_i, x_i)` needs both halves joined:
    s_i  = one row of sessions.jsonl (a Claude/Codex/Cursor transcript)
    x_i  = one row of prs.jsonl      (a merged PR archive entry)

This script reads both, applies four join strategies, resolves double-counting
between subagents and their parents, and emits pairs.jsonl + pairs-census.md.

Join strategies, in decreasing confidence:
  1. branch          — session.git_branch == pr.branch  (exact)          → high
  2. salvage_prompt  — session.first_user_message matches
                       "Salvage and land the `/X` room" (or "Build and land")
                       and pr.branch == "claude/<X>-room"                → high
  3. files           — |session.files ∩ pr.files| ≥ 3                    → medium
  4. timestamp       — session.timestamp_last within 24h of pr.merged_at
                       AND same author (when authors are known)          → low

Multiple strategies may match the same (session, pr). The strongest wins;
weaker strategies are recorded in `note` when they also fire.

Anti-double-counting: if a subagent and its parent both match the same PR,
only the subagent-pair is emitted (finer-grained wins). The parent may still
match a different PR.

Emitted row shape (see pairs.jsonl below):
    {
      "pair_id": <session_id> + "→" + <pr_number>   (or "→unmatched"),
      "match_strategy": "branch"|"salvage_prompt"|"files"|"timestamp"|"unmatched",
      "match_confidence": "high"|"medium"|"low",
      "agent_source": "claude"|"codex"|"cursor" (default "claude"),
      "task_family": <from PR if matched, else "unknown">,
      "session": { id, first_user_message[:500], files_touched, tool_call_count,
                   timestamp_first, timestamp_last },
      "pr": <PR row or null>,
      "note": <human-readable comment or null>
    }

Ordered by session.timestamp_first ascending, pair_id as tiebreaker.

Malformed input rows are tagged `"malformed": true` and passed through
(they never crash the pipeline).

--------------------------------------------------------------------------
Hand-testable example data (pipe into --sessions/--prs at STDIN paths):

# sessions.jsonl (three rows):
# {"session_id":"parent-1","kind":"parent","first_user_message":"do everything","git_branch":"claude/foo-room","files_touched":["src/rooms/foo/room.config.ts","src/components/Foo.tsx","src/lib/foo.ts"],"tool_call_count":42,"timestamp_first":"2026-08-01T10:00:00Z","timestamp_last":"2026-08-01T12:00:00Z"}
# {"session_id":"agent-abc","kind":"subagent","parent_session_id":"parent-1","first_user_message":"Salvage and land the `/foo` room","git_branch":"claude/foo-room","files_touched":["src/rooms/foo/room.config.ts","src/components/Foo.tsx","src/lib/foo.ts","src/app/foo/page.tsx"],"tool_call_count":80,"timestamp_first":"2026-08-01T10:30:00Z","timestamp_last":"2026-08-01T11:45:00Z"}
# {"session_id":"orphan-1","kind":"parent","first_user_message":"unrelated","git_branch":"scratch","files_touched":["README.md"],"tool_call_count":3,"timestamp_first":"2026-07-20T08:00:00Z","timestamp_last":"2026-07-20T09:00:00Z"}
#
# prs.jsonl (two rows):
# {"pr_number":248,"branch":"claude/foo-room","merged_at":"2026-08-01T13:00:00Z","files_touched":["src/rooms/foo/room.config.ts","src/components/Foo.tsx","src/lib/foo.ts","src/app/foo/page.tsx","src/rooms/registry.ts"],"task_family":"new-room","author":"jawaun"}
# {"pr_number":100,"branch":"main","merged_at":"2026-07-10T00:00:00Z","files_touched":["docs/README.md"],"task_family":"docs","author":"jawaun"}
#
# Expected join outcome:
#   - pair(agent-abc → 248) via branch (high). Parent-1 is *also* a branch
#     match for 248 but the subagent wins; parent-1 becomes an unmatched
#     row IF it has no other PR match.
#   - PR #100 has zero session matches (in this fixture) → shows up in
#     the "PRs with no matching session" census section.
--------------------------------------------------------------------------
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

# ---------------------------------------------------------------------------
# defaults
# ---------------------------------------------------------------------------

DEFAULT_SESSIONS = Path("~/objetdart_proj/data/object-compiler/sessions.jsonl").expanduser()
DEFAULT_PRS = Path("~/objetdart_proj/data/object-compiler/prs.jsonl").expanduser()
DEFAULT_PAIRS_OUT = Path("~/objetdart_proj/data/object-compiler/pairs.jsonl").expanduser()
DEFAULT_CENSUS_OUT = Path("~/objetdart_proj/data/object-compiler/pairs-census.md").expanduser()

FIRST_USER_MESSAGE_TRUNC = 500
FILES_OVERLAP_THRESHOLD = 3
TIMESTAMP_WINDOW = timedelta(hours=24)

# Strategy → confidence
STRATEGY_CONFIDENCE = {
    "branch": "high",
    "salvage_prompt": "high",
    "files": "medium",
    "timestamp": "low",
    "unmatched": "low",
}

# Priority for picking the winning strategy when multiple fire.
STRATEGY_PRIORITY = {
    "branch": 4,
    "salvage_prompt": 3,
    "files": 2,
    "timestamp": 1,
    "unmatched": 0,
}

# Salvage-prompt patterns → room key. The plan doc (docs/plans/object-compiler.md,
# 2026-08-04 progress log) documents that room-authoring subagents get prompts
# shaped as "Salvage and land the `/X` room" or "Build and land the `/X` room".
# Case-insensitive. Backticks may or may not be present.
SALVAGE_PATTERNS = [
    re.compile(r"(?:salvage|build)\s+and\s+land\s+the\s+`?/?([a-z0-9_-]+)`?\s+room", re.IGNORECASE),
]

# Worktree prefix used by subagents: strip it so files_touched can be compared
# to repo-relative PR paths. The plan doc calls out this normalization.
WORKTREE_PREFIX = re.compile(r"^\.claude/worktrees/agent-[a-f0-9]+/")
# Also handle absolute worktree paths that occasionally appear in transcripts.
ABS_WORKTREE_PREFIX = re.compile(r"^.*/\.claude/worktrees/agent-[a-f0-9]+/")
# And absolute paths rooted at the repo checkout — strip to repo-relative.
ABS_REPO_PREFIX = re.compile(r"^.*/(?:objetdart_proj|objetdart-proj)/")


# ---------------------------------------------------------------------------
# io
# ---------------------------------------------------------------------------


def _iter_jsonl(path: Path, label: str) -> Iterator[dict[str, Any]]:
    """Yield parsed JSON dicts from a JSONL file; malformed rows get a
    `_malformed_raw` tag and pass through instead of crashing."""
    with path.open("r", encoding="utf-8") as fh:
        for i, raw in enumerate(fh):
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
                if not isinstance(obj, dict):
                    yield {"_malformed_raw": raw, "malformed": True, "_line": i, "_label": label}
                else:
                    yield obj
            except json.JSONDecodeError as exc:
                print(
                    f"[warn] {path.name}:{i} malformed line ({exc}); passing through as malformed row",
                    file=sys.stderr,
                )
                yield {"_malformed_raw": raw, "malformed": True, "_line": i, "_label": label, "_error": str(exc)}


# ---------------------------------------------------------------------------
# normalization
# ---------------------------------------------------------------------------


def _norm_path(p: str) -> str:
    """Strip worktree and absolute-repo prefixes so a file path can be compared
    to the repo-relative paths PRs record."""
    if not isinstance(p, str):
        return ""
    q = ABS_WORKTREE_PREFIX.sub("", p)
    q = WORKTREE_PREFIX.sub("", q)
    q = ABS_REPO_PREFIX.sub("", q)
    return q.lstrip("./")


def _norm_files(files: Any) -> set[str]:
    if not isinstance(files, list):
        return set()
    return {_norm_path(f) for f in files if isinstance(f, str) and f} - {""}


def _parse_ts(value: Any) -> datetime | None:
    """Best-effort ISO 8601 parse; returns None on anything unparseable."""
    if not isinstance(value, str) or not value:
        return None
    v = value.strip()
    # Python 3.10 fromisoformat is picky about trailing Z; swap for +00:00.
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(v)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _detect_agent_source(row: dict[str, Any]) -> str:
    """Sessions from Codex/Cursor may add an explicit `agent_source`; the
    existing Claude extractor does not, so anything without a tag defaults
    to 'claude'."""
    src = row.get("agent_source")
    if isinstance(src, str) and src:
        return src.lower()
    # Heuristic fallbacks — leave the door open for the sibling extractors.
    if row.get("source") == "codex" or "codex" in str(row.get("source_path", "")).lower():
        return "codex"
    if row.get("source") == "cursor" or "cursor" in str(row.get("source_path", "")).lower():
        return "cursor"
    return "claude"


def _salvage_room_key(msg: Any) -> str | None:
    if not isinstance(msg, str):
        return None
    for pat in SALVAGE_PATTERNS:
        m = pat.search(msg)
        if m:
            return m.group(1).lower()
    return None


# ---------------------------------------------------------------------------
# join logic
# ---------------------------------------------------------------------------


def _session_author(row: dict[str, Any]) -> str | None:
    """Sessions may carry `author` (added by sibling extractors) or a `cwd`
    that resolves to a user. Return None if we can't confidently name one."""
    a = row.get("author")
    if isinstance(a, str) and a:
        return a.lower()
    return None


def _pr_author(pr: dict[str, Any]) -> str | None:
    a = pr.get("author")
    if isinstance(a, str) and a:
        return a.lower()
    a = pr.get("user")
    if isinstance(a, str) and a:
        return a.lower()
    return None


def _match_strategies(session: dict[str, Any], pr: dict[str, Any]) -> list[str]:
    """Return every strategy that fires for this (session, pr) pair."""
    hits: list[str] = []

    # --- branch: strongest ---
    s_branch = session.get("git_branch")
    p_branch = pr.get("branch")
    if isinstance(s_branch, str) and isinstance(p_branch, str) and s_branch and p_branch:
        if s_branch == p_branch:
            hits.append("branch")

    # --- salvage_prompt: high-confidence Claude-specific pattern ---
    room_key = _salvage_room_key(session.get("first_user_message"))
    if room_key and isinstance(p_branch, str):
        expected = f"claude/{room_key}-room"
        # accept either the exact "claude/<X>-room" convention or trailing
        # variants like "claude/<X>-room-2" that Claude uses when landing
        # follow-ups to the same room.
        if p_branch == expected or p_branch.startswith(expected + "-"):
            hits.append("salvage_prompt")

    # --- files: medium ---
    s_files = _norm_files(session.get("files_touched"))
    p_files = _norm_files(pr.get("files_touched"))
    if s_files and p_files:
        overlap = s_files & p_files
        if len(overlap) >= FILES_OVERLAP_THRESHOLD:
            hits.append("files")

    # --- timestamp: low. Only fire when we can confidently say same author. ---
    s_last = _parse_ts(session.get("timestamp_last"))
    p_merged = _parse_ts(pr.get("merged_at"))
    if s_last and p_merged:
        if abs(s_last - p_merged) <= TIMESTAMP_WINDOW:
            sa = _session_author(session)
            pa = _pr_author(pr)
            # Require author agreement OR unknown-on-both (loose but honest);
            # the spec says "same author (for Claude/Cursor cases where the
            # branch was different)". If neither side records an author, we
            # can't verify agreement — that's an inherent weakness of the
            # timestamp lane, which is exactly why it's the lowest-confidence.
            if (sa and pa and sa == pa) or (sa is None and pa is None):
                hits.append("timestamp")

    return hits


def _pick_winner(hits: list[str]) -> str:
    return max(hits, key=lambda s: STRATEGY_PRIORITY.get(s, -1))


def _pr_key(pr: dict[str, Any]) -> str:
    """Stable string key for a PR (pr_number → str); handles missing gracefully."""
    n = pr.get("pr_number")
    if n is None:
        n = pr.get("number")
    if n is None:
        return f"pr-unknown-{id(pr)}"
    return str(n)


def _session_key(session: dict[str, Any]) -> str:
    sid = session.get("session_id") or session.get("id") or f"session-unknown-{id(session)}"
    return str(sid)


# ---------------------------------------------------------------------------
# emission
# ---------------------------------------------------------------------------


def _session_payload(session: dict[str, Any]) -> dict[str, Any]:
    msg = session.get("first_user_message") or ""
    if isinstance(msg, str) and len(msg) > FIRST_USER_MESSAGE_TRUNC:
        msg = msg[:FIRST_USER_MESSAGE_TRUNC]
    files = session.get("files_touched")
    if not isinstance(files, list):
        files = []
    return {
        "id": _session_key(session),
        "first_user_message": msg,
        "files_touched": files,
        "tool_call_count": int(session.get("tool_call_count") or 0),
        "timestamp_first": session.get("timestamp_first") or "",
        "timestamp_last": session.get("timestamp_last") or "",
    }


def _make_pair_row(
    session: dict[str, Any],
    pr: dict[str, Any] | None,
    winning_strategy: str,
    all_hits: list[str],
) -> dict[str, Any]:
    sid = _session_key(session)
    if pr is not None:
        pair_id = f"{sid}→{_pr_key(pr)}"
    else:
        pair_id = f"{sid}→unmatched"

    note: str | None = None
    if len(all_hits) > 1:
        others = [h for h in all_hits if h != winning_strategy]
        note = "also matched by: " + ", ".join(sorted(others))
    elif winning_strategy == "unmatched":
        note = None

    row: dict[str, Any] = {
        "pair_id": pair_id,
        "match_strategy": winning_strategy,
        "match_confidence": STRATEGY_CONFIDENCE.get(winning_strategy, "low"),
        "agent_source": _detect_agent_source(session),
        "task_family": (pr.get("task_family") if pr else None) or "unknown",
        "session": _session_payload(session),
        "pr": pr,
        "note": note,
    }
    if session.get("malformed"):
        row["malformed"] = True
    return row


# ---------------------------------------------------------------------------
# main join
# ---------------------------------------------------------------------------


def join(
    sessions: list[dict[str, Any]],
    prs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Returns (pair_rows, census_data). Pair rows are already sorted.

    Algorithm:
      1. For every (session, pr) build the set of matching strategies.
      2. For each PR, if any subagent session matches, drop parent-session
         matches for that PR (anti-double-counting). Parent may still match
         other PRs.
      3. Emit one pair row per surviving (session, pr) match. Sessions with
         zero surviving matches get an "unmatched" row.
    """
    # Index sessions for quick lookup.
    valid_sessions = [s for s in sessions if not s.get("malformed")]
    malformed_sessions = [s for s in sessions if s.get("malformed")]
    valid_prs = [p for p in prs if not p.get("malformed")]
    malformed_prs = [p for p in prs if p.get("malformed")]

    # Step 1: compute all candidate (session, pr) matches.
    # candidates_by_pr[pr_key] = list of (session_idx, strategy_hits)
    candidates_by_pr: dict[str, list[tuple[int, list[str]]]] = defaultdict(list)
    # candidates_by_session[session_idx] = list of (pr_key, strategy_hits)
    candidates_by_session: dict[int, list[tuple[str, list[str]]]] = defaultdict(list)

    for si, session in enumerate(valid_sessions):
        for pr in valid_prs:
            hits = _match_strategies(session, pr)
            if not hits:
                continue
            pk = _pr_key(pr)
            candidates_by_pr[pk].append((si, hits))
            candidates_by_session[si].append((pk, hits))

    # Step 2: anti-double-counting. For each PR, if any subagent matches,
    # drop the parent matches for that PR.
    dropped_parent_matches: dict[int, set[str]] = defaultdict(set)  # session_idx → {pr_keys}
    for pk, entries in candidates_by_pr.items():
        subagent_entries = [
            (si, hits) for si, hits in entries
            if valid_sessions[si].get("kind") == "subagent"
        ]
        if not subagent_entries:
            continue
        parent_entries = [
            (si, hits) for si, hits in entries
            if valid_sessions[si].get("kind") != "subagent"
        ]
        for si, _ in parent_entries:
            dropped_parent_matches[si].add(pk)

    # Step 3: emit pair rows.
    pr_by_key = {_pr_key(p): p for p in valid_prs}
    prs_matched: set[str] = set()
    pair_rows: list[dict[str, Any]] = []

    for si, session in enumerate(valid_sessions):
        matches = candidates_by_session.get(si, [])
        # Filter out dropped parent matches.
        surviving = [
            (pk, hits) for pk, hits in matches
            if pk not in dropped_parent_matches.get(si, set())
        ]
        if not surviving:
            pair_rows.append(_make_pair_row(session, None, "unmatched", []))
            continue
        for pk, hits in surviving:
            winner = _pick_winner(hits)
            pr = pr_by_key.get(pk)
            pair_rows.append(_make_pair_row(session, pr, winner, hits))
            prs_matched.add(pk)

    # Malformed sessions pass through as their own "unmatched, malformed" rows.
    for m in malformed_sessions:
        pair_rows.append(
            {
                "pair_id": f"malformed-session-{m.get('_line', '?')}→unmatched",
                "match_strategy": "unmatched",
                "match_confidence": "low",
                "agent_source": "unknown",
                "task_family": "unknown",
                "session": {
                    "id": f"malformed-line-{m.get('_line', '?')}",
                    "first_user_message": "",
                    "files_touched": [],
                    "tool_call_count": 0,
                    "timestamp_first": "",
                    "timestamp_last": "",
                },
                "pr": None,
                "note": f"malformed input row: {m.get('_error', 'unknown parse error')}",
                "malformed": True,
            }
        )

    # Sort: chronologically by session.timestamp_first, then by pair_id.
    def _sort_key(row: dict[str, Any]) -> tuple[str, str]:
        ts = row.get("session", {}).get("timestamp_first") or ""
        pid = row.get("pair_id") or ""
        return (ts, pid)

    pair_rows.sort(key=_sort_key)

    # Census.
    matched_sessions: set[int] = set()
    unmatched_sessions: set[int] = set()
    for si, session in enumerate(valid_sessions):
        surviving = [
            (pk, hits) for pk, hits in candidates_by_session.get(si, [])
            if pk not in dropped_parent_matches.get(si, set())
        ]
        if surviving:
            matched_sessions.add(si)
        else:
            unmatched_sessions.add(si)

    prs_without_session = [pk for pk in pr_by_key.keys() if pk not in prs_matched]

    census = {
        "total_pair_rows": len(pair_rows),
        "by_strategy": Counter(r["match_strategy"] for r in pair_rows),
        "by_task_family": Counter(r["task_family"] for r in pair_rows),
        "by_agent_source": Counter(r["agent_source"] for r in pair_rows),
        "matched_sessions": len(matched_sessions),
        "unmatched_sessions": len(unmatched_sessions),
        "total_sessions": len(valid_sessions),
        "total_prs": len(valid_prs),
        "prs_without_session": prs_without_session,
        "malformed_session_rows": len(malformed_sessions),
        "malformed_pr_rows": len(malformed_prs),
    }
    return pair_rows, census


# ---------------------------------------------------------------------------
# census renderer
# ---------------------------------------------------------------------------


def render_census(census: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# pairs-census — Object Compiler M1 timeline-join")
    lines.append("")
    lines.append(
        "Auto-generated by `scripts/object-compiler/join-timeline.py`. "
        "Do not hand-edit; rerun the script."
    )
    lines.append("")
    lines.append("## Totals")
    lines.append("")
    lines.append(f"- **Total pair rows**: {census['total_pair_rows']}")
    lines.append(f"- **Sessions total**: {census['total_sessions']}")
    lines.append(f"- **Sessions matched**: {census['matched_sessions']}")
    lines.append(f"- **Sessions unmatched**: {census['unmatched_sessions']}")
    lines.append(f"- **PRs total**: {census['total_prs']}")
    lines.append(f"- **PRs without a matching session**: {len(census['prs_without_session'])}")
    if census["malformed_session_rows"] or census["malformed_pr_rows"]:
        lines.append(
            f"- **Malformed rows tolerated**: "
            f"{census['malformed_session_rows']} session(s), "
            f"{census['malformed_pr_rows']} PR(s)"
        )
    lines.append("")

    def _render_counter(title: str, counter: Counter) -> None:
        lines.append(f"## {title}")
        lines.append("")
        if not counter:
            lines.append("(none)")
            lines.append("")
            return
        for k, v in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0])):
            lines.append(f"- `{k}`: {v}")
        lines.append("")

    _render_counter("Breakdown by match_strategy", census["by_strategy"])
    _render_counter("Breakdown by task_family", census["by_task_family"])
    _render_counter("Breakdown by agent_source", census["by_agent_source"])

    lines.append("## PRs with no matching session")
    lines.append("")
    if not census["prs_without_session"]:
        lines.append("(none — every PR paired to at least one session)")
    else:
        lines.append(
            "These merged PRs had no transcript that survived the four join "
            "strategies. They are cases where transcript coverage was lost "
            "(agent ran outside Claude/Codex/Cursor, or the transcript file was "
            "never captured). Worth spot-checking before M2."
        )
        lines.append("")
        for pk in sorted(census["prs_without_session"], key=lambda s: (len(s), s)):
            lines.append(f"- PR #{pk}")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="join-timeline.py",
        description=(
            "Join sessions.jsonl and prs.jsonl into paired samples "
            "(pairs.jsonl + pairs-census.md). See docs/plans/object-compiler.md "
            "M1 for the framing. Stdlib-only, deterministic, order-stable."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Strategies applied (all fire independently; strongest wins):\n"
            "  branch          session.git_branch == pr.branch      → high\n"
            "  salvage_prompt  'Salvage/Build and land the /X room' → high\n"
            "  files           |session.files ∩ pr.files| ≥ 3       → medium\n"
            "  timestamp       within 24h AND same author           → low\n"
            "\n"
            "Anti-double-counting: subagent wins over parent for the same PR;\n"
            "the parent may still match a *different* PR.\n"
        ),
    )
    p.add_argument(
        "--sessions",
        type=Path,
        default=DEFAULT_SESSIONS,
        help=f"path to sessions.jsonl (default: {DEFAULT_SESSIONS})",
    )
    p.add_argument(
        "--prs",
        type=Path,
        default=DEFAULT_PRS,
        help=f"path to prs.jsonl (default: {DEFAULT_PRS})",
    )
    p.add_argument(
        "--out-pairs",
        type=Path,
        default=DEFAULT_PAIRS_OUT,
        help=f"path to write pairs.jsonl (default: {DEFAULT_PAIRS_OUT})",
    )
    p.add_argument(
        "--out-census",
        type=Path,
        default=DEFAULT_CENSUS_OUT,
        help=f"path to write pairs-census.md (default: {DEFAULT_CENSUS_OUT})",
    )
    return p


def main(argv: list[str]) -> int:
    args = _build_parser().parse_args(argv)

    if not args.sessions.exists():
        print(
            f"[error] sessions.jsonl not found at {args.sessions}\n"
            f"        Run scripts/object-compiler/extract-corpus.py first, "
            f"or the sister agent producing that file.",
            file=sys.stderr,
        )
        return 2
    if not args.prs.exists():
        print(
            f"[error] prs.jsonl not found at {args.prs}\n"
            f"        The sister agent produces this file; wait for it or "
            f"point --prs at your own fixture.",
            file=sys.stderr,
        )
        return 2

    print(f"[info] sessions: {args.sessions}")
    print(f"[info] prs:      {args.prs}")

    sessions = list(_iter_jsonl(args.sessions, "sessions"))
    prs = list(_iter_jsonl(args.prs, "prs"))
    print(f"[info] read {len(sessions)} session row(s), {len(prs)} PR row(s)")

    pair_rows, census = join(sessions, prs)

    args.out_pairs.parent.mkdir(parents=True, exist_ok=True)
    with args.out_pairs.open("w", encoding="utf-8") as fh:
        for row in pair_rows:
            fh.write(json.dumps(row, ensure_ascii=False))
            fh.write("\n")

    args.out_census.parent.mkdir(parents=True, exist_ok=True)
    args.out_census.write_text(render_census(census), encoding="utf-8")

    top_strategy = max(census["by_strategy"].items(), key=lambda kv: kv[1])[0] if census["by_strategy"] else "n/a"
    print(f"[done] wrote {len(pair_rows)} pair row(s) → {args.out_pairs}")
    print(f"[done] wrote census → {args.out_census}")
    print(
        f"[meta] matched={census['matched_sessions']}/{census['total_sessions']} sessions; "
        f"PRs w/o session={len(census['prs_without_session'])}/{census['total_prs']}; "
        f"top strategy={top_strategy}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
