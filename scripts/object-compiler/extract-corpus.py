#!/usr/bin/env python3
"""
extract-corpus.py — walk LLM coding-agent session transcripts for objetdart_proj
and emit one line per session as `sessions.jsonl`, tagged by `agent_source`.

Companion to:
    docs/plans/object-compiler.md   (M1 — The Corpus)

The compiler's paired data `(s_i, x_i)` is:
    s_i  = LLM coding-agent session transcript (the intent expressed by prose,
           tool calls, and edits during the session)
    x_i  = the room / refactor that landed as a merged PR

This script produces the s-side across THREE agent sources:
    - "claude-local"  Claude Code (~/.claude/projects/...)
    - "codex"         Codex CLI  (~/.codex/archived_sessions/, ~/.codex/sessions/)
    - "cursor"        Cursor CLI (~/.cursor/projects/.../agent-transcripts/)

Every emitted row has the same shape regardless of source; source-specific
schema quirks are mapped inside each walker.

Emitted line schema (`data/object-compiler/sessions.jsonl`):
    {
      "session_id":          str,
      "kind":                "parent" | "subagent" | "session",
      "parent_session_id":   str | null,
      "agent_source":        "claude-local" | "codex" | "cursor",
      "first_user_message":  str,           truncated to 2000 chars
      "cwd":                 str,
      "git_branch":          str | null,
      "files_touched":       [str],
      "tool_call_count":     int,
      "timestamp_first":     str (ISO 8601),
      "timestamp_last":      str (ISO 8601),
      "subagent_count":      int,
      "line_count":          int,
      "source_path":         str,           absolute
    }

FILTERING
---------
The corpus is *only* the objetdart repo. A session is emitted iff any of:
  - its cwd contains "objetdart"
  - its git_branch, if present, references this repo's branch shape
  - any files_touched path contains "objetdart" or matches a repo-relative
    pattern (src/, docs/, scripts/, object-compiler/, etc.)

CLI
---
Usage:
    extract-corpus.py [--claude-root <path>]... [--codex-root <path>]...
                      [--cursor-root <path>]... [--out <path>] [--census <path>]

Both flags are optional; the defaults match this machine's layout.

Stdlib only. No LLM calls. Streams line-by-line.
"""

from __future__ import annotations

import datetime as dt
import json

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

# ---------------------------------------------------------------------------
# defaults — tuned to this machine.
# ---------------------------------------------------------------------------

REPO_MARKER = "objetdart"
FIRST_USER_MESSAGE_MAX = 2000

DEFAULT_CLAUDE_ROOTS = [
    Path("~/.claude/projects/-Users-jawaun-objetdart-proj").expanduser(),
]
DEFAULT_CODEX_ROOTS = [
    Path("~/.codex/archived_sessions").expanduser(),
    Path("~/.codex/sessions").expanduser(),
]
DEFAULT_CURSOR_ROOTS = [
    Path("~/.cursor/projects").expanduser(),
]

DEFAULT_OUT_PATH = Path(
    "~/objetdart_proj/data/object-compiler/sessions.jsonl"
).expanduser()
DEFAULT_CENSUS_PATH = Path(
    "~/objetdart_proj/data/object-compiler/sessions-census.md"
).expanduser()

# Tool names whose input recorded a real file edit / read. Used by the Claude
# walker (unchanged from the original) and, in a broader form, by the Cursor
# walker (Cursor tool names).
CLAUDE_FILE_TOUCHING_TOOLS = {
    "Read": ("file_path",),
    "Write": ("file_path",),
    "Edit": ("file_path",),
    "NotebookEdit": ("notebook_path",),
    "MultiEdit": ("file_path",),
}

CURSOR_FILE_TOUCHING_TOOLS = {
    "Read": ("path", "file_path"),
    "ReadFile": ("path",),
    "Write": ("path",),
    "Edit": ("path", "file_path"),
    "StrReplace": ("path",),
    "Delete": ("path",),
    "ApplyPatch": ("path",),
    "Glob": ("target_directory",),
    "Grep": ("path",),
    "view_image": ("path",),
    # Cursor's Shell/AwaitShell record working_directory — treat as a
    # directory-scope touch, useful for the objetdart filter.
    "Shell": ("working_directory",),
}

# Codex parses paths out of shell `cmd` strings — no structured file field.
CODEX_ABS_PATH_RE = re.compile(r"/Users/jawaun/[A-Za-z0-9_\-./]+")
CODEX_REL_PATH_RE = re.compile(
    r"(?<![A-Za-z0-9_/-])"
    r"(?:src|docs|scripts|public|test|tests|app|components|lib|object-compiler|data)"
    r"/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+"
)

# Room-authoring signal: how many files_touched mentions of
# `src/rooms/<key>/room.config.ts` a source produced.
ROOM_CONFIG_RE = re.compile(r"src/rooms/[^/]+/room\.config\.ts$")


# ---------------------------------------------------------------------------
# data types
# ---------------------------------------------------------------------------


@dataclass
class SessionSummary:
    session_id: str
    kind: str = "parent"
    parent_session_id: str | None = None
    agent_source: str = "claude-local"
    first_user_message: str = ""
    cwd: str = ""
    git_branch: str | None = None
    files_touched: set[str] = field(default_factory=set)
    tool_call_count: int = 0
    timestamp_first: str = ""
    timestamp_last: str = ""
    subagent_count: int = 0
    line_count: int = 0
    source_path: str = ""

    def to_json_line(self) -> str:
        return json.dumps(
            {
                "session_id": self.session_id,
                "kind": self.kind,
                "parent_session_id": self.parent_session_id,
                "agent_source": self.agent_source,
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

    def touches_repo(self) -> bool:
        """Repo-relevance filter used by all three walkers."""
        if REPO_MARKER in self.cwd.lower():
            return True
        if self.git_branch and REPO_MARKER in self.git_branch.lower():
            return True
        for fp in self.files_touched:
            if REPO_MARKER in fp.lower():
                return True
        # A repo-relative signal (src/rooms/... etc.) is only trustworthy when
        # the cwd is also inside objetdart; else the same relative path could
        # live in any project. So we do NOT admit a session on rel-path alone.
        return False


# ---------------------------------------------------------------------------
# shared jsonl helpers
# ---------------------------------------------------------------------------


def _iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
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


def _update_ts(summary: SessionSummary, ts: str | None) -> None:
    if not isinstance(ts, str) or not ts:
        return
    if not summary.timestamp_first or ts < summary.timestamp_first:
        summary.timestamp_first = ts
    if ts > summary.timestamp_last:
        summary.timestamp_last = ts


# ---------------------------------------------------------------------------
# Claude Code walker (unchanged behavior; agent_source="claude-local")
# ---------------------------------------------------------------------------


def _claude_first_user_text(entry: dict[str, Any]) -> str | None:
    if entry.get("type") != "user":
        return None
    msg = entry.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    return text
    return None


def _claude_file_from_tool_use(block: dict[str, Any]) -> str | None:
    if block.get("type") != "tool_use":
        return None
    name = block.get("name")
    if not isinstance(name, str):
        return None
    keys = CLAUDE_FILE_TOUCHING_TOOLS.get(name)
    if not keys:
        return None
    inp = block.get("input") or {}
    for k in keys:
        v = inp.get(k)
        if isinstance(v, str) and v:
            return v
    return None


def _summarize_claude_file(
    path: Path,
    session_id: str,
    kind: str,
    parent_session_id: str | None,
) -> SessionSummary:
    summary = SessionSummary(
        session_id=session_id,
        kind=kind,
        parent_session_id=parent_session_id,
        agent_source="claude-local",
        source_path=str(path),
    )
    first_user_captured = False

    for entry in _iter_jsonl(path):
        summary.line_count += 1
        _update_ts(summary, entry.get("timestamp"))

        cwd = entry.get("cwd")
        if isinstance(cwd, str) and cwd:
            summary.cwd = cwd

        branch = entry.get("gitBranch")
        if isinstance(branch, str) and branch:
            summary.git_branch = branch

        if not first_user_captured:
            text = _claude_first_user_text(entry)
            if text is not None:
                summary.first_user_message = text[:FIRST_USER_MESSAGE_MAX]
                first_user_captured = True

        msg = entry.get("message") or {}
        for block in msg.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                summary.tool_call_count += 1
                fp = _claude_file_from_tool_use(block)
                if fp:
                    summary.files_touched.add(fp)

    return summary


def walk_claude(root: Path) -> list[SessionSummary]:
    """One row per parent JSONL + one row per subagent JSONL, all under `root`."""
    if not root.exists():
        print(f"[warn] claude root missing: {root}", file=sys.stderr)
        return []

    rows: list[SessionSummary] = []
    for entry in sorted(root.iterdir()):
        if not (entry.is_file() and entry.suffix == ".jsonl"):
            continue
        parent_id = entry.stem
        sibling_dir = root / entry.stem
        subagents = (
            sorted(sibling_dir.rglob("*.jsonl")) if sibling_dir.is_dir() else []
        )
        parent = _summarize_claude_file(
            entry, session_id=parent_id, kind="parent", parent_session_id=None
        )
        parent.subagent_count = len(subagents)
        rows.append(parent)
        for sp in subagents:
            rows.append(
                _summarize_claude_file(
                    sp,
                    session_id=sp.stem,
                    kind="subagent",
                    parent_session_id=parent_id,
                )
            )
    return rows


# ---------------------------------------------------------------------------
# Codex walker (agent_source="codex")
# ---------------------------------------------------------------------------
# Schema (per JSONL line):
#     {"timestamp": "...", "type": "session_meta" | "response_item"
#                                    | "event_msg" | "turn_context",
#      "payload": { ... }}
#
# Key payload shapes:
#     session_meta.payload = {id, cwd, originator, cli_version, ...}
#     response_item.payload with type=="message":
#         {type:"message", role:"user"|"developer"|"assistant", content:[
#             {type:"input_text"|"output_text"|"text", text:"..."}, ...]}
#     response_item.payload with type=="function_call":
#         {type:"function_call", name:"exec_command"|"apply_patch"|...,
#          arguments:"<json-string>", call_id:"..."}
#     event_msg.payload with type=="user_message":
#         {type:"user_message", message:"...", images:[], text_elements:[...]}
#
# The user's actual prose lives in event_msg/user_message (message field);
# the response_item/message form is often the framework's rendered version
# with envelope tags. We prefer event_msg.


def _codex_first_user_text(entry: dict[str, Any]) -> str | None:
    t = entry.get("type")
    p = entry.get("payload") or {}
    if t == "event_msg" and p.get("type") == "user_message":
        m = p.get("message")
        if isinstance(m, str) and m.strip():
            return m
    return None


def _codex_extract_paths(cmd_text: str, sink: set[str]) -> None:
    """Extract file paths out of a shell command string."""
    if not isinstance(cmd_text, str) or not cmd_text:
        return
    for m in CODEX_ABS_PATH_RE.findall(cmd_text):
        sink.add(m)
    for m in CODEX_REL_PATH_RE.findall(cmd_text):
        sink.add(m)


def _summarize_codex_file(path: Path) -> SessionSummary | None:
    summary = SessionSummary(
        session_id=path.stem,
        kind="session",
        parent_session_id=None,
        agent_source="codex",
        source_path=str(path),
    )
    first_user_captured = False

    for entry in _iter_jsonl(path):
        summary.line_count += 1
        _update_ts(summary, entry.get("timestamp"))

        t = entry.get("type")
        p = entry.get("payload") or {}

        if t == "session_meta":
            sid = p.get("session_id") or p.get("id")
            if isinstance(sid, str) and sid:
                summary.session_id = sid
            cwd = p.get("cwd")
            if isinstance(cwd, str) and cwd:
                summary.cwd = cwd
            # No git branch in session_meta; leave null.
            continue

        if t == "event_msg":
            if not first_user_captured:
                text = _codex_first_user_text(entry)
                if text is not None:
                    summary.first_user_message = text[:FIRST_USER_MESSAGE_MAX]
                    first_user_captured = True
            continue

        if t != "response_item":
            continue

        pt = p.get("type")
        if pt == "function_call":
            summary.tool_call_count += 1
            args_raw = p.get("arguments") or ""
            if isinstance(args_raw, str):
                try:
                    args = json.loads(args_raw)
                except json.JSONDecodeError:
                    args = {}
            else:
                args = args_raw if isinstance(args_raw, dict) else {}
            if isinstance(args, dict):
                wd = args.get("workdir")
                if isinstance(wd, str) and wd:
                    summary.files_touched.add(wd)
                cmd_text = args.get("cmd")
                if isinstance(cmd_text, str):
                    _codex_extract_paths(cmd_text, summary.files_touched)
                # apply_patch-style: sometimes a "patch" or "path" key
                for k in ("path", "file_path", "filename"):
                    v = args.get(k)
                    if isinstance(v, str) and v:
                        summary.files_touched.add(v)
                patch = args.get("patch")
                if isinstance(patch, str):
                    _codex_extract_paths(patch, summary.files_touched)
        elif pt == "message":
            # If we still haven't captured a user message from event_msg,
            # try to reconstruct from response_item/message text.
            if not first_user_captured and p.get("role") == "user":
                content = p.get("content") or []
                for c in content:
                    if not isinstance(c, dict):
                        continue
                    text = c.get("text")
                    if not isinstance(text, str) or not text.strip():
                        continue
                    # Skip framework envelopes.
                    lower = text.lstrip().lower()
                    if lower.startswith(("<environment_context", "<permissions",
                                          "<apps_instructions", "<skills_instructions",
                                          "<plugins_instructions", "<app-context",
                                          "# agents.md")):
                        continue
                    summary.first_user_message = text[:FIRST_USER_MESSAGE_MAX]
                    first_user_captured = True
                    break

    return summary


def walk_codex(roots: list[Path]) -> list[SessionSummary]:
    """Codex JSONLs are flat under `archived_sessions/`, tree under `sessions/`."""
    rows: list[SessionSummary] = []
    for root in roots:
        if not root.exists():
            print(f"[warn] codex root missing: {root}", file=sys.stderr)
            continue
        for path in sorted(root.rglob("*.jsonl")):
            try:
                summary = _summarize_codex_file(path)
                if summary is not None:
                    rows.append(summary)
            except Exception as exc:  # noqa: BLE001
                print(
                    f"[warn] codex file failed {path.name}: {exc}",
                    file=sys.stderr,
                )
    return rows


# ---------------------------------------------------------------------------
# Cursor walker (agent_source="cursor")
# ---------------------------------------------------------------------------
# Layout:
#     ~/.cursor/projects/<encoded-cwd>/agent-transcripts/<agent-uuid>/
#         <agent-uuid>.jsonl           parent transcript
#         subagents/
#             <subagent-uuid>.jsonl    subagent transcripts (optional)
#
# The encoded-cwd shape mirrors Claude's convention: slashes become dashes.
# e.g., "Users-jawaun-objetdart-proj" == "/Users/jawaun/objetdart-proj".
#
# JSONL line schema:
#     {"role": "user"|"assistant"|"system"|"tool_result", "message": {
#          "content": [ {"type": "text", "text": "..."} | {"type": "tool_use",
#             "name": "...", "input": {...}} ]}}
#
# No per-line timestamp or cwd; timestamps sometimes appear inside the first
# user text via `<timestamp>...</timestamp>`.


CURSOR_INLINE_TS_RE = re.compile(
    r"<timestamp>\s*([^<]+?)\s*</timestamp>", re.IGNORECASE
)


def _decode_cursor_project_dir(name: str) -> str:
    """Best-effort decode of `Users-jawaun-...` back into an absolute cwd."""
    return "/" + name.replace("-", "/")


def _cursor_first_user_text(entry: dict[str, Any]) -> str | None:
    if entry.get("role") != "user":
        return None
    msg = entry.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    return text
    return None


def _cursor_paths_from_tool_use(block: dict[str, Any]) -> list[str]:
    if block.get("type") != "tool_use":
        return []
    name = block.get("name")
    if not isinstance(name, str):
        return []
    inp = block.get("input")
    if not isinstance(inp, dict):
        return []
    keys = CURSOR_FILE_TOUCHING_TOOLS.get(name)
    out: list[str] = []
    if keys:
        for k in keys:
            v = inp.get(k)
            if isinstance(v, str) and v:
                out.append(v)
    # Shell command bodies leak absolute paths; harvest them too.
    if name in ("Shell", "AwaitShell"):
        cmd = inp.get("command")
        if isinstance(cmd, str):
            for m in CODEX_ABS_PATH_RE.findall(cmd):
                out.append(m)
            for m in CODEX_REL_PATH_RE.findall(cmd):
                out.append(m)
    return out


def _summarize_cursor_file(
    path: Path,
    session_id: str,
    kind: str,
    parent_session_id: str | None,
    cwd_hint: str,
) -> SessionSummary:
    summary = SessionSummary(
        session_id=session_id,
        kind=kind,
        parent_session_id=parent_session_id,
        agent_source="cursor",
        cwd=cwd_hint,
        source_path=str(path),
    )
    first_user_captured = False

    for entry in _iter_jsonl(path):
        summary.line_count += 1

        if not first_user_captured:
            text = _cursor_first_user_text(entry)
            if text is not None:
                summary.first_user_message = text[:FIRST_USER_MESSAGE_MAX]
                first_user_captured = True
                # Cursor's inline `<timestamp>` tag is human-readable
                # ("Sunday, Aug 2, 2026, 10:23 PM (UTC-4)") — normalizing it
                # is fragile and comparing it as a string breaks ISO
                # ordering. File mtime below is authoritative.

        msg = entry.get("message") or {}
        for block in msg.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                summary.tool_call_count += 1
                for fp in _cursor_paths_from_tool_use(block):
                    summary.files_touched.add(fp)

    # Cursor's per-line data has no wall-clock; fall back to file mtime.
    if not summary.timestamp_first or not summary.timestamp_last:
        try:
            mtime = dt.datetime.fromtimestamp(
                path.stat().st_mtime, tz=dt.timezone.utc
            ).isoformat()
            if not summary.timestamp_first:
                summary.timestamp_first = mtime
            if not summary.timestamp_last:
                summary.timestamp_last = mtime
        except OSError:
            pass

    return summary


def walk_cursor(roots: list[Path]) -> list[SessionSummary]:
    rows: list[SessionSummary] = []
    for root in roots:
        if not root.exists():
            print(f"[warn] cursor root missing: {root}", file=sys.stderr)
            continue
        for project_dir in sorted(root.iterdir()):
            if not project_dir.is_dir():
                continue
            # Cheap objetdart pre-filter on directory name; a session outside
            # this repo will not have "objetdart" in its encoded path.
            if REPO_MARKER not in project_dir.name.lower():
                continue
            cwd_hint = _decode_cursor_project_dir(project_dir.name)
            transcripts_root = project_dir / "agent-transcripts"
            if not transcripts_root.is_dir():
                continue
            for agent_dir in sorted(transcripts_root.iterdir()):
                if not agent_dir.is_dir():
                    continue
                parent_jsonl = agent_dir / f"{agent_dir.name}.jsonl"
                if not parent_jsonl.is_file():
                    # Some agents only have a subagents dir; skip cleanly.
                    continue
                subagents_dir = agent_dir / "subagents"
                subagent_files = (
                    sorted(subagents_dir.glob("*.jsonl"))
                    if subagents_dir.is_dir()
                    else []
                )
                parent = _summarize_cursor_file(
                    parent_jsonl,
                    session_id=agent_dir.name,
                    kind="parent",
                    parent_session_id=None,
                    cwd_hint=cwd_hint,
                )
                parent.subagent_count = len(subagent_files)
                rows.append(parent)
                for sp in subagent_files:
                    rows.append(
                        _summarize_cursor_file(
                            sp,
                            session_id=sp.stem,
                            kind="subagent",
                            parent_session_id=agent_dir.name,
                            cwd_hint=cwd_hint,
                        )
                    )
    return rows


# ---------------------------------------------------------------------------
# census
# ---------------------------------------------------------------------------


def render_census(rows: list[SessionSummary]) -> str:
    from collections import Counter

    by_source: dict[str, list[SessionSummary]] = {}
    for r in rows:
        by_source.setdefault(r.agent_source, []).append(r)

    lines: list[str] = []
    lines.append("# Sessions census — Object Compiler corpus")
    lines.append("")
    lines.append(f"Total emitted rows: **{len(rows)}**")
    lines.append("")
    lines.append("## By agent_source")
    lines.append("")
    lines.append("| agent_source | rows | kinds | room.config.ts touches | date range |")
    lines.append("| --- | ---: | --- | ---: | --- |")
    for src in sorted(by_source):
        srows = by_source[src]
        kinds = Counter(r.kind for r in srows)
        kinds_str = ", ".join(f"{k}:{v}" for k, v in sorted(kinds.items()))
        room_touches = sum(
            1
            for r in srows
            for fp in r.files_touched
            if ROOM_CONFIG_RE.search(fp)
        )
        first = min((r.timestamp_first for r in srows if r.timestamp_first),
                     default="")
        last = max((r.timestamp_last for r in srows if r.timestamp_last),
                     default="")
        rng = f"{first} → {last}" if first and last else "—"
        lines.append(f"| {src} | {len(srows)} | {kinds_str} | {room_touches} | {rng} |")

    lines.append("")
    lines.append("## Room-authoring signal")
    lines.append("")
    lines.append(
        "Rows whose `files_touched` contains a `src/rooms/<key>/room.config.ts` "
        "path — the direct fingerprint of a room-authoring session."
    )
    lines.append("")
    lines.append("| agent_source | sessions touching room.config.ts | distinct room keys |")
    lines.append("| --- | ---: | --- |")
    for src in sorted(by_source):
        srows = by_source[src]
        touching = [
            r for r in srows
            if any(ROOM_CONFIG_RE.search(fp) for fp in r.files_touched)
        ]
        keys: set[str] = set()
        for r in touching:
            for fp in r.files_touched:
                m = re.search(r"src/rooms/([^/]+)/room\.config\.ts$", fp)
                if m:
                    keys.add(m.group(1))
        lines.append(
            f"| {src} | {len(touching)} | {', '.join(sorted(keys)) or '—'} |"
        )

    lines.append("")
    lines.append("## Bookkeeping")
    lines.append("")
    lines.append(
        "- **Filter:** a row is emitted iff its `cwd`, `git_branch`, or "
        "`files_touched` contains the substring `objetdart` (case-insensitive)."
    )
    lines.append(
        "- **Truncation:** `first_user_message` is capped at "
        f"{FIRST_USER_MESSAGE_MAX} characters."
    )
    lines.append(
        "- **Timestamps:** Claude entries carry ISO 8601 on every line; "
        "Codex entries carry ISO 8601 on every line and a "
        "`session_meta.timestamp`; Cursor JSONL has no wall-clock, so the "
        "walker uses the transcript file's mtime."
    )
    lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str]) -> tuple[list[Path], list[Path], list[Path], Path, Path]:
    claude_roots: list[Path] = []
    codex_roots: list[Path] = []
    cursor_roots: list[Path] = []
    out = DEFAULT_OUT_PATH
    census = DEFAULT_CENSUS_PATH

    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--claude-root", "--root") and i + 1 < len(argv):
            claude_roots.append(Path(argv[i + 1]).expanduser())
            i += 2
        elif a == "--codex-root" and i + 1 < len(argv):
            codex_roots.append(Path(argv[i + 1]).expanduser())
            i += 2
        elif a == "--cursor-root" and i + 1 < len(argv):
            cursor_roots.append(Path(argv[i + 1]).expanduser())
            i += 2
        elif a == "--out" and i + 1 < len(argv):
            out = Path(argv[i + 1]).expanduser()
            i += 2
        elif a == "--census" and i + 1 < len(argv):
            census = Path(argv[i + 1]).expanduser()
            i += 2
        elif a in ("-h", "--help"):
            print(__doc__)
            sys.exit(0)
        else:
            print(f"[error] unknown arg: {a}", file=sys.stderr)
            print(__doc__, file=sys.stderr)
            sys.exit(2)

    if not claude_roots:
        claude_roots = list(DEFAULT_CLAUDE_ROOTS)
    if not codex_roots:
        codex_roots = list(DEFAULT_CODEX_ROOTS)
    if not cursor_roots:
        cursor_roots = list(DEFAULT_CURSOR_ROOTS)
    return claude_roots, codex_roots, cursor_roots, out, census


def main(argv: list[str]) -> int:
    claude_roots, codex_roots, cursor_roots, out, census = _parse_args(argv)

    print(f"[info] claude roots: {[str(p) for p in claude_roots]}")
    print(f"[info] codex  roots: {[str(p) for p in codex_roots]}")
    print(f"[info] cursor roots: {[str(p) for p in cursor_roots]}")
    print(f"[info] output:       {out}")
    print(f"[info] census:       {census}")

    # ---- walk ----
    print("[info] walking claude...")
    claude_rows: list[SessionSummary] = []
    for r in claude_roots:
        claude_rows.extend(walk_claude(r))
    print(f"[info]   claude produced {len(claude_rows)} row(s) pre-filter")

    print("[info] walking codex...")
    codex_rows = walk_codex(codex_roots)
    print(f"[info]   codex  produced {len(codex_rows)} row(s) pre-filter")

    print("[info] walking cursor...")
    cursor_rows = walk_cursor(cursor_roots)
    print(f"[info]   cursor produced {len(cursor_rows)} row(s) pre-filter")

    # ---- filter to this repo ----
    all_rows = [*claude_rows, *codex_rows, *cursor_rows]
    kept = [r for r in all_rows if r.touches_repo()]

    dropped_by_src: dict[str, int] = {}
    for r in all_rows:
        if not r.touches_repo():
            dropped_by_src[r.agent_source] = dropped_by_src.get(r.agent_source, 0) + 1
    for src, n in sorted(dropped_by_src.items()):
        print(f"[info]   {src}: dropped {n} non-objetdart row(s)")

    # ---- write ----
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for r in kept:
            fh.write(r.to_json_line())
            fh.write("\n")

    census.parent.mkdir(parents=True, exist_ok=True)
    census.write_text(render_census(kept), encoding="utf-8")

    # ---- summary ----
    by_source: dict[str, int] = {}
    for r in kept:
        by_source[r.agent_source] = by_source.get(r.agent_source, 0) + 1
    print("[done] rows emitted by agent_source:")
    for src, n in sorted(by_source.items()):
        print(f"         {src}: {n}")
    print(f"[done] total: {len(kept)} rows → {out}")
    print(f"[done] census → {census}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
