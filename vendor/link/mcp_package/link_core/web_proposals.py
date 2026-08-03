"""Shared web proposal-source helpers for Link's local viewer."""
from __future__ import annotations

from pathlib import Path
from typing import Collection, Mapping
from urllib.parse import unquote

from .log import append_log, utc_timestamp
from .raw import RawSourceError, create_raw_source
from .security import redact_secret_values, secret_file_scan
from .web_http import is_relative_to, safe_resolve


def proposal_source_title(text: str, fallback: str) -> str:
    """Return a short display title for a raw source preview."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()[:100] or fallback
        if stripped:
            return stripped[:100]
    return fallback


def proposal_source_snippet(text: str) -> str:
    """Return a compact, redaction-safe source snippet."""
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("---")
    ]
    return " ".join(lines[:3])[:260]


def proposal_source_preview(path: Path, max_bytes: int) -> tuple[str, str]:
    """Read a bounded source preview, returning (text, error)."""
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            return handle.read(max_bytes + 1), ""
    except OSError as exc:
        return "", str(exc)


def resolve_proposal_source_path(
    raw_dir: Path,
    source_path: str,
    suffixes: Collection[str],
) -> Path | None:
    """Resolve a proposal source under the target, rejecting generated/hidden files."""
    raw_text = str(source_path or "").strip()
    if len(raw_text) > 1000:
        return None
    decoded = unquote(raw_text).strip().lstrip("/")
    if decoded.startswith("raw/"):
        decoded = decoded[4:]
    if not decoded:
        return None
    resolved = safe_resolve(raw_dir / decoded)
    raw_root = raw_dir.resolve()
    if not resolved or not is_relative_to(resolved, raw_root):
        return None
    if any(part.startswith(".") for part in resolved.relative_to(raw_root).parts):
        return None
    if resolved.relative_to(raw_root).parts[:1] == ("wiki",):
        return None
    if not resolved.is_file() or resolved.suffix.lower() not in suffixes:
        return None
    return resolved


def proposal_source_record(
    raw_dir: Path,
    path: Path,
    *,
    max_bytes: int,
    include_text: bool = False,
) -> dict[str, object]:
    """Return one target source record for the proposal UI."""
    raw_root = raw_dir.resolve()
    rel = path.relative_to(raw_root).as_posix()
    display_rel = f"raw/{rel}" if raw_root.name == "raw" else rel
    try:
        size = path.stat().st_size
    except OSError as exc:
        return {
            "path": display_rel,
            "source": display_rel,
            "title": rel,
            "size": 0,
            "snippet": "",
            "secret_warnings": [],
            "warning_count": 0,
            "loadable": False,
            "truncated": False,
            "action": "unavailable",
            "action_label": "Unavailable",
            "error": str(exc),
        }
    text, read_error = proposal_source_preview(path, max_bytes)
    scan = secret_file_scan(path)
    labels = list(scan.get("labels") or [])
    scan_error = str(scan.get("error") or "")
    read_error = read_error or scan_error
    redacted, _, _ = redact_secret_values(text) if labels else (text, [], 0)
    truncated = size > max_bytes
    if read_error:
        action = "unavailable"
        action_label = "Fix access"
    elif labels:
        action = "redact"
        action_label = "Redact first"
    elif truncated:
        action = "split"
        action_label = "Split file"
    else:
        action = "load"
        action_label = "Use in form"
    record: dict[str, object] = {
        "path": display_rel,
        "source": display_rel,
        "title": proposal_source_title(redacted, rel),
        "size": size,
        "snippet": proposal_source_snippet(redacted),
        "secret_warnings": labels,
        "warning_count": len(labels),
        "loadable": action == "load",
        "truncated": truncated,
        "action": action,
        "action_label": action_label,
    }
    if read_error:
        record["error"] = read_error
    if include_text and record["loadable"]:
        record["text"] = text[:max_bytes]
    return record


def proposal_sources(
    raw_dir: Path,
    *,
    suffixes: Collection[str],
    max_bytes: int,
    limit: int = 50,
) -> dict[str, object]:
    """List proposal-ready target source records."""
    if not raw_dir.exists():
        return {"count": 0, "sources": [], "raw_dir": str(raw_dir), "warning_count": 0}
    raw_root = raw_dir.resolve()
    sources: list[dict[str, object]] = []
    for path in sorted(raw_dir.rglob("*")):
        resolved = safe_resolve(path)
        if not resolved or not is_relative_to(resolved, raw_root):
            continue
        if not resolved.is_file() or resolved.suffix.lower() not in suffixes:
            continue
        if any(part.startswith(".") for part in resolved.relative_to(raw_root).parts):
            continue
        if resolved.relative_to(raw_root).parts[:1] == ("wiki",):
            continue
        sources.append(proposal_source_record(raw_dir, resolved, max_bytes=max_bytes))
        if len(sources) >= limit:
            break
    warning_count = sum(int(source.get("warning_count") or 0) for source in sources)
    return {
        "count": len(sources),
        "sources": sources,
        "raw_dir": str(raw_dir),
        "warning_count": warning_count,
    }


def proposal_source_payload(
    raw_dir: Path,
    source_path: str,
    *,
    suffixes: Collection[str],
    max_bytes: int,
) -> tuple[dict[str, object], int]:
    """Return the load payload for a proposal source path."""
    path = resolve_proposal_source_path(raw_dir, source_path, suffixes)
    if not path:
        return {"found": False, "error": "source path not found or unsupported"}, 404
    record = proposal_source_record(raw_dir, path, max_bytes=max_bytes, include_text=True)
    if record.get("warning_count"):
        record["found"] = True
        record["error"] = "source contains secret-looking values; redact before loading"
        return record, 409
    if not record.get("loadable"):
        record["found"] = True
        if record.get("action") == "unavailable":
            record["error"] = record.get("error") or "source could not be read"
            return record, 423
        record["error"] = "source is too large to load into the proposal form"
        return record, 413
    record["found"] = True
    return record, 200


def create_raw_source_payload(
    root: Path,
    wiki_dir: Path,
    payload: Mapping[str, object],
    *,
    max_bytes: int,
) -> tuple[dict[str, object], int]:
    """Create a target source from the web UI and append a local audit log entry."""
    try:
        result = create_raw_source(
            root,
            title=payload.get("title", ""),
            filename=payload.get("filename", ""),
            text=payload.get("text", ""),
            max_bytes=max_bytes,
        )
    except RawSourceError as exc:
        return {
            "created": False,
            "error": str(exc),
            "secret_warnings": exc.labels,
        }, exc.status
    append_log(
        wiki_dir,
        utc_timestamp(),
        "add-source",
        f"Added {result['path']} from local web UI",
        [
            f"Target source: {result['path']}",
            f"Size bytes: {result['size_bytes']}",
            "Secret warnings: none",
        ],
    )
    return result, 201
