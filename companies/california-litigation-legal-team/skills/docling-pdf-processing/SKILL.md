---
name: three-stage-pdf-processing
description: Use when a Paperclip PDF/OCR agent must convert approved PDFs or scanned legal documents into page-complete sidecar Markdown, JSON manifests, Azure OCR outputs, vision-corrected pages, and extraction QA using the three-stage PDF pipeline script. Do not use to modify originals, process unscoped matter files, install tools without approval, upload source material without approval, or treat derived text as a replacement for source evidence.
---

# Three-Stage PDF Processing

## Paperclip Role

Any agent may use this skill for a scoped issue that approves PDF extraction work. The skill is centered on `references/three_stage_pdf_pipeline.py`; treat that script as the source of truth. Script location, Azure endpoint/key, Codex model choice, and output paths must come from issue instructions, environment variables, or deployment configuration.

## Required Issue Contract

Before processing begins, confirm the issue states:

- Matter root and output root.
- Exact PDFs or read-only source roots to process.
- Forbidden roots and no-cross-matter inspection rule.
- Allowed outputs, such as page Markdown, JSON, OCR text, manifests, page images for QA, and extraction notes.
- Tool configuration for `{pdf_pipeline_script}`, Python with `pypdf`, Azure Document Intelligence settings, authenticated Codex CLI, and the approved vision model.
- Whether remote OCR or vision processing is approved. Azure Document Intelligence uploads PDF batches, and Codex vision correction sends rendered page images plus Azure draft text to the configured model.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, learning mode, and red gates already approved.

If a path, output boundary, or remote-processing approval is missing, do not start extraction. If Azure or Codex is unavailable, run only the stages that are already approved and available, then preserve the incomplete stage and current manifest state.

## Preferred Page-Complete Pipeline

When the issue approves the required runtimes, use `references/three_stage_pdf_pipeline.py` for scanned or mixed-quality PDFs:

1. Stage 1 uses `pypdf` to accept coherent embedded PDF text page-by-page.
2. Stage 2 sends only rejected pages to Azure Document Intelligence `prebuilt-layout` API version `2024-11-30` and stores raw JSON, Markdown, and confidence metrics.
3. Stage 3 renders low-confidence Azure pages with `qlmanage`, then uses Codex CLI for vision-LLM correction.
4. Finalize assembles `document.md` only if every expected source page has an accepted sidecar.

Default quality thresholds from the reference script:

- Direct text is rejected below 500 characters, 75 words, 0.50 alpha-token fraction, or above 0.05 suspicious-token fraction.
- Azure pages are routed to vision review when mean confidence is below 0.93, p10 confidence is below 0.75, more than 12% of words are below 0.80 confidence, there are no confident words, or extracted text is below 50 characters.
- The final coverage report must show `complete: true` before downstream agents use the assembled Markdown.

## Reference Pipeline Commands

Use the repo-local script path or an issue-supplied script path. Do not run a hardcoded machine path from prior work.

```sh
python references/three_stage_pdf_pipeline.py prepare input.pdf --output output/pipeline
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=... \
AZURE_DOCUMENT_INTELLIGENCE_KEY=... \
  python references/three_stage_pdf_pipeline.py run-azure --pipeline output/pipeline
python references/three_stage_pdf_pipeline.py build-llm-queue --pipeline output/pipeline
python references/three_stage_pdf_pipeline.py run-llm-batched --pipeline output/pipeline --model <approved-model>
python references/three_stage_pdf_pipeline.py finalize --pipeline output/pipeline
```

Use `run-llm` instead of `run-llm-batched` only when single-page processing is preferred. The script defaults to Azure batch size `200`, rendered image size `2400`, batched vision workers `3`, batch size `4`, max attempts `3`, and timeout `1200` seconds for batched vision.

Expected output layout includes `manifest.json`, stage-specific page sidecars, `stage3_llm/queue.json` when visual review is needed, `final_coverage_report.json`, and final `document.md`.

## Pipeline Workflow

1. Confirm source PDF paths, output root, and approved pipeline stages.
2. Check that Python can import `pypdf`.
3. For `run-azure`, confirm `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` and `AZURE_DOCUMENT_INTELLIGENCE_KEY` are set.
4. For `build-llm-queue`, confirm `qlmanage` is available.
5. For `run-llm` or `run-llm-batched`, confirm Codex CLI is installed and authenticated.
6. Run only the approved stages, in script order.
7. Reuse existing checkpoint outputs when the script detects them.
8. Keep the complete pipeline output tree under `{output_root}`.
9. Validate `final_coverage_report.json` before treating extraction as complete.

## Runtime Boundaries

Do not install dependencies, configure Azure or Codex, change runtime configuration, or upload source or derived content unless those actions are already approved for the task.

If Azure or Codex is unavailable, stop before the unavailable stage and preserve the current `manifest.json` plus completed stage outputs for later continuation.

Red-gate approval is required before:

- Installing Python dependencies, configuring Azure or Codex, or changing runtime configuration.
- Uploading source or derived content to Azure, Codex vision models, or any external service.
- Modifying, splitting, merging, renaming, deleting, or overwriting source PDFs.
- Processing outside the approved matter/source scope.

## Inputs And Outputs

Inputs are approved local PDFs or scanned documents. Outputs are derived sidecars only: Markdown, JSON, OCR text, manifests, page-render QA, queue files, logs, coverage reports, and extraction notes under `{output_root}`.

## Tool Policy

Use a configured approved runtime. Prefer environment variables or issue-supplied paths over machine-specific paths. Treat derived text as work product; legal citations and evidence references must remain tied to source PDFs and stable page references.

When using the reference pipeline:

- Keep `manifest.json` as the routing and audit source.
- Preserve `<!-- source-page: N -->` comments in page sidecars and final Markdown.
- Keep raw Azure responses, page images, Codex logs, and run summaries under `{output_root}` unless the issue narrows allowed outputs.
- Never silently accept missing pages. Fix or escalate incomplete coverage.
- Do not rewrite legal language from memory during vision correction. The page image is authoritative; Azure text is only a draft.

## Reference Files

- `references/three_stage_pdf_pipeline.py`: concrete three-stage direct text, Azure OCR, and vision correction pipeline reference.
