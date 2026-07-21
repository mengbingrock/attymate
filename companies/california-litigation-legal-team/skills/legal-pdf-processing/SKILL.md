---
schema: agentcompanies/v1
slug: legal-pdf-processing
name: legal-pdf-processing
description: Process approved legal PDFs through a local-first, page-complete extraction pipeline that chooses available text, OCR, layout, and optional vision tools by document need.
---

# legal-pdf-processing

*Turn large, mixed, or scanned legal PDFs into page-stable work product without assuming one vendor or machine.*

## Use

Load for clean-text PDFs, image-only scans, mixed or rotated pages, tables/forms, handwriting, redactions, or hundreds/thousands of pages that need resumable extraction.

## Inputs

Use the parent Matter Authorization Package and focused child work order to identify exact source PDFs, output root, allowed sidecars, source/page-order rules, remote-processing authority, and completion standard.

## Procedure

1. Preserve source PDFs as immutable evidence.
2. Run `scripts/pdf_runtime_probe.sh` and choose the smallest sufficient installed local backend; do not install a stack merely because the skill loaded.
3. Route by page/document need:
   - embedded text: an installed text extractor with stable page markers;
   - image-only or rejected pages: local OCRmyPDF/Tesseract or equivalent;
   - complex tables/forms/layout: an installed layout-capable backend only for affected pages;
   - handwriting or persistently low-confidence pages: flagged visual review, with remote vision only when external processing is expressly authorized.
4. Batch large jobs and persist per-page status, retry count, method, and coverage so interrupted work resumes instead of restarting.
5. Reject empty/corrupt text, preserve blank/image-only page records, and escalate only affected pages to a stronger backend.
6. Require complete page coverage, or explicitly identify incomplete pages, before downstream agents treat the text as complete.
7. Keep page-level manifests, backend/tool detail, retry logs, rendered QA images, and raw responses in the internal PDF work product.
8. Hand off a concise attorney-facing coverage result using `references/layout-output-format.md` only when coverage or an exception materially affects legal review.

## Optional Reference Pipeline

`references/three_stage_pdf_pipeline.py` is an optional direct-text, OCR, and vision-review implementation. Use only stages available and authorized in the deployment. Azure/LLM stages are not prerequisites for local extraction.

## Authorization And Interruptions

Local extraction/OCR/layout work and derived sidecars under the output root proceed under parent authority. Remote upload/processing or external sharing requires an attorney decision because source content leaves the approved environment. Missing binaries, model setup, login/MFA, or runtime configuration are operational interruptions for Legal Ops/tool owner; continue all available local stages.

## Outputs

- Internal manifest, page sidecars, extraction/OCR text, coverage report, and logs.
- Page markers such as `<!-- source-page: N -->` in derived text.
- One concise PDF coverage handoff identifying reviewed pages, usable coverage, material exceptions, legal-review effect, and next owner.

## Limits

- Do not modify, split, merge, rename, delete, or overwrite source PDFs.
- Do not silently accept missing pages or treat OCR text as superior to the page image.
- Do not upload source/derived content or expand source scope without the required decision.
- Do not expose backend, pipeline, manifest, or retry narration in lawyer-facing comments/results.

## References

- `references/legal-pdf-intake.md`
- `references/layout-output-format.md`
- `references/three_stage_pdf_pipeline.py`
- `scripts/pdf_runtime_probe.sh`
- `scripts/ocr_pdf_intake.ps1`
