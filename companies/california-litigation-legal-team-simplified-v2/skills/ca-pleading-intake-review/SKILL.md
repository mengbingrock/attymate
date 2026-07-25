---
schema: agentcompanies/v1
slug: ca-pleading-intake-review
name: ca-pleading-intake-review
description: Use when an intake agent must perform source-bound California pleading intake or review, including complaints, amended complaints, answers, proofs of service, filing/service facts, allegation summaries, party/caption checks, and local source manifests. Do not use for external legal research, calendaring writes, drafting beyond intake summaries, or external knowledge-base uploads without approval.
---

# ca-pleading-intake-review

*How the California Litigation Legal Team performs source-bound pleading intake — every fact tied to a page, paragraph, exhibit, filing, or service reference, supervised and source-bound.*

## When to load this skill

- The Source Intake Agent is assigned a scoped intake issue for complaints, amended complaints, answers, or proofs of service.
- New pleadings or filing/service facts arrive and need an inventory, OCR assessment, or source manifest.
- A caption, party list, or proof of service needs a consistency check against the pleadings.
- The supervisor needs an allegation or procedural summary tied to source references.
- This skill is product-safe: it contains no client facts, matter examples, firm paths, private templates, or account details.

## Inputs

Before intake begins, confirm the issue states:

- Matter root and output root.
- Read-only source roots or exact files to inspect.
- Forbidden roots and the no-cross-matter inspection rule.
- Allowed outputs, such as inventories, OCR sidecars, source manifests, and intake summaries.
- Whether external mailbox, drive, OCR, or external upload tools are authorized.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, learning mode, and any visible hard-gate approvals already granted.

Runtime inputs may include pleadings, proofs of service, docket facts, email attachments, and approved source folders.

If the contract is missing, return a concise missing-field list to the supervisor. If approved source files and output root are clear, continue safe intake work and log unresolved gaps.

Apply `gating/human-approval-gates.md` in both standard and `sandbox_autopilot` modes: local source intake, local OCR sidecars, and output-root summaries are green, and only the three hard gate categories stop execution.

## Procedure

1. Checkout the assigned issue.
2. Read issue scope, comments, parent context, and approved source roots.
3. Inventory source pleadings and identify extraction/OCR needs. Use PDF/OCR tools when source text is unavailable or unreliable. Treat source PDFs as read-only. Use mailbox/drive connectors only when the deployment and issue authorize them.
4. Create only approved sidecar artifacts under `{output_root}`.
5. Summarize pleadings with source page, paragraph, exhibit, filing, or service references where available.
6. Flag extraction gaps, visual-verification needs, missing proofs, caption inconsistencies, and unresolved party issues.
7. Prepare an external-upload handoff manifest only if approved; do not upload.
8. **Apply the checkpoint policy.** Green work proceeds autonomously and is logged: local source inventories, extraction/OCR need assessment, source manifests, intake summaries, and approved sidecar artifacts under `{output_root}`. Yellow routes to the Legal Ops Supervisor when filing/service facts conflict, source scope needs repair, or a drafting handoff needs clearer routing. Hard gates require visible approval before the actions listed under Anti-patterns. Return discrete yellow or hard-gate issues to the supervisor but continue safe intake when approved sources and output boundaries allow it.

## Outputs

- Pleading inventories, POS review notes, allegation/procedural summaries, extraction-gap logs, OCR sidecars, and source manifests under `{output_root}`.
- Discrete yellow or hard-gate issues returned to the Legal Ops Supervisor for resolution.
- A drafting handoff to the Drafting & Assembly Agent when work moves beyond intake summaries.

## Anti-patterns

Never do any of the following without visible hard-gate approval:

- Downloading from email/drive systems unless the issue authorizes it.
- Uploading to any external system.
- Emailing, filing, serving, signing, finalizing, or calendar writing.
- Editing originals or user-edited documents.
- Expanding into legal research or drafting beyond intake summaries.

## Reference

- `references/intake-output-format.md`: generic intake deliverable format.
