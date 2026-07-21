---
name: docling-pdf-processing
description: Use when a pi PDF/OCR agent must convert approved PDFs or scanned legal documents into page-complete sidecar Markdown, JSON manifests, Azure OCR outputs, vision-corrected pages, and extraction QA using the three-stage PDF pipeline script. Do not use to modify originals, process unscoped matter files, install tools without approval, upload source material without approval, or treat derived text as a replacement for source evidence.
---

# docling-pdf-processing

*How the California Litigation Legal Team turns approved PDFs into page-complete sidecar Markdown — source-bound and supervised.*

## When to load this skill

- Working a scoped task that approves PDF extraction work.
- Converting approved PDFs or scanned legal documents into page-complete sidecar Markdown, JSON manifests, Azure OCR outputs, vision-corrected pages, and extraction QA.
- The skill is centered on `references/three_stage_pdf_pipeline.py`; treat that script as the source of truth. Script location, Azure endpoint/key, pi model choice, and output paths must come from task instructions, environment variables, or deployment configuration.

## Inputs

Before processing begins, confirm the task states:

- Matter root and output root.
- Exact PDFs or read-only source roots to process.
- Forbidden roots and no-cross-matter inspection rule.
- Allowed outputs, such as page Markdown, JSON, OCR text, manifests, page images for QA, and extraction notes.
- Tool configuration for `{pdf_pipeline_script}`, Python with `pypdf`, Azure Document Intelligence settings, authenticated pi CLI, and the approved vision model.
- Whether remote OCR or vision processing is approved. Azure Document Intelligence uploads PDF batches, and pi vision correction sends rendered page images plus Azure draft text to the configured model.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, learning mode, and any visible hard-gate approvals already granted.

If a path, output boundary, or remote-processing approval is missing, do not start extraction. If Azure or pi is unavailable, run only the stages that are already approved and available, then preserve the incomplete stage and current manifest state. Inputs are approved local PDFs or scanned documents only.

Apply `ca-subpoena-mtc-autonomous-runner/references/human-approval-gates.md` in both standard and `sandbox_autopilot` modes: local PDF/OCR sidecars under `{output_root}` are green, but Azure, pi vision, or any external upload/remote processing remains a hard gate unless separately approved.

## Procedure

1. **Confirm source PDF paths, output root, and approved pipeline stages.**
2. **Check that Python can import `pypdf`.**
3. **Before `run-azure`, confirm** `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` and `AZURE_DOCUMENT_INTELLIGENCE_KEY` are set.
4. **Before `build-llm-queue`, confirm** `qlmanage` is available.
5. **Before `run-llm` or `run-llm-batched`, confirm** pi CLI is installed and authenticated.
6. **Run only the approved stages, in script order,** using the repo-local script path or an task-supplied script path. Do not run a hardcoded machine path from prior work.
   ```sh
   python references/three_stage_pdf_pipeline.py prepare input.pdf --output output/pipeline
   AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=... \
   AZURE_DOCUMENT_INTELLIGENCE_KEY=... \
     python references/three_stage_pdf_pipeline.py run-azure --pipeline output/pipeline
   python references/three_stage_pdf_pipeline.py build-llm-queue --pipeline output/pipeline
   python references/three_stage_pdf_pipeline.py run-llm-batched --pipeline output/pipeline --model <approved-model>
   python references/three_stage_pdf_pipeline.py finalize --pipeline output/pipeline
   ```
   The page-complete pipeline for scanned or mixed-quality PDFs runs in stages: Stage 1 uses `pypdf` to accept coherent embedded PDF text page-by-page; Stage 2 sends only rejected pages to Azure Document Intelligence `prebuilt-layout` API version `2024-11-30` and stores raw JSON, Markdown, and confidence metrics; Stage 3 renders low-confidence Azure pages with `qlmanage`, then uses pi CLI for vision-LLM correction; finalize assembles `document.md` only if every expected source page has an accepted sidecar. Use `run-llm` instead of `run-llm-batched` only when single-page processing is preferred.
7. **Honor the default quality thresholds** from the reference script:
   - Direct text is rejected below 500 characters, 75 words, 0.50 alpha-token fraction, or above 0.05 suspicious-token fraction.
   - Azure pages are routed to vision review when mean confidence is below 0.93, p10 confidence is below 0.75, more than 12% of words are below 0.80 confidence, there are no confident words, or extracted text is below 50 characters.
   - Script defaults: Azure batch size `200`, rendered image size `2400`, batched vision workers `3`, batch size `4`, max attempts `3`, and timeout `1200` seconds for batched vision.
8. **Reuse existing checkpoint outputs** when the script detects them. Keep the complete pipeline output tree under `{output_root}`.
9. **Stop at hard gates before any of these** — request approval first:
   - Installing Python dependencies, configuring Azure or pi, or changing runtime configuration.
   - Uploading source or derived content to Azure, pi vision models, or any external service.
   - Modifying, splitting, merging, renaming, deleting, or overwriting source PDFs.
   - Processing outside the approved matter/source scope.

   If Azure or pi is unavailable, stop before the unavailable stage and preserve the current `manifest.json` plus completed stage outputs for later continuation.
10. **Validate `final_coverage_report.json`** before treating extraction as complete. The coverage report must show `complete: true` before downstream agents use the assembled Markdown.

## Outputs

- Derived sidecars only: Markdown, JSON, OCR text, manifests, page-render QA, queue files, logs, coverage reports, and extraction notes under `{output_root}`.
- Expected output layout includes `manifest.json`, stage-specific page sidecars, `stage3_llm/queue.json` when visual review is needed, `final_coverage_report.json`, and final `document.md`.
- Keep `manifest.json` as the routing and audit source.
- Preserve `<!-- source-page: N -->` comments in page sidecars and final Markdown.
- Keep raw Azure responses, page images, pi logs, and run summaries under `{output_root}` unless the task narrows allowed outputs.
- Treat derived text as work product; legal citations and evidence references must remain tied to source PDFs and stable page references.

## Anti-patterns

- Running a hardcoded machine path instead of the repo-local or task-supplied script path.
- Installing dependencies, configuring Azure or pi, changing runtime configuration, or uploading source/derived content without prior approval.
- Modifying, splitting, merging, renaming, deleting, or overwriting source PDFs.
- Processing outside the approved matter/source scope, or relying on hidden memory or machine-specific paths.
- Silently accepting missing pages — fix or escalate incomplete coverage.
- Rewriting legal language from memory during vision correction. The page image is authoritative; Azure text is only a draft.
- Treating derived text as a replacement for source evidence, or using assembled Markdown before `complete: true`.

## Reference

- `references/three_stage_pdf_pipeline.py`: concrete three-stage direct text, Azure OCR, and vision correction pipeline reference.
- `references/docling-output-format.md`: generic page-complete sidecar/manifest output format.
