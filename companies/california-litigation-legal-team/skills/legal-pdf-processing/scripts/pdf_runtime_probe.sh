#!/usr/bin/env sh
set -eu

# Read-only capability probe. It intentionally does not inspect PDFs or install tools.
probe() {
  label=$1
  command_name=$2
  if command -v "$command_name" >/dev/null 2>&1; then
    case "$command_name" in
      pdfinfo|pdftoppm) version=$($command_name -v 2>&1 | sed -n '1p' | tr '\n' ' ') ;;
      codex) version='installed (version probe skipped)' ;;
      *) version=$($command_name --version 2>&1 | sed -n '1p' | tr '\n' ' ') ;;
    esac
    printf '%-16s available  %s\n' "$label" "${version:-version unavailable}"
  else
    printf '%-16s missing\n' "$label"
  fi
}

printf '%s\n' 'PDF runtime capabilities (read-only probe)'
probe 'python' python
probe 'python3' python3
probe 'pdftotext' pdftotext
probe 'pdfinfo' pdfinfo
probe 'mutool' mutool
probe 'qpdf' qpdf
probe 'ocrmypdf' ocrmypdf
probe 'tesseract' tesseract
probe 'pdftoppm' pdftoppm
probe 'magick' magick
probe 'docling' docling
probe 'codex' codex

python_command=''
if command -v python >/dev/null 2>&1; then
  python_command=python
elif command -v python3 >/dev/null 2>&1; then
  python_command=python3
fi

if [ -n "$python_command" ]; then
  "$python_command" - <<'PY'
try:
    import pypdf
    print("python:pypdf      available")
except Exception:
    print("python:pypdf      missing")
try:
    import fitz
    print("python:PyMuPDF    available")
except Exception:
    print("python:PyMuPDF    missing")
PY
fi
