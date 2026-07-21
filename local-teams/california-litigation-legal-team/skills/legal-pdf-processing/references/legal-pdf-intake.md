# PDF And OCR Intake

Use this reference for legal source PDFs, including productions, correspondence, declarations, pleadings, exhibits, and other court or client materials.

- Inspect only approved source roots.
- Preserve original PDF order, filenames, and content.
- Create OCR and text sidecars only under `{output_root}`.
- Use page-stable text markers so draft citations can be checked.
- Note blank pages, image-only pages, handwriting, redactions, rotated pages, and low-confidence extraction.
- Keep source PDFs as the citation authority when OCR conflicts with the PDF image.
- Do not rename evidence files to impose exhibit numbers; number intermediary artifacts instead.
- Load `legal-pdf-processing` for capability discovery and local-first backend selection. Use the smallest sufficient local tool for each document or rejected page; do not assume Docling, Azure, or a vision model is installed.
- For hundreds or thousands of pages, use bounded batches and a resumable manifest. Do not restart a completed batch after an interruption.
- Local runtime discovery and approved environment setup are Operational work. Uploading client material to remote OCR/vision or sharing it externally requires an Attorney Decision; permitted source downloads within scope do not.

The optional `scripts/ocr_pdf_intake.ps1` helper may be used only when the issue approves local OCR sidecars and supplies exact matter/output paths. It writes under `{output_root}/OCR` and does not modify source PDFs. Prefer the portable capability probe at `skills/legal-pdf-processing/scripts/pdf_runtime_probe.sh` before choosing a backend.
