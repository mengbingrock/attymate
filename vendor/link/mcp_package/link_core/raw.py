"""Shared target-source creation helpers for Link."""
from __future__ import annotations

import re
from pathlib import Path

from .files import atomic_write_text
from .security import clean_text_input, secret_value_warnings


ALLOWED_RAW_SOURCE_SUFFIXES = {
    ".md",
    ".markdown",
    ".txt",
    ".text",
}
DEFAULT_MAX_RAW_SOURCE_BYTES = 60 * 1024


class RawSourceError(ValueError):
    """User-correctable raw-source creation error."""

    def __init__(self, message: str, *, status: int = 400, labels: list[str] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.labels = labels or []


def _slugify(value: str, fallback: str = "source") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or fallback


def _title_from_text(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return clean_text_input(stripped[2:], max_len=120)
        if stripped and not stripped.startswith("---"):
            return clean_text_input(stripped, max_len=120)
    return ""


def raw_source_filename(filename: object = "", title: object = "") -> str:
    """Return a safe root-level raw filename, rejecting folders and unsupported suffixes."""
    requested = clean_text_input(filename, max_len=140)
    title_text = clean_text_input(title, max_len=120)
    if requested:
        normalized = requested.replace("\\", "/").strip()
        if "/" in normalized.strip("/"):
            raise RawSourceError("filename must not include folders")
        path = Path(normalized)
        suffix = path.suffix.lower() or ".md"
        if suffix not in ALLOWED_RAW_SOURCE_SUFFIXES:
            allowed = ", ".join(sorted(ALLOWED_RAW_SOURCE_SUFFIXES))
            raise RawSourceError(f"filename must end with one of: {allowed}")
        stem = path.stem
    else:
        suffix = ".md"
        stem = title_text or "source"
    return f"{_slugify(stem)}{suffix}"


def _unique_raw_path(source_dir: Path, filename: str) -> Path:
    path = source_dir / filename
    if not path.exists():
        return path
    suffix = path.suffix
    stem = path.stem
    for index in range(2, 1000):
        candidate = source_dir / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate
    raise RawSourceError("too many source files with the same name", status=409)


def create_raw_source(
    root: Path,
    *,
    title: object = "",
    text: object = "",
    filename: object = "",
    max_bytes: int = DEFAULT_MAX_RAW_SOURCE_BYTES,
) -> dict[str, object]:
    """Create one local source in the target root and return the next ingest prompt."""
    root = root.expanduser().resolve()
    source_text = str(text or "").strip()
    if not source_text:
        raise RawSourceError("text required")
    size_bytes = len(source_text.encode("utf-8"))
    if size_bytes > max_bytes:
        raise RawSourceError(f"source too large; max {max_bytes} bytes", status=413)

    labels = secret_value_warnings(source_text)
    if labels:
        raise RawSourceError(
            "source contains secret-looking values; redact before saving to the target",
            status=422,
            labels=labels,
        )

    clean_title = clean_text_input(title, max_len=120) or _title_from_text(source_text) or "Source"
    safe_filename = raw_source_filename(filename, clean_title)
    root.mkdir(parents=True, exist_ok=True)
    path = _unique_raw_path(root, safe_filename)

    if source_text.lstrip().startswith(("# ", "---")):
        content = source_text
    else:
        content = f"# {clean_title}\n\n{source_text}"
    if not content.endswith("\n"):
        content += "\n"
    atomic_write_text(path, content)

    rel = path.relative_to(root).as_posix()
    return {
        "created": True,
        "path": rel,
        "title": clean_title,
        "size_bytes": path.stat().st_size,
        "next_prompt": f"ingest {rel} into Link",
        "proposal_prompt": f"propose memories from {rel}",
        "secret_warnings": [],
    }
