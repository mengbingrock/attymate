---
schema: agentcompanies/v1
slug: legal-document-intake
name: Legal Document Intake
description: Make approved legal documents reviewable at scale by establishing page-complete, source-linked text and identifying exceptions that affect legal reliance.
aliases:
  - legal-pdf-processing
---

# Legal Document Intake

## Business Purpose

Turn large, scanned, mixed-quality, or image-only legal documents into a reliable review set without altering the evidentiary originals.

## Use When

- A document is not readily searchable or readable.
- A production, record, transcript, exhibit set, or court filing contains hundreds or thousands of pages.
- Tables, forms, handwriting, rotation, redaction, or mixed text quality may affect review.
- Another legal capability needs stable page-linked text.

This capability serves every legal workstream; it is not limited to motion practice.

## Required Inputs

- The exact documents authorized for review.
- The Matter and legal purpose for which the documents are needed.
- The expected page count or other available completeness indicator.
- The permitted destination for derived working material.
- Whether any content may leave the approved environment.

## Professional Work

1. Preserve each source document unchanged and distinguish originals from derived working material.
2. Account for every source file and every page in source order.
3. Establish usable text and layout information appropriate to the document's legal purpose.
4. Keep stable source and page references so a reviewer can return to the original page.
5. Identify blank, unreadable, handwritten, damaged, redacted, duplicated, or otherwise uncertain pages.
6. Check the resulting review set for page coverage, legibility, ordering, and representative accuracy.
7. State which exceptions prevent or limit reliable legal review.

The deployment decides how document capabilities are provided. The lawyer should not be asked to choose implementation methods.

## Attorney Deliverable

Use `references/document-intake-output-format.md` to report:

- Documents and pages reviewed.
- Usable coverage and whether page order is preserved.
- Only the exceptions that affect legal analysis or completeness.
- The practical effect of each material exception.
- The recommended next reviewer or legal workstream.

## Completion Standard

Document intake is complete when every authorized page is either reviewable with a stable source reference or specifically identified as an exception with its legal effect.

## Material Decisions

Remote processing, external sharing, additional sources, paid retrieval, or changes to original/final/filed/signed material require the applicable attorney decision. Approved internal preparation of derived working material does not.

## Handoff

Provide downstream reviewers with the source-linked review set and material exception list. Keep implementation details, diagnostics, and retry history in operational records.
