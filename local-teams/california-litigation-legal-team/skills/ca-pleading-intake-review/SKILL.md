---
schema: agentcompanies/v1
slug: ca-pleading-intake-review
name: ca-pleading-intake-review
description: Perform source-bound California pleading intake and review, including caption, parties, filing/service facts, material allegations, signature/verification, and usable text coverage.
---

# ca-pleading-intake-review

## Procedure

1. Confirm the approved pleading set and focused child work order under the parent package.
2. Inventory documents internally and assess page/text quality.
3. Use `legal-pdf-processing` when OCR or layout recovery is needed; preserve originals.
4. Extract caption/party, filing/service, verification/signature, material allegation/denial, and procedural facts with stable source references.
5. Separate confirmed facts from gaps or inference.
6. Produce one intake artifact using `references/intake-output-format.md` and hand relevant facts directly to downstream agents when authorized.

## Authorization

Approved-source review, local OCR, derived sidecars, internal indexes, and handoffs proceed under parent authority. Remote upload/processing, expanded sources, paid retrieval, protected mutation, or external action follows the canonical matrix.

## Communication

Tell the lawyer what pleading was reviewed, what materially matters, what cannot yet be relied on, and the next action. Keep manifests, extraction details, tool output, and package fields internal.

## Limits

Do not alter originals, inspect another matter, draft argument beyond intake, invent missing text, or take external actions.
