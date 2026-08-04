#!/usr/bin/env python3
"""
extract-corpus.py — walk the Claude Code project transcripts for objetdart_proj
and emit one line per session as `sessions.jsonl`.

Companion to:
    docs/plans/object-compiler.md   (M1 — The Corpus)

The compiler's paired data `(s_i, x_i)` is:
    s_i  = Claude Code session transcript (the intent expressed by prose,
           tool calls, and edits during the session)
    x_i  = the room / refactor that landed as a merged PR

This script produces the s-side only. Matching to PRs (the x-side) happens in
`scripts/object-compiler/match-to-prs.py` (M1, unimplemented).

Corpus layout (as of 2026-08-04):
    ~/.claude/projects/-Users-jawaun-objetdart-proj/
        <session-uuid>.jsonl            top-level session (9 files, ~50 MB total)
        <session-uuid>/                 subagent transcripts spawned in that session
            <subagent-uuid>.jsonl       (51 files, ~80 MB total)
        memory/
            *.md                        auto-memory notes (skipped)

JSONL schema (per line, as observed):
    {
      "type": "user" | "assistant" | "system" | ...,
      "parentUuid": str | null,
      "uuid": str,
      "sessionId": str,
      "cwd": str,                       reliable — filter to objetdart_proj here
      "gitBranch": str,                 reliable — carries branch identity
      "timestamp": str (ISO 8601),
      "message": {
        "role": ...,
        "content": [ {"type": "text", "text": ...}
                   | {"type": "tool_use", "name": ..., "input": ...}
                   | ... ],
        "stop_reason": str | null,
      },
      "toolUseResult": { ... }          on user-typed tool result envelopes
    }

Emitted line schema (`data/object-compiler/sessions.jsonl`):
    {
      "session_id":       str,
      "first_user_message": str,        first free-text user turn, truncated to 2000 chars
      "cwd":              str,
      "git_branch":       str | null,
      "files_touched":    [str],        distinct file paths seen in tool_use inputs
      "tool_call_count":  int,
      "timestamp_first":  str (ISO),
      "timestamp_last":   str (ISO),
      "subagent_count":   int,          number of nested subagent sessions folded in
      "line_count":       int,          total JSONL lines across session + subagents
      "source_path":      str,          absolute path to the top-level jsonl
    }

Deliberately minimal:
    - stdlib only (no jq, no yaml, no numpy)
    - no LLM calls
    - no PR matching (that's the next script)
    - streams line-by-line — the biggest session is ~18 MB

A future agent extending this should look at:
    - `_iter_session_lines` if the JSONL schema drifts
    - `_extract_file_from_tool_use` — the set of tool names that touch files;
      keep it in sync with what the shared runtime exposes (Read, Write, Edit,
      NotebookEdit, Bash-that-writes)
    - the `session_root_uuid → subagent_paths` walk if subagent transcripts
      start living somewhere other than a sibling directory
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

# ---------------------------------------------------------------------------
# defaults — tuned to this machine; every path is overrideable by a flag.
# ---------------------------------------------------------------------------

DEFAULT_PROJECTS_ROOT = Path(
    "~/.claude/projects/-Users-jawaun-objetdart-proj"
).expanduser()

DEFAULT_OUT_PATH = Path(
    "~/objetdart_proj/data/object-compiler/sessions.jsonl"
).expanduser()

# Tool names whose `input.file_path` (or similar) records a real file edit /
# read. Extend as the runtime grows; a name missing here is silently ignored
# in the `files_touched` roll-up.
FILE_TOUCHING_TOOLS = {
    "Read": ("file_path",),
    "Write": ("file_path",),
    "Edit": ("file_path",),
    "NotebookEdit": ("notebook_path",),
    "MultiEdit": ("file_path",),
}

# Truncate the first user message so `sessions.jsonl` stays skimmable and
# small. The full transcript is still available on disk.
FIRST_USER_MESSAGE_MAX = 2000


# ---------------------------------------------------------------------------
# data types
# ---------------------------------------------------------------------------


@dataclass
class SessionSummary:
    session_id: str
    kind: str = "parent"  # "parent" (top-level jsonl) or "subagent" (child agent-*.jsonl)
    parent_session_id: str | None = None  # set on subagent rows; None on parents
    first_user_message: str = ""
    cwd: str = ""
    git_branch: str | None = None
    files_touched: set[str] = field(default_factory=set)
    tool_call_count: int = 0
    timestamp_first: str = ""
    timestamp_last: str = ""
    subagent_count: int = 0  # parent rows: count of children; subagent rows: 0
    line_count: int = 0
    source_path: str = ""

    def to_json_line(self) -> str:
        return json.dumps(
            {
                "session_id": self.session_id,
                "kind": self.kind,
                "parent_session_id": self.parent_session_id,
                "first_user_message": self.first_user_message,
                "cwd": self.cwd,
                "git_branch": self.git_branch,
                "files_touched": sorted(self.files_touched),
                "tool_call_count": self.tool_call_count,
                "timestamp_first": self.timestamp_first,
                "timestamp_last": self.timestamp_last,
                "subagent_count": self.subagent_count,
                "line_count": self.line_count,
                "source_path": self.source_path,
            },
            ensure_ascii=False,
        )


# ---------------------------------------------------------------------------
# jsonl walking
# ---------------------------------------------------------------------------


def _iter_session_lines(path: Path) -> Iterator[dict[str, Any]]:
    """Yield parsed JSON objects, skipping malformed lines with a warning."""
    with path.open("r", encoding="utf-8") as fh:
        for i, raw in enumerate(fh):
            raw = raw.strip()
            if not raw:
                continue
            try:
                yield json.loads(raw)
            except json.JSONDecodeError as exc:
                print(
                    f"[warn] {path.name}:{i} malformed line ({exc}); skipping",
                    file=sys.stderr,
                )


def _extract_file_from_tool_use(block: dict[str, Any]) -> str | None:
    """Given a tool_use content block, return the file path it touches, if any."""
    if block.get("type") != "tool_use":
        return None
    name = block.get("name")
    if not isinstance(name, str):
        return None
    keys = FILE_TOUCHING_TOOLS.get(name)
    if not keys:
        return None
    inp = block.get("input") or {}
    for k in keys:
        v = inp.get(k)
        if isinstance(v, str) and v:
            return v
    return None


def _first_user_text(entry: dict[str, Any]) -> str | None:
    """Return the free-text user turn, if this entry is one."""
    if entry.get("type") != "user":
        return None
    msg = entry.get("message") or {}
    content = msg.get("content")
    # sometimes content is a bare string, sometimes a list of blocks
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    return text
    return None


def _summarize_single_file(
    path: Path,
    session_id: str,
    kind: str,
    parent_session_id: str | None,
) -> SessionSummary:
    """Read ONE .jsonl transcript and return its summary. No cross-file rollup."""
    summary = SessionSummary(
        session_id=session_id,
        kind=kind,
        parent_session_id=parent_session_id,
        source_path=str(path),
    )
    first_user_captured = False

    for entry in _iter_session_lines(path):
        summary.line_count += 1

        ts = entry.get("timestamp")
        if isinstance(ts, str):
            if not summary.timestamp_first or ts < summary.timestamp_first:
                summary.timestamp_first = ts
            if ts > summary.timestamp_last:
                summary.timestamp_last = ts

        cwd = entry.get("cwd")
        if isinstance(cwd, str) and cwd:
            summary.cwd = cwd

        branch = entry.get("gitBranch")
        if isinstance(branch, str) and branch:
            summary.git_branch = branch

        if not first_user_captured:
            text = _first_user_text(entry)
            if text is not None:
                summary.first_user_message = text[:FIRST_USER_MESSAGE_MAX]
                first_user_captured = True

        msg = entry.get("message") or {}
        for block in msg.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                summary.tool_call_count += 1
                fp = _extract_file_from_tool_use(block)
                if fp:
                    summary.files_touched.add(fp)

    return summary


def summarize_session(path: Path, subagent_paths: list[Path]) -> list[SessionSummary]:
    """
    Produce one summary row for the parent transcript plus one per subagent.

    Subagents each get their own row (with parent_session_id link and
    kind="subagent") because each subagent is its own intent-arc — often the
    one that actually opened the PR the parent supervised. Rolling them into
    a single parent row hides the paired-data structure the compiler needs.
    """
    parent_id = path.stem
    parent = _summarize_single_file(
        path, session_id=parent_id, kind="parent", parent_session_id=None
    )
    parent.subagent_count = len(subagent_paths)

    subs: list[SessionSummary] = []
    for sp in subagent_paths:
        # subagent filenames look like `agent-<hex>.jsonl`; the stem is a good id.
        subs.append(
            _summarize_single_file(
                sp,
                session_id=sp.stem,
                kind="subagent",
                parent_session_id=parent_id,
            )
        )
    return [parent, *subs]


# ---------------------------------------------------------------------------
# directory walking
# ---------------------------------------------------------------------------


def find_sessions(root: Path) -> list[tuple[Path, list[Path]]]:
    """
    Return [(top_level_jsonl, [subagent_jsonl, ...]), ...] in timestamp order.

    A top-level session is `<uuid>.jsonl` directly under `root`. Its subagents
    live in the sibling directory `<uuid>/` (which may itself contain nested
    subdirectories of `.jsonl` files).
    """
    if not root.exists():
        raise FileNotFoundError(f"projects root does not exist: {root}")

    sessions: list[tuple[Path, list[Path]]] = []
    for entry in sorted(root.iterdir()):
        if entry.is_file() and entry.suffix == ".jsonl":
            sibling_dir = root / entry.stem
            subagents: list[Path] = []
            if sibling_dir.is_dir():
                subagents = sorted(sibling_dir.rglob("*.jsonl"))
            sessions.append((entry, subagents))
    return sessions


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    """
    Usage:
        extract-corpus.py [--root <projects-root>] [--out <sessions.jsonl>]

    Both flags are optional; the defaults match this machine's layout.
    """
    root = DEFAULT_PROJECTS_ROOT
    out = DEFAULT_OUT_PATH

    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--root" and i + 1 < len(argv):
            root = Path(argv[i + 1]).expanduser()
            i += 2
        elif a == "--out" and i + 1 < len(argv):
            out = Path(argv[i + 1]).expanduser()
            i += 2
        elif a in ("-h", "--help"):
            print(main.__doc__)
            return 0
        else:
            print(f"[error] unknown arg: {a}", file=sys.stderr)
            print(main.__doc__, file=sys.stderr)
            return 2

    print(f"[info] projects root: {root}")
    print(f"[info] output:        {out}")

    sessions = find_sessions(root)
    print(f"[info] found {len(sessions)} top-level session(s)")

    out.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    parents = 0
    subagents_written = 0
    with out.open("w", encoding="utf-8") as fh:
        for top, subagents in sessions:
            rows = summarize_session(top, subagents)
            for row in rows:
                fh.write(row.to_json_line())
                fh.write("\n")
                written += 1
                if row.kind == "parent":
                    parents += 1
                else:
                    subagents_written += 1
            head = rows[0]
            print(
                f"[ok] {head.session_id[:8]}… "
                f"parent lines={head.line_count} tools={head.tool_call_count} "
                f"files={len(head.files_touched)} "
                f"subagents={len(rows) - 1} "
                f"branch={head.git_branch or '-'}"
            )

    print(
        f"[done] wrote {written} rows "
        f"({parents} parents + {subagents_written} subagents) → {out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
