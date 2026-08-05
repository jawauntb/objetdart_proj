#!/usr/bin/env python3
"""
analyze-llm-classification.py — post-process the LLM classifications
produced by `classify-task-family.py` and generate two artifacts:

1. An updated `data/object-compiler/prs-census.md` with a new
   "LLM-classified breakdown" section.
2. `data/object-compiler/audits/phase-2-classifier.md` — the phase-2
   Track B audit report.

Reads only `data/object-compiler/prs.jsonl`. No LLM calls; deterministic.

Usage:
    python3 scripts/object-compiler/analyze-llm-classification.py
    python3 scripts/object-compiler/analyze-llm-classification.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

DEFAULT_PRS_JSONL = "data/object-compiler/prs.jsonl"
DEFAULT_CENSUS = "data/object-compiler/prs-census.md"
DEFAULT_REPORT = "data/object-compiler/audits/phase-2-classifier.md"

KNOWN_FAMILIES = {
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
}


def _load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def _confidence_bucket(c: float) -> str:
    if c >= 0.9:
        return ">= 0.9"
    if c >= 0.8:
        return "0.8 – 0.9"
    if c >= 0.7:
        return "0.7 – 0.8"
    if c >= 0.6:
        return "0.6 – 0.7"
    if c >= 0.5:
        return "0.5 – 0.6"
    if c > 0.0:
        return "< 0.5"
    return "unset"


_BUCKET_ORDER = [
    ">= 0.9",
    "0.8 – 0.9",
    "0.7 – 0.8",
    "0.6 – 0.7",
    "0.5 – 0.6",
    "< 0.5",
    "unset",
]


def _fused_family(row: dict[str, Any]) -> str:
    """Preferred family: the LLM label if present, else the heuristic."""
    llm = row.get("task_family_llm")
    if isinstance(llm, str) and llm and llm != "unknown":
        return llm
    heur = row.get("task_family")
    return heur if isinstance(heur, str) and heur else "unknown"


def build_census_llm_section(rows: list[dict[str, Any]]) -> str:
    """Compose the 'LLM-classified breakdown' section (returned as one
    joined string of markdown; caller inserts it into the census file)."""
    total = len(rows)
    heur_unknown = [r for r in rows if r.get("task_family") == "unknown"]
    llm_labeled = [r for r in rows if r.get("task_family_llm")]
    resolved = [
        r for r in heur_unknown
        if r.get("task_family_llm") and r["task_family_llm"] != "unknown"
    ]
    llm_families = Counter(
        r.get("task_family_llm") or "unset"
        for r in rows
        if r.get("task_family_llm")
    )
    fused_families = Counter(_fused_family(r) for r in rows)

    other_families = Counter(
        r["task_family_llm"] for r in rows
        if isinstance(r.get("task_family_llm"), str)
        and r["task_family_llm"].startswith("other-")
    )

    confidence_buckets = Counter(
        _confidence_bucket(float(r.get("task_family_llm_confidence") or 0.0))
        for r in rows
        if r.get("task_family_llm") is not None
    )

    disagreements = [
        r for r in rows
        if r.get("task_family_llm")
        and r.get("task_family") != "unknown"
        and r["task_family_llm"] != r["task_family"]
        and r["task_family_llm"] != "unknown"
    ]

    lines: list[str] = []
    lines.append("## LLM-classified breakdown")
    lines.append("")
    lines.append(
        "Task-family labels produced by `scripts/object-compiler/"
        "classify-task-family.py` (haiku, min-confidence 0.6). The "
        "heuristic label in the section above is preserved untouched; "
        "these fields (`task_family_llm`, `task_family_llm_confidence`, "
        "`task_family_llm_reasoning`) live alongside it."
    )
    lines.append("")
    lines.append(f"- PRs labeled by LLM: **{len(llm_labeled)} / {total}**")
    lines.append(
        f"- PRs moved from heuristic `unknown` → real family: "
        f"**{len(resolved)} / {len(heur_unknown)}**"
    )
    lines.append(
        f"- Disagreements (heuristic said X, LLM said Y, both non-unknown): "
        f"**{len(disagreements)}**"
    )
    lines.append(
        f"- Novel `other-*` families discovered: **{len(other_families)}** "
        f"distinct labels covering "
        f"{sum(other_families.values())} PRs"
    )
    lines.append("")
    lines.append("### LLM family distribution")
    lines.append("")
    lines.append("| family | count |")
    lines.append("| --- | ---: |")
    for family, count in sorted(
        llm_families.items(), key=lambda kv: (-kv[1], kv[0])
    ):
        lines.append(f"| {family} | {count} |")
    lines.append("")
    lines.append("### Fused family distribution (LLM if labeled, else heuristic)")
    lines.append("")
    lines.append("| family | count |")
    lines.append("| --- | ---: |")
    for family, count in sorted(
        fused_families.items(), key=lambda kv: (-kv[1], kv[0])
    ):
        lines.append(f"| {family} | {count} |")
    lines.append("")
    lines.append("### Confidence-score distribution")
    lines.append("")
    lines.append("| bucket | count |")
    lines.append("| --- | ---: |")
    for bucket in _BUCKET_ORDER:
        c = confidence_buckets.get(bucket, 0)
        if c:
            lines.append(f"| {bucket} | {c} |")
    lines.append("")

    if other_families:
        lines.append("### `other-*` families")
        lines.append("")
        lines.append("| family | count |")
        lines.append("| --- | ---: |")
        for family, count in sorted(
            other_families.items(), key=lambda kv: (-kv[1], kv[0])
        ):
            lines.append(f"| {family} | {count} |")
        lines.append("")

    if disagreements:
        lines.append("### Heuristic ↔ LLM disagreements")
        lines.append("")
        lines.append("PRs where the heuristic labeled non-`unknown` and the LLM chose a different non-`unknown` family. Rows sorted by LLM confidence.")
        lines.append("")
        lines.append("| PR | heuristic | LLM | conf | title |")
        lines.append("| ---: | --- | --- | ---: | --- |")
        disagreements_sorted = sorted(
            disagreements,
            key=lambda r: -float(r.get("task_family_llm_confidence") or 0.0),
        )
        for r in disagreements_sorted:
            title = (r.get("title") or "")[:80].replace("|", "/")
            conf = float(r.get("task_family_llm_confidence") or 0.0)
            lines.append(
                f"| #{r.get('pr_number')} | {r.get('task_family')} | "
                f"{r.get('task_family_llm')} | {conf:.2f} | {title} |"
            )
        lines.append("")

    return "\n".join(lines)


def update_census(census_path: Path, section: str) -> None:
    """Replace or append the 'LLM-classified breakdown' section in the
    census markdown. If the section already exists, we replace it. If it
    doesn't, we append it to EOF (leaving the existing patch-archive
    section, if any, in place — we prepend a blank line if needed)."""
    if census_path.exists():
        text = census_path.read_text(encoding="utf-8")
    else:
        text = ""

    marker = "## LLM-classified breakdown"
    idx = text.find(marker)
    if idx != -1:
        # Trim from the marker to the next top-level heading (or EOF).
        rest = text[idx + len(marker):]
        next_h2 = rest.find("\n## ")
        if next_h2 == -1:
            new_text = text[:idx] + section.rstrip() + "\n"
        else:
            end = idx + len(marker) + next_h2 + 1
            new_text = text[:idx] + section.rstrip() + "\n\n" + text[end:]
    else:
        sep = "" if text.endswith("\n\n") else ("\n" if text.endswith("\n") else "\n\n")
        new_text = text + sep + section.rstrip() + "\n"

    census_path.write_text(new_text, encoding="utf-8")


def build_report(rows: list[dict[str, Any]]) -> str:
    """Compose the phase-2-classifier audit report."""
    total = len(rows)
    heur_unknown = [r for r in rows if r.get("task_family") == "unknown"]
    llm_labeled = [r for r in rows if r.get("task_family_llm")]
    resolved = [
        r for r in heur_unknown
        if r.get("task_family_llm") and r["task_family_llm"] != "unknown"
    ]
    still_unknown_llm = [
        r for r in heur_unknown if r.get("task_family_llm") == "unknown"
    ]
    unclassified = [
        r for r in heur_unknown if not r.get("task_family_llm")
    ]

    # Family gain: how many PRs each family gained from the LLM pass.
    heur_counts = Counter(r.get("task_family") or "unknown" for r in rows)
    fused_counts = Counter(_fused_family(r) for r in rows)
    llm_counts = Counter(
        r.get("task_family_llm") for r in rows if r.get("task_family_llm")
    )
    llm_of_unknowns = Counter(
        r["task_family_llm"] for r in resolved
    )

    other_families = Counter(
        r["task_family_llm"] for r in rows
        if isinstance(r.get("task_family_llm"), str)
        and r["task_family_llm"].startswith("other-")
    )

    # Concentration: what fraction of the resolved bucket is the top family?
    if llm_of_unknowns:
        top_family, top_count = llm_of_unknowns.most_common(1)[0]
        top_fraction = top_count / max(1, len(resolved))
    else:
        top_family, top_count, top_fraction = "n/a", 0, 0.0

    disagreements = [
        r for r in rows
        if r.get("task_family_llm")
        and r.get("task_family") != "unknown"
        and r["task_family_llm"] != r["task_family"]
        and r["task_family_llm"] != "unknown"
    ]

    # Confidence distribution among resolved rows.
    conf_buckets = Counter(
        _confidence_bucket(float(r.get("task_family_llm_confidence") or 0.0))
        for r in llm_labeled
    )

    # Look for structural patterns that a tightened heuristic could catch.
    # Sample reasoning strings, grouped by family — cheap way to surface
    # the recurring file-path signature.
    reasoning_by_family: dict[str, list[str]] = defaultdict(list)
    for r in resolved:
        fam = r.get("task_family_llm") or "unknown"
        reason = r.get("task_family_llm_reasoning") or ""
        if reason:
            reasoning_by_family[fam].append(
                f"#{r.get('pr_number')}: {reason[:180]}"
            )

    # File-path signatures per LLM family: what directories dominate?
    def _dir_signature(files: list[str]) -> list[tuple[str, int]]:
        buckets: Counter[str] = Counter()
        for p in files:
            if not p:
                continue
            parts = p.split("/")
            if len(parts) >= 2:
                buckets[f"{parts[0]}/{parts[1]}/"] += 1
            else:
                buckets[parts[0]] += 1
        return buckets.most_common(6)

    dir_by_family: dict[str, Counter] = defaultdict(Counter)
    for r in resolved:
        fam = r.get("task_family_llm") or "unknown"
        for p in (r.get("files_touched") or []):
            parts = p.split("/")
            key = "/".join(parts[:2]) + "/" if len(parts) >= 2 else parts[0]
            dir_by_family[fam][key] += 1

    lines: list[str] = []
    lines.append("# Phase-2 Track B — LLM-assisted task-family classifier")
    lines.append("")
    lines.append(
        "One-paragraph situation. The heuristic in "
        "`_infer_task_family` inside `extract-git-history.py` reads a PR's "
        "file paths and title and cascades through nine rules before "
        "falling to a size-bounded `mechanic-improvement` last step. On the "
        f"262-PR archive it labels **{total - len(heur_unknown)}** into named "
        f"families and leaves **{len(heur_unknown)}** as `unknown` "
        f"(~{100 * len(heur_unknown) // max(1, total)}%). "
        "This report describes the LLM pass that resolves the "
        "`unknown` bucket, what it found there, and what a tightened "
        "heuristic could catch without an LLM."
    )
    lines.append("")

    lines.append("## What the LLM pass did")
    lines.append("")
    lines.append(f"- Rows in `prs.jsonl`: **{total}**")
    lines.append(f"- Heuristic `unknown`: **{len(heur_unknown)}**")
    lines.append(
        f"- LLM-classified rows: **{len(llm_labeled)}** "
        f"({100 * len(llm_labeled) // max(1, total)}% of the archive)"
    )
    lines.append(
        f"- LLM moved out of `unknown`: **{len(resolved)}** "
        f"({100 * len(resolved) // max(1, len(heur_unknown))}% of the unknown bucket)"
    )
    lines.append(
        f"- LLM stayed `unknown` (below `--min-confidence 0.6`): "
        f"**{len(still_unknown_llm)}**"
    )
    if unclassified:
        lines.append(
            f"- LLM failed to classify (retry exhausted): **{len(unclassified)}**"
        )
    lines.append(
        f"- Heuristic ↔ LLM disagreements: **{len(disagreements)}** "
        "(both non-unknown, different family)"
    )
    lines.append("")

    lines.append("## Where the unknowns went")
    lines.append("")
    lines.append(
        "How the 158 heuristic-`unknown` PRs redistribute under the LLM "
        "pass. This is the load-bearing number for the meta-observation: "
        f"the top family absorbs {top_fraction:.0%} of the resolved bucket "
        f"({top_count}/{len(resolved)} rows), so the unknown pool "
        f"is **{'not particularly concentrated' if top_fraction < 0.6 else 'dominated by one family'}**."
    )
    lines.append("")
    lines.append("| LLM family | resolved-from-unknown count |")
    lines.append("| --- | ---: |")
    for fam, count in llm_of_unknowns.most_common():
        lines.append(f"| {fam} | {count} |")
    lines.append("")

    lines.append("## Family totals — before and after")
    lines.append("")
    lines.append(
        "Family counts under three views: heuristic-only, LLM-only, and "
        "fused (LLM if labeled, else heuristic)."
    )
    lines.append("")
    lines.append("| family | heuristic | LLM | fused |")
    lines.append("| --- | ---: | ---: | ---: |")
    all_families = sorted(
        {f for f in (set(heur_counts) | set(llm_counts) | set(fused_counts) | KNOWN_FAMILIES) if f is not None}
    )
    for fam in all_families:
        lines.append(
            f"| {fam} | {heur_counts.get(fam, 0)} | "
            f"{llm_counts.get(fam, 0)} | {fused_counts.get(fam, 0)} |"
        )
    lines.append("")

    if other_families:
        lines.append("## Novel `other-*` families")
        lines.append("")
        lines.append(
            "Families the LLM invented (via the `other-<slug>` fallback) "
            "for patterns not covered by the ten canonical labels."
        )
        lines.append("")
        lines.append("| family | count |")
        lines.append("| --- | ---: |")
        for fam, count in other_families.most_common():
            lines.append(f"| {fam} | {count} |")
        lines.append("")

    lines.append("## Confidence distribution (all LLM-labeled rows)")
    lines.append("")
    lines.append("| bucket | count |")
    lines.append("| --- | ---: |")
    for bucket in _BUCKET_ORDER:
        c = conf_buckets.get(bucket, 0)
        if c:
            lines.append(f"| {bucket} | {c} |")
    lines.append("")

    lines.append("## Structural patterns worth folding into the heuristic")
    lines.append("")
    lines.append(
        "Per-family file-path signatures across resolved rows. Where a "
        "single directory dominates a family's footprint, the heuristic "
        "can plausibly catch it by grep alone — no LLM required. This is "
        "the promote-from-LLM-to-regex ledger."
    )
    lines.append("")
    for fam in [f for f, _ in llm_of_unknowns.most_common()]:
        top_dirs = dir_by_family[fam].most_common(6)
        if not top_dirs:
            continue
        n = sum(count for _, count in dir_by_family[fam].items())
        lines.append(f"### {fam} ({sum(1 for _ in llm_of_unknowns.elements() if _ == fam)} PRs)")
        lines.append("")
        lines.append("| dir prefix | file-mentions |")
        lines.append("| --- | ---: |")
        for d, c in top_dirs:
            lines.append(f"| `{d}` | {c} |")
        lines.append("")

    lines.append("## Heuristic ↔ LLM disagreements")
    lines.append("")
    if not disagreements:
        lines.append("_No disagreements — the LLM did not overrule the heuristic on any row._")
        lines.append("")
    else:
        lines.append(
            f"{len(disagreements)} PRs where the heuristic assigned a real "
            "family but the LLM assigned a different real family. These "
            "are the highest-value rows to hand-review — either the "
            "heuristic is over-firing or the LLM is confused by title "
            "signals."
        )
        lines.append("")
        lines.append("| PR | heuristic | LLM | conf | title |")
        lines.append("| ---: | --- | --- | ---: | --- |")
        disagreements_sorted = sorted(
            disagreements,
            key=lambda r: -float(r.get("task_family_llm_confidence") or 0.0),
        )
        for r in disagreements_sorted[:40]:
            title = (r.get("title") or "")[:80].replace("|", "/")
            conf = float(r.get("task_family_llm_confidence") or 0.0)
            lines.append(
                f"| #{r.get('pr_number')} | {r.get('task_family')} | "
                f"{r.get('task_family_llm')} | {conf:.2f} | {title} |"
            )
        if len(disagreements_sorted) > 40:
            lines.append(
                f"\n_(showing 40 of {len(disagreements_sorted)} disagreements)_"
            )
        lines.append("")

    lines.append("## Should the classifier be promoted to a tightened heuristic?")
    lines.append("")
    lines.append(
        "The premise of promotion: if a family's resolved-from-unknown "
        "set is dominated by one or two directory prefixes, the LLM was "
        "only doing what a grep could do. Reading the per-family file "
        "signatures above:"
    )
    lines.append("")
    # Derive concrete recommendations from the concentration data.
    recs: list[str] = []
    for fam, count in llm_of_unknowns.most_common():
        top_dirs = dir_by_family[fam].most_common(3)
        if not top_dirs:
            continue
        total_mentions = sum(dir_by_family[fam].values())
        if total_mentions == 0:
            continue
        top_share = top_dirs[0][1] / total_mentions
        if top_share >= 0.5:
            recs.append(
                f"- **{fam}** — top directory `{top_dirs[0][0]}` accounts "
                f"for {top_share:.0%} of file mentions; a grep-based rule "
                "would likely catch most of these without an LLM."
            )
        elif len(top_dirs) >= 2:
            share_two = (top_dirs[0][1] + top_dirs[1][1]) / total_mentions
            if share_two >= 0.5:
                recs.append(
                    f"- **{fam}** — top two directories "
                    f"(`{top_dirs[0][0]}`, `{top_dirs[1][0]}`) account "
                    f"for {share_two:.0%} of file mentions; a two-clause "
                    "grep rule would catch most of these."
                )
    if recs:
        lines.extend(recs)
    else:
        lines.append(
            "_No family shows dominant single-directory concentration — the "
            "unknown bucket is genuinely diffuse and the LLM is doing real "
            "work that a heuristic can't replicate cheaply._"
        )
    lines.append("")

    lines.append("## Load-bearing observation")
    lines.append("")
    concentration_note = (
        f"The heuristic-`unknown` bucket resolved to "
        f"**{len(llm_of_unknowns)}** distinct families under the LLM pass. "
        f"The top family (`{top_family}`) claims {top_count} of "
        f"{len(resolved)} resolved rows ({top_fraction:.0%})."
    )
    if top_fraction >= 0.6:
        concentration_note += (
            " That is high enough that a single heuristic tightening "
            "(likely adding `feat(<key>):` title prefix + `src/components/` "
            "+ `src/lib/` footprint → `mechanic-improvement`) would "
            "resolve most of the unknowns without an LLM."
        )
    elif top_fraction >= 0.4:
        concentration_note += (
            " That is moderate: the top family is by far the most "
            "common, but the tail is real. A tightened heuristic on the "
            "top family would help but wouldn't obviate the LLM."
        )
    else:
        concentration_note += (
            " That is genuinely diffuse: the unknowns are not one family "
            "the heuristic missed, they are many small families the "
            "heuristic can't cheaply separate. Keep the LLM in the loop."
        )
    lines.append(concentration_note)
    lines.append("")

    return "\n".join(lines)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze LLM classifications and update census + audit report.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--repo", default=os.getcwd())
    parser.add_argument("--prs", default=DEFAULT_PRS_JSONL)
    parser.add_argument("--census", default=DEFAULT_CENSUS)
    parser.add_argument("--report", default=DEFAULT_REPORT)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def _resolve(repo: Path, arg: str) -> Path:
    p = Path(arg)
    if not p.is_absolute():
        p = repo / p
    return p


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo = Path(args.repo).resolve()
    prs_path = _resolve(repo, args.prs)
    census_path = _resolve(repo, args.census)
    report_path = _resolve(repo, args.report)

    if not prs_path.exists():
        print(f"error: {prs_path} does not exist", file=sys.stderr)
        return 2

    rows = _load_rows(prs_path)
    section = build_census_llm_section(rows)
    report = build_report(rows)

    if args.dry_run:
        print("### CENSUS SECTION ###", file=sys.stderr)
        print(section, file=sys.stderr)
        print("### REPORT ###", file=sys.stderr)
        print(report, file=sys.stderr)
        return 0

    update_census(census_path, section)
    print(f"wrote census section to {census_path}", file=sys.stderr)

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")
    print(f"wrote phase-2 report to {report_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
