#!/usr/bin/env python3
"""AttyMate's minimal command surface for the vendored Link runtime.

This wrapper intentionally exposes only the commands used by AttyMate:
``init``, ``ingest-status``, and ``query``. The indexing and retrieval
implementations remain Link source; unrelated Link product surfaces are not
shipped with the application.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence


ROOT = Path(__file__).resolve().parent
BUNDLED_CORE = ROOT / "mcp_package"
if str(BUNDLED_CORE) not in sys.path:
    sys.path.insert(0, str(BUNDLED_CORE))

from link_core.files import atomic_write_json, atomic_write_text
from link_core.ingest import collect_ingest_status
from link_core.memory import default_project_for_target, memory_records
from link_core.query import BUDGETS, query_link
from link_core.schema import migrate_wiki
from link_core.security import clean_text_input
from link_core.wiki import (
    build_backlinks,
    build_wiki_cache,
    close_wiki_cache,
    rebuild_index,
)


SKIP_SCAN_DIRS = {
    ".git",
    ".link-backups",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    "dist",
    "build",
    ".venv",
    "venv",
    "node_modules",
}
WIKI_DIRS = (
    "sources",
    "concepts",
    "entities",
    "memories",
    "comparisons",
    "explorations",
)


def resolve_target(value: str | Path) -> Path:
    return Path(value).expanduser().resolve()


def resolve_wiki_dir(target: Path) -> Path:
    if target.name == "wiki" and (target / "index.md").exists():
        return target
    return target / "wiki"


def initialize(target_value: str | Path) -> int:
    target = resolve_target(target_value)
    wiki_dir = target / "wiki"
    target.mkdir(parents=True, exist_ok=True)
    changes: list[str] = []

    if not wiki_dir.exists():
        wiki_dir.mkdir(parents=True)
        changes.append("created wiki")
    for dirname in WIKI_DIRS:
        path = wiki_dir / dirname
        if not path.exists():
            path.mkdir(parents=True)
            changes.append(f"created wiki/{dirname}")

    log_path = wiki_dir / "log.md"
    if not log_path.exists():
        atomic_write_text(
            log_path,
            "# Link Wiki Log\n\n*Append-only record of wiki operations.*\n",
        )
        changes.append("created wiki/log.md")

    index_existed = (wiki_dir / "index.md").exists()
    rebuild_index(wiki_dir)
    changes.append("rebuilt wiki/index.md" if index_existed else "created wiki/index.md")

    atomic_write_json(
        wiki_dir / "_backlinks.json",
        build_backlinks(wiki_dir, body_only=False),
    )
    changes.append("rebuilt wiki/_backlinks.json")

    migration = migrate_wiki(wiki_dir)
    changes.extend(f"schema: {item}" for item in migration.get("changes", []))
    if not migration.get("ok"):
        print(f"Link initialization failed: {migration.get('error')}", file=sys.stderr)
        return 1

    print(f"Link wiki ready at {target}")
    if changes:
        print("\nInitialized:")
        for change in changes:
            print(f"  - {change}")
    return 0


def show_ingest_status(target_value: str | Path, *, json_output: bool) -> int:
    target = resolve_target(target_value)
    status = collect_ingest_status(target, skip_dirs=SKIP_SCAN_DIRS)
    if json_output:
        print(json.dumps(status, indent=2))
    else:
        print(
            f"Link ingest: {status['represented_count']}/{status['source_count']} "
            f"represented; {status['pending_count']} pending; "
            f"backlinks {status['backlinks_status']}"
        )
    return 0 if status["has_raw_dir"] and status["has_wiki_dir"] else 1


def run_query(
    query_text: str,
    target_value: str | Path,
    *,
    budget: str,
    project: str | None,
) -> int:
    target = resolve_target(target_value)
    wiki_dir = resolve_wiki_dir(target)
    if not wiki_dir.exists():
        print(f"Missing wiki directory: {wiki_dir}", file=sys.stderr)
        return 1

    query_text = clean_text_input(query_text, max_len=500)
    cache = build_wiki_cache(wiki_dir)
    try:
        payload = query_link(
            wiki_dir,
            query_text,
            cache,
            memory_records(wiki_dir),
            budget=budget,
            project=project or default_project_for_target(target),
            review_command="review-memory",
        )
    finally:
        close_wiki_cache(cache)

    # AttyMate consumes JSON. Keeping JSON as the non-flag fallback makes the
    # trimmed CLI useful for diagnostics without retaining Link's CLI renderer.
    print(json.dumps(payload, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lnk",
        description="AttyMate's vendored Link indexing and retrieval runtime",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    init_parser = commands.add_parser("init", help="initialize or refresh a Link wiki")
    init_parser.add_argument("target", nargs="?", default=".")

    status_parser = commands.add_parser("ingest-status", help="inspect index coverage")
    status_parser.add_argument("target", nargs="?", default=".")
    status_parser.add_argument("--json", action="store_true", dest="json_output")

    query_parser = commands.add_parser("query", help="retrieve a source-backed context packet")
    query_parser.add_argument("query_text")
    query_parser.add_argument("target", nargs="?", default=".")
    query_parser.add_argument("--budget", choices=sorted(BUDGETS), default="medium")
    query_parser.add_argument("--project")
    query_parser.add_argument("--json", action="store_true", dest="json_output")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "init":
        return initialize(args.target)
    if args.command == "ingest-status":
        return show_ingest_status(args.target, json_output=args.json_output)
    if args.command == "query":
        return run_query(
            args.query_text,
            args.target,
            budget=args.budget,
            project=args.project,
        )
    raise AssertionError(f"unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
