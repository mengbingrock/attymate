---
schema: agentcompanies/v1
slug: ca-litigation-drafting-workflow
name: ca-litigation-drafting-workflow
description: Use when a drafting or QA agent must draft, revise, organize, or review California litigation work product, including pleadings, motions, memoranda, declarations, meet-and-confer letters, proposed orders, source indexes, issue tables, and Word working-copy updates. Do not use to insert unapproved authorities, overwrite user-edited files, finalize, sign, file, serve, or email.
---

# ca-litigation-drafting-workflow

*How the California Litigation Legal Team drafts, revises, and reviews litigation work product — source-bound and supervised.*

## When to load this skill

- Working from the Drafting & Assembly Agent, Legal QA Agent, Facts & Evidence Agent, Source Intake Agent, or a supervisor-delegated drafting child issue.
- Drafting or revising pleadings, motions, memoranda, declarations, meet-and-confer letters, or proposed orders.
- Building or reviewing source indexes, issue tables, QA notes, or Word working-copy updates.
- The skill is reusable for California litigation and contains no client facts, firm templates, private style rules, or hardcoded paths.

## Inputs

Before drafting begins, confirm the issue states:

- Matter root and output root.
- Read-only source roots, including any pleadings, exhibits, authorities, examples, or prior drafts that may be inspected.
- Forbidden roots, including other matters and final/signed/filed/served/user-edited documents unless expressly approved.
- Allowed outputs, such as new draft sections, tables, QA notes, or new working-copy documents.
- Authority source limits.
- Drafting profile or style policy, if deployment-specific style is required.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, learning mode, and any visible hard-gate approvals already granted.

If scope, source, or output boundaries are missing, return the missing-field list to the supervisor. If approved sources and output root are clear, continue safe draft work and log unresolved issues instead of blocking.

Inputs may also include source pleadings, exhibits, declarations, discovery, authority tables, public law, approved examples, and drafting profiles.

Apply `gating/human-approval-gates.md`: local/source-bound draft artifacts and new output-root working copies are green, and only the three hard gate categories stop execution.

## Procedure

1. **Checkout the assigned issue.** Read the parent issue, comments, contract, and approved sources.
2. **Build or update intermediary tables** before major drafting when needed (source indexes, issue tables, chronology tables, authority tables).
3. **Draft only from approved source facts and approved authorities.** Never introduce authorities from memory. Keep internal drafting notes separate from court-facing text.
4. **Consult references before format-sensitive work.** When a task involves a court-facing Word filing, follow the pleading paper formatting subsection below before any formatting work. When a task involves an existing draft with supervising-attorney edits, follow the supervising attorney review and Word editing subsections below before changing organization, wording, or formatting.

### Drafting sequence

Use this sequence for general California litigation drafting.

1. Confirm scope, sources, output root, authorities, and approval gates.
2. Inventory source materials and OCR quality.
3. Separate facts, procedure, law, strategy, assumptions, and open questions.
4. Build intermediary tables before major drafting.
5. Draft a narrow outline with source support for each section.
6. Draft one section or artifact at a time.
7. Check every factual sentence against approved sources.
8. Check every legal proposition against supplied or approved authorities.
9. Flag unresolved citations, dates, names, relief, parties, and procedural posture.
10. Produce review-ready text plus a short unresolved-issue list.

For internal memos, lead with the practical recommendation and use issue-focused analysis. For court-facing work, keep advocacy source-bound, remove internal notes, and preserve all required finalization gates.

### Intermediary work product

Build intermediary artifacts when they reduce drafting risk or make QA easier.

Common artifacts:

- Source manifest: file, source root, date, type, page count if known, extraction status, and use restrictions.
- Chronology table: date, event, source citation, issue relevance, and confidence.
- Issue table: issue, facts, missing facts, authorities, draft location, and owner.
- Authority table: proposition, authority, pinpoint, treatment status, source, and approval status.
- Exhibit list: exhibit, source file, description, purpose, sponsor/declarant, and citation target.
- Replacement table: old shell term, replacement term, source support, and unresolved placeholders.
- Needed-input list: question, why it matters, recommended default, gate type, and affected draft section.
- Change log: date/time, artifact, change, source basis, reviewer instruction, and unresolved risks.

Keep intermediary artifacts separate from final court-facing text. Do not turn assumptions into factual assertions.

### Drafting protocol

Drafting should be incremental and auditable.

- Start from a close approved example only when it fits the requested document type and procedural posture.
- Build a replacement table before adapting examples or prior drafts.
- Replace names, parties, dates, claims, defenses, allegations, relief, citations, headings, captions, and exhibit references from source support.
- Prefer concise paragraphs with one main proposition each.
- Use placeholders only when the issue cannot be safely resolved from approved sources.
- Mark placeholders consistently and include them in the unresolved-input list.
- Do not use memory to fill law, facts, or procedure.
- Keep legal theory, relief, sanctions, privacy, and protective-order choices within the approved strategy.
- When asked to revise, preserve useful reviewer judgment and explain material changes in the change log.

### Supervising attorney review

Follow this when tightening, reorganizing, or implementing review comments.

- Treat reviewer edits and comments as instructions, not noise.
- Identify whether the review asks for substance, tone, organization, support, formatting, or strategy.
- Keep changes within the approved issue scope and source record.
- Do not delete a reviewer point merely because it is awkward; convert it into clearer supported text or flag it.
- Preserve citation and exhibit anchors unless a source check shows they are wrong.
- Batch questions when review comments conflict or require strategy adoption approval.
- Maintain a change log that identifies confirmed changes, rejected alternatives, and unresolved questions.

Draft recommended changes to relief, sanctions, privacy recommendations, authority selection, or litigation strategy when they can be expressed as local output-root work. Route for hard-gate approval before adopting those recommendations through external action or protected mutation.

### Word editing protocol

Use document tooling only after the issue approves the relevant Word action.

Safe defaults:

- Draft text in artifacts or comments before active-draft insertion.
- Create new working copies rather than modifying originals.
- Preserve captions, styles, numbering, indentation, fields, headers, footers, tables, and paragraph spacing.
- Do not accept/reject tracked changes unless expressly approved.
- Do not remove comments unless expressly approved.
- Do not overwrite user-edited, final, signed, filed, served, or gold-standard documents.
- Record every approved active-draft update in the change log.

Before editing a Word file, confirm the exact file path, output path, action requested, approval status, and rollback copy strategy. After editing, render or inspect the document enough to verify formatting did not materially break.

### Pleading paper Word formatting

Apply this only when the issue requests filing-ready formatting, pleading paper, smart TOC/TOA, page numbering, or consistency with an approved sample.

Preconditions:

- Source draft text is review-ready.
- Caption, court, parties, case number, hearing, judge, department, and reservation fields are supplied or intentionally placeholdered.
- Formatting is for a new output-root working copy, or a protected active/final document edit has been approved.

Checks:

- Caption and footer fields are consistent.
- Line numbering, pleading paper, margins, headers, and footers match the approved filing profile.
- Section page numbering works when required.
- TOC and TOA are generated from actual headings and authorities.
- Citations in the TOA come only from supplied or approved authorities.
- Internal notes, drafting markers, and stale shell terms are removed or listed as unresolved.

### Related-case response

Follow this when a matter requires review or drafting related to a notice of related case or similar court-facing related-case filing.

1. Confirm the approved pleadings, docket materials, orders, and prior notices.
2. Build a source table comparing parties, claims, facts, events, property, transactions, witnesses, procedural posture, and requested relief.
3. Separate public procedural facts from privileged strategy.
4. Draft source-bound analysis of whether the cases appear related under the applicable public rule supplied or approved for the issue.
5. Flag missing dockets, service facts, hearing dates, or judge/department information.
6. Draft strategy recommendations locally when source-bound; stop before filing, service, or adopting strategy through external action unless approved.

Outputs should be a comparison table, draft response language if requested, and an unresolved-input list.

## Outputs

- Source-bound work product only: draft text, tables, outlines, QA notes, change logs, and new working-copy documents under `{output_root}`.
- Keep internal drafting notes separate from court-facing text.
- Return discrete yellow or hard-gate issues to the supervisor, but do not stop safe drafting when approved sources and output boundaries support continued work.
- Mark done only after posting the draft artifact and the unresolved-issue list.

### Draft artifact header

- Issue:
- Matter root:
- Output root:
- Approved sources used:
- Approved authorities used:
- Drafting profile:
- Approval needed before Word update:

### QA footer

- Placeholders:
- Unresolved citations:
- Source facts needing verification:
- Strategy decisions needed:
- Files modified:
- Files intentionally not modified:

## Anti-patterns

- Introducing authorities from memory or beyond the approved source roots.
- Updating an active Word file, protected draft, or relying on examples/prior drafts outside approved roots without hard-gate approval.
- Overwriting, deleting, renaming, finalizing, signing, filing, serving, emailing, or uploading without approval.
- Applying strategy, relief, sanctions, privacy, or protective-order decisions through external action or protected mutation without approval.
- Treating approval for one action as authorization for a different external tool, new authority, or hard-gate action.
- Using document tooling on active drafts, or legal research tools, before approval.
- Blocking on a missing field when approved sources and output root already support safe work — log it instead.

## Related skills

- `matter-workspace-setup`: resolve `{matter_root}` and `{output_root}` and the folder layout before drafting.
- `ca-subpoena-mtc-drafting-workflow`: subpoena motion-to-compel drafting and assembly.
