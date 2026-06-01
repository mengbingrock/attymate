---
name: ca-litigation-drafting-workflow
description: Use when a Paperclip drafting or QA agent must draft, revise, organize, or review California litigation work product, including pleadings, motions, memoranda, declarations, meet-and-confer letters, proposed orders, source indexes, issue tables, and Word working-copy updates. Do not use to insert unapproved authorities, overwrite user-edited files, finalize, sign, file, serve, or email.
---

# California Litigation Drafting Workflow

## Paperclip Role

Use this skill from the Drafting & Assembly Agent, Legal QA Agent, or supervisor-delegated drafting child issue. It is reusable for California litigation and contains no client facts, firm templates, private style rules, or hardcoded paths.

## Required Issue Contract

Before drafting begins, confirm the issue states:

- Matter root and output root.
- Read-only source roots, including any pleadings, exhibits, authorities, examples, or prior drafts that may be inspected.
- Forbidden roots, including other matters and final/signed/filed/served/user-edited documents unless expressly approved.
- Allowed outputs, such as new draft sections, tables, QA notes, or new working-copy documents.
- Authority source limits.
- Drafting profile or style policy, if deployment-specific style is required.
- Approval gates for Word writes, new authorities, strategy changes, finalization, filing, service, signing, and email.

If scope, source, output, or approval boundaries are missing, block and ask the supervisor to cure the issue.

## Heartbeat Workflow

1. Checkout the assigned issue.
2. Read the parent issue, comments, contract, and approved sources.
3. Build or update intermediary tables before major drafting when needed.
4. Draft only from approved source facts and approved authorities.
5. Post draft text, issue tables, or artifact paths for review.
6. Wait for approval before updating Word working copies or any active draft.
7. Preserve formatting and existing user edits when a Word update is approved.
8. Post a change log, remaining placeholders, unresolved citations, and QA risks.

## Approval Gates

Approval is required before:

- Updating a Word file or active draft.
- Using new authorities beyond supplied/approved sources.
- Making strategy, relief, sanctions, privacy, or protective-order changes.
- Overwriting, deleting, renaming, finalizing, signing, filing, serving, emailing, or uploading.
- Relying on examples or prior drafts outside the approved source roots.

## Inputs And Outputs

Inputs may include source pleadings, exhibits, declarations, discovery, authority tables, public law, approved examples, and drafting profiles.

Outputs must be source-bound: draft text, tables, outlines, QA notes, change logs, and new working-copy documents under `{output_root}`. Do not introduce authorities from memory.

## Tool Policy

Use document tooling only for new working copies or approved active-draft updates. Use legal research tools only after approval. Use OCR/PDF tools through a scoped PDF/OCR issue when extraction quality matters.

## Handoff Rules

Return to the supervisor if facts conflict, strategy is needed, authorities are missing, output would exceed allowed writes, or finalization is requested. Mark done only after posting the draft artifact and unresolved-issue list.

## Reference Files

- `references/drafting-output-format.md`: generic artifact and QA output format.
