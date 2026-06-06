---
name: docling-pdf-processing
description: Use when a Paperclip PDF/OCR agent must convert approved PDFs or scanned documents into sidecar Markdown, JSON, OCR text, source manifests, or extraction QA using Docling or another configured local PDF runtime. Do not use to modify originals, process unscoped matter files, install tools without approval, or treat derived text as a replacement for source evidence.
---

# Docling PDF Processing

## Paperclip Role

Use this skill from the Source Intake Agent or another scoped intake child issue. The skill is deployment-safe and avoids hardcoded local paths. Tool locations must come from issue instructions, environment variables, or deployment configuration.

## Required Issue Contract

Before processing begins, confirm the issue states:

- Matter root and output root.
- Exact PDFs or read-only source roots to process.
- Forbidden roots and no-cross-matter inspection rule.
- Allowed outputs, such as Docling Markdown, JSON, OCR text, manifests, and QA notes.
- Tool configuration, such as `{docling_runtime}` or an approved setup command.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, learning mode, and red gates already approved.

If a path or output boundary is missing, return a concise missing-field list to the supervisor. If the local runtime is missing, record the tool gap and continue with non-OCR manifest or extraction QA work when useful.

## Heartbeat Workflow

1. Checkout the assigned issue.
2. Confirm source and output boundaries.
3. Check whether the approved Docling runtime exists.
4. If setup, install, or model download is required, record the gap and request approval before that red-gate action.
5. Process only the approved files.
6. Write sidecar outputs under `{output_root}`.
7. Post a manifest, extraction-quality notes, and files created.

## Checkpoint Policy

Proceed autonomously with green work: processing approved files with an already-configured local runtime, writing sidecars under `{output_root}`, and posting extraction-quality notes.

Route yellow issues to Legal Ops Supervisor when runtime configuration is unclear or extraction quality affects downstream work.

Red-gate approval is required before:

- Installing Docling, downloading models, or changing runtime configuration.
- Uploading source or derived content.
- Modifying, splitting, merging, renaming, deleting, or overwriting source PDFs.
- Processing outside the approved matter/source scope.

## Inputs And Outputs

Inputs are approved local PDFs or scanned documents. Outputs are derived sidecars only: Markdown, JSON, OCR text, manifests, page-render QA, and extraction notes under `{output_root}`.

## Tool Policy

Use a configured local runtime. Prefer environment variables or issue-supplied paths over machine-specific paths. Treat derived text as work product; legal citations and evidence references must remain tied to source PDFs and stable page references.

## Handoff Rules

Return discrete yellow/red issues to the supervisor, but continue safe manifest or QA work when possible.

## Reference Files

- `references/docling-output-format.md`: generic conversion manifest format.
