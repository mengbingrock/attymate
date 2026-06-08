---
name: ca-subpoena-mtc-drafting-workflow
description: Draft, revise, organize, and QA California subpoena motion-to-compel work product using source-bound artifacts, section confirmation, Word safety, and supplied-authority discipline.
---

# California Subpoena MTC Drafting Workflow For Paperclip

## Paperclip Role

Use this skill from Legal Ops Supervisor, Facts & Evidence Agent, Legal Research Agent, Drafting & Assembly Agent, Source Intake Agent, or Legal QA Agent when a scoped Paperclip issue involves California subpoena motion-to-compel drafting or QA.

Use this Paperclip-native wrapper as the runtime authority for drafting standards, OCR intake, intermediary artifacts, Word editing after confirmation, live change logs, deliverable templates, and subpoena MTC checklists. It is adapted from reusable workflow rules and contains no client facts, firm templates, private account details, or hardcoded paths.

## Required Issue Contract

Before drafting begins, confirm the issue states the Matter Safety Contract fields: workflow type, autonomy level, Firm Operations Guide reference or scoped excerpt, matter root, output root, read-only source roots, forbidden roots, allowed outputs, learning mode, do-not-learn list, authority limits, and red gates already approved.

If the issue lacks matter root, output root, approved source roots, no-cross-matter scope, or Firm Operations Guide reference, return the missing-field list to Legal Ops Supervisor. If those fields are present, continue green source-bound work and log unresolved inputs instead of repeatedly blocking.

## Drafting Rules

- Start with document intake and OCR assessment.
- Before drafting, check approved output/intermediary sources for upstream subpoena document-review handoff artifacts, including any downstream MTC handoff memo, completeness table, usefulness table, custodian-affidavit notes, and potential additional-subpoena notes.
- Preserve original PDF page order; OCR must be sidecar work product.
- Build intermediary work before major drafting: document index, exhibit list, objection table, replacement table, needed inputs, TOC, TOA, and factual narrative.
- Draft sections from source materials and approved examples, one reviewable section or artifact at a time.
- Proceed autonomously with green work: source-bound draft text, tables, outlines, QA notes, replacement tables, and new artifacts under the approved output root.
- Do not insert into active Word drafts unless the applicable red-gate approval is satisfied.
- Maintain a live change log for confirmed updates.
- Use only supplied, workspace, example-shell, authority-table, or approved-Lexis authorities.
- Track placeholders, unresolved citations, stale shell terms, and missing page/line citations.
- Route yellow issues to Legal Ops Supervisor, but do not stop safe drafting while approved source-bound work remains.

## Approval Gates

Red-gate approval is required before external research, new authorities, external uploads or downloads, external knowledge-base/upload systems, browser auth, paid retrieval, calendar writes, email, active Word writes, finalization, filing, service, signing, overwriting, deleting, renaming, source mutation, strategy changes, relief changes, sanctions changes, privacy treatment, protective-order changes, or selecting between conflicting controlling drafts.

Approval for one red-gate action does not authorize any other red-gate action.

## Heartbeat Workflow

1. Checkout the assigned issue, parent issue, Matter Safety Contract, Firm Operations Guide excerpt, and approved source roots.
2. Confirm whether upstream subpoena document-review artifacts exist before creating a drafting outline.
3. Build or update intermediary tables: source index, exhibit list, objection table, replacement table, factual narrative, authority table, needed-input list, TOC, and TOA.
4. Draft source-bound sections under `{output_root}` and identify the evidence, objection, authority, and declaration support for each section.
5. Request approval only for red gates, including external research, new authorities, active Word writes, finalization, filing, service, email, source renaming, deletion, overwrite, or strategy/relief/sanctions/privacy changes.
6. Post artifact paths, change log, unresolved placeholders, and QA risks.

## Inputs And Outputs

Inputs may include subpoena materials, objections, meet-and-confer records, productions, declarations, pleadings, exhibits, approved authorities, approved example shells, and upstream document-review artifacts.

Outputs must be new artifacts under `{output_root}`: OCR sidecars, source indexes, exhibit/RJN lists, objection tables, replacement tables, factual narratives, draft sections, TOC/TOA drafts, proposed order text, declaration text, QA notes, and new working-copy documents only when approved.

## Tool Policy

Use local OCR/PDF tools only within the approved matter/output scope. The optional OCR helper in `scripts/ocr_pdf_intake.ps1` writes only under the approved output root and is never a substitute for source review. Use Word/document tools only for new working copies or approved active-draft updates. Use legal research tools only after a red-gate approval for external research or new authorities.

## Handoff Rules

Return narrow yellow issues to Legal Ops Supervisor when source scope, routing, or internal assumptions need repair. Stop for red gates only when no safe source-bound drafting remains. Mark done only after posting the draft artifacts, live change log or change-log update, unresolved-input list, and QA risks.

## Reference Files

- `references/pdf-ocr-intake.md`: PDF intake, OCR sidecar, and optional script rules.
- `references/workspace-setup.md`: matter workspace and output conventions.
- `references/intermediary-work-product.md`: numbered artifacts and drafting support tables.
- `references/drafting-sequence.md`: MTC package drafting order.
- `references/word-editing-protocol.md`: Word working-copy and active-draft safety.
- `references/live-draft-change-log.md`: change-log requirements.
- `references/subpoena-mtc-checklists.md`: MTC issue, evidence, and QA checklists.
- `references/deliverable-templates.md`: generic table and work-product formats.
- `scripts/ocr_pdf_intake.ps1`: optional scoped local OCR helper; executable-script trust review required before use.
