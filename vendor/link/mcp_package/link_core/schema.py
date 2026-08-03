"""Shared Link wiki schema helpers."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .files import atomic_write_json
from .log import utc_timestamp


CURRENT_SCHEMA_VERSION = 1
SCHEMA_NAME = "link-wiki"
SCHEMA_FILE = "_link_schema.json"
REQUIRED_WIKI_DIRS = (
    "sources",
    "concepts",
    "entities",
    "memories",
    "comparisons",
    "explorations",
)


def schema_path(wiki_dir: Path) -> Path:
    return wiki_dir / SCHEMA_FILE


def _base_status(wiki_dir: Path) -> dict[str, object]:
    path = schema_path(wiki_dir)
    return {
        "path": str(path),
        "schema": SCHEMA_NAME,
        "current_version": CURRENT_SCHEMA_VERSION,
        "version": None,
        "status": "missing",
        "needs_migration": True,
        "error": "",
    }


def schema_status(wiki_dir: Path) -> dict[str, object]:
    """Return schema marker status without mutating the wiki."""
    wiki_dir = wiki_dir.expanduser().resolve()
    path = schema_path(wiki_dir)
    status = _base_status(wiki_dir)

    if not path.exists():
        return status

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        status.update({
            "status": "invalid",
            "needs_migration": False,
            "error": f"invalid schema marker: {exc}",
        })
        return status

    if not isinstance(data, dict):
        status.update({
            "status": "invalid",
            "needs_migration": False,
            "error": "invalid schema marker: root must be an object",
        })
        return status

    marker_schema = data.get("schema", SCHEMA_NAME)
    if marker_schema != SCHEMA_NAME:
        status.update({
            "status": "invalid",
            "needs_migration": False,
            "error": f"invalid schema marker: schema must be {SCHEMA_NAME!r}",
        })
        return status

    raw_version = data.get("version")
    try:
        version = int(raw_version)
    except (TypeError, ValueError):
        status.update({
            "status": "invalid",
            "needs_migration": False,
            "error": "invalid schema marker: version must be an integer",
        })
        return status

    status["version"] = version
    if version < CURRENT_SCHEMA_VERSION:
        status.update({"status": "old", "needs_migration": True})
    elif version > CURRENT_SCHEMA_VERSION:
        status.update({
            "status": "newer",
            "needs_migration": False,
            "error": (
                f"wiki schema {version} is newer than this runtime "
                f"supports ({CURRENT_SCHEMA_VERSION})"
            ),
        })
    else:
        status.update({"status": "current", "needs_migration": False})
    return status


def write_schema(wiki_dir: Path, version: int = CURRENT_SCHEMA_VERSION) -> dict[str, object]:
    """Write the current schema marker and return the serialized payload."""
    wiki_dir = wiki_dir.expanduser().resolve()
    wiki_dir.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "schema": SCHEMA_NAME,
        "version": int(version),
        "updated_at": utc_timestamp(),
    }
    atomic_write_json(schema_path(wiki_dir), payload)
    return payload


def migrate_wiki(wiki_dir: Path) -> dict[str, object]:
    """Apply safe, idempotent wiki structure migrations.

    Version 1 only writes the schema marker and ensures canonical wiki category
    directories exist. It does not rewrite user pages.
    """
    wiki_dir = wiki_dir.expanduser().resolve()
    before = schema_status(wiki_dir)
    changes: list[str] = []

    if before["status"] in {"invalid", "newer"}:
        return {
            "ok": False,
            "migrated": False,
            "previous": before,
            "schema": before,
            "changes": changes,
            "error": before.get("error") or "schema migration refused",
        }

    if not wiki_dir.exists():
        wiki_dir.mkdir(parents=True, exist_ok=True)
        changes.append("created wiki directory")

    for dirname in REQUIRED_WIKI_DIRS:
        path = wiki_dir / dirname
        if not path.exists():
            path.mkdir(parents=True, exist_ok=True)
            changes.append(f"created {dirname}/")

    if before["needs_migration"]:
        write_schema(wiki_dir)
        changes.append(f"wrote {SCHEMA_FILE}")

    after = schema_status(wiki_dir)
    return {
        "ok": after["status"] == "current",
        "migrated": bool(changes),
        "previous": before,
        "schema": after,
        "changes": changes,
        "error": after.get("error") or "",
    }
