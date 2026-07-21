---
schema: agentcompanies/v1
slug: legal-pdf-processing
name: legal-pdf-processing
description: Process approved legal PDFs through a local-first, page-complete extraction pipeline that selects available text, OCR, layout, and vision tools by need. Keep originals immutable, checkpoint large jobs, and use remote services only when explicitly configured and approved.
---

# legal-pdf-processing

*How the California Litigation Legal Team turns large, mixed, or scanned PDFs into page-stable sidecars without assuming one vendor or one machine.*

## When to load this skill

- A scoped issue approves PDF inspection, text extraction, OCR, layout recovery, or extraction QA.
- A source set contains clean text PDFs, image-only scans, mixed-quality pages, rotated pages, handwriting, redactions, or hundreds/thousands of pages.
- A downstream legal workflow needs page-stable sidecars and a coverage manifest.

This is a capability router, not a Docling requirement. Use the fastest approved local backend that is actually installed. Docling, Azure Document Intelligence, and vision models are optional escalation paths.

## Inputs

Before processing begins, confirm the issue states:

- Matter root and output root.
- Exact PDFs or read-only source roots to process.
- Forbidden roots and no-cross-matter inspection rule.
- Allowed outputs, such as page Markdown, JSON, OCR text, manifests, page images for QA, and extraction notes.
- Available local tools and versions, discovered with `scripts/pdf_runtime_probe.sh` or an equivalent deployment probe.
- Whether remote OCR or vision processing is approved. Uploading source or derived content is always an explicit hard gate.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, learning mode, and any visible hard-gate approvals already granted.

If a path, output boundary, or processing approval is missing, do not start extraction. If a stronger backend is unavailable, run only the stages that are already approved and available, then preserve the incomplete manifest state. Inputs are approved local PDFs or scanned documents only.

Apply `legal-matter-intake/references/human-approval-gates.md`: local PDF/OCR sidecars under `{output_root}` are green, but remote upload/processing, authentication, and protected mutation remain hard gates.

## Procedure

1. **Confirm scope first.** Identify the exact PDFs or read-only source roots, `{output_root}`, forbidden roots, allowed sidecars, page-order rules, and approved processing stages.
2. **Probe before configuring.** Run `sh scripts/pdf_runtime_probe.sh` and record available local capabilities. Do not install a large stack merely because the skill was loaded.
3. **Choose the smallest sufficient local path per document.**
   - Embedded text: `pdftotext`, `mutool`, `pypdf`, `PyMuPDF`, or another installed extractor, with page markers.
   - Image-only or rejected pages: local `ocrmypdf`/Tesseract, or a deployment-approved page renderer plus Tesseract, writing only sidecars under `{output_root}`.
   - Complex layout, tables, or forms: use an installed Docling, PyMuPDF, or equivalent layout backend only for the pages that need it.
   - Low-confidence or handwriting review: render only flagged pages and use an approved vision backend only after its remote-processing gate is approved.
4. **Batch and checkpoint large jobs.** Process pages or bounded batches in parallel when the selected local tool supports it. Persist a manifest, per-page status, retry count, and coverage report so an interrupted 1,000-page job resumes instead of restarting.
5. **Use the optional three-stage reference pipeline when its dependencies are available.** Its repo-local path is `references/three_stage_pdf_pipeline.py`; it can prepare direct-text pages, route rejected pages to configured OCR, build a vision queue, and finalize only complete coverage:
   ```sh
   python references/three_stage_pdf_pipeline.py prepare input.pdf --output output/pipeline
   # Run only the configured local or remote stages approved on the issue.
   python references/three_stage_pdf_pipeline.py run-azure --pipeline output/pipeline
   python references/three_stage_pdf_pipeline.py build-llm-queue --pipeline output/pipeline
   python references/three_stage_pdf_pipeline.py run-llm-batched --pipeline output/pipeline --model <approved-model>
   python references/three_stage_pdf_pipeline.py finalize --pipeline output/pipeline
   ```
   Treat `run-azure` and `run-llm*` as optional gated stages, not prerequisites for local extraction. Use `run-llm` instead of `run-llm-batched` only when single-page processing is preferred.
6. **Apply quality checks.** Reject pages with empty or obviously corrupted text, preserve page markers, record blank/image-only pages, and route low-confidence pages for a stronger backend. Use the reference script's thresholds when that script is selected:
   - Direct text is rejected below 500 characters, 75 words, 0.50 alpha-token fraction, or above 0.05 suspicious-token fraction.
   - Azure pages are routed to vision review when mean confidence is below 0.93, p10 confidence is below 0.75, more than 12% of words are below 0.80 confidence, there are no confident words, or extracted text is below 50 characters.
   - Script defaults: Azure batch size `200`, rendered image size `2400`, batched vision workers `3`, batch size `4`, max attempts `3`, and timeout `1200` seconds for batched vision.
7. **Reuse checkpoints.** Preserve the complete output tree under `{output_root}` and continue from the manifest after interruption. Do not silently accept missing pages.
8. **Stop at hard gates before** installing dependencies, changing runtime configuration, uploading source or derived content, authenticating external tools, or mutating source PDFs. If a stronger backend is unavailable, preserve the incomplete manifest and report the exact next capability needed.
9. **Validate coverage.** Require `final_coverage_report.json` or the equivalent manifest to show complete page coverage before downstream agents treat the assembled Markdown as complete.

## Outputs

- Derived sidecars only: Markdown, JSON, OCR text, manifests, page-render QA, queue files, logs, coverage reports, and extraction notes under `{output_root}`.
- Expected output layout includes `manifest.json`, stage-specific page sidecars, `stage3_llm/queue.json` when visual review is needed, `final_coverage_report.json`, and final `document.md`.
- Keep the manifest as the routing and audit source.
- Preserve `<!-- source-page: N -->` comments in page sidecars and final Markdown.
- Keep raw remote responses, rendered page images, backend logs, and run summaries under `{output_root}` unless the issue narrows allowed outputs.
- Treat derived text as work product; legal citations and evidence references must remain tied to source PDFs and stable page references.

## Anti-patterns

- Assuming Docling, Azure, Tesseract, Poppler, or Codex exists without probing.
- Running a hardcoded machine path instead of the repo-local or issue-supplied script path.
- Installing dependencies, changing runtime configuration, or uploading source/derived content without prior approval.
- Modifying, splitting, merging, renaming, deleting, or overwriting source PDFs.
- Processing outside the approved matter/source scope, or relying on hidden memory or machine-specific paths.
- Silently accepting missing pages or treating derived text as a replacement for source evidence.
- Rewriting legal language from memory during vision correction. The page image is authoritative; extracted text is only a draft.

## Reference

- `references/three_stage_pdf_pipeline.py`: optional direct-text, OCR, and vision correction pipeline reference.
- `references/layout-output-format.md`: generic page-complete sidecar/manifest output format for layout-capable backends.
- `scripts/pdf_runtime_probe.sh`: read-only local capability probe; it does not install tools or inspect source documents.
- `scripts/ocr_pdf_intake.ps1`: optional scoped local OCR helper; review trust and exact paths before execution.
