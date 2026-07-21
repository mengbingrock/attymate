# PDF And OCR Intake

Use this reference for subpoena materials, productions, objections, meet-and-confer letters, declarations, pleadings, and exhibits.

- Inspect only approved source roots.
- Preserve original PDF order, filenames, and content.
- Create OCR and text sidecars only under `{output_root}`.
- Use page-stable text markers so draft citations can be checked.
- Note blank pages, image-only pages, handwriting, redactions, rotated pages, and low-confidence extraction.
- Keep source PDFs as the citation authority when OCR conflicts with the PDF image.
- Do not rename evidence files to impose exhibit numbers; number intermediary artifacts instead.

The optional `scripts/ocr_pdf_intake.ps1` helper may be used only when the task approves local OCR sidecars and supplies exact matter/output paths. It writes under `{output_root}/OCR` and does not modify source PDFs.
