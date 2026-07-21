---
schema: agentcompanies/v1
slug: ca-motion-drafting-workflow
name: ca-motion-drafting-workflow
description: Coordinate and draft a California litigation motion package from one scoped Paperclip matter, including subpoena motions to compel, with source-bound drafting, local-first PDF handoffs, specialist work, QA, and human approval gates.
---

# ca-motion-drafting-workflow

*The motion-focused workflow for California litigation: turn a completed matter intake into a reviewable, source-bound motion package.*

## When to load this skill

- A scoped Paperclip issue requests a California litigation motion, memorandum, declaration package, proposed order, or related filing materials.
- The requested motion is a subpoena motion to compel, discovery motion, protective-order motion, sanctions motion, or another approved motion type.
- Legal Ops needs to coordinate motion-specific facts, authority, drafting, assembly, and QA after matter intake.

This is the canonical motion skill. Matter selection and generic Launch Intake belong to `legal-matter-intake`; reusable PDF/OCR capability belongs to `legal-pdf-processing`; general pleadings and non-motion drafting remain in `ca-litigation-drafting-workflow`.

## Required handoff and contract

Begin with a completed `legal-matter-intake` packet or an equivalent parent issue handoff. The motion issue must carry, or link to, a Matter Safety Contract containing:

- Motion type, requested relief, procedural posture, and known deadlines.
- Matter root, output root, read-only source roots, forbidden roots, and allowed outputs.
- Authority limits and whether external research is approved.
- Autonomy level, approval profile, learning mode, do-not-learn list, and visible hard-gate approvals.
- Firm Operations Guide reference or scoped guide excerpt.
- No-cross-matter boundary and any source, strategy, privacy, sanctions, or protective-order decisions that remain unresolved.

If scope, source, or output boundaries are missing, return the missing-field list to Legal Ops while continuing safe work that remains.

## Procedure

1. **Checkout the motion issue.** Read the parent matter intake, comments, documents, Firm Operations Guide reference, approved sources, and prior run state.
2. **Plan read-only.** Confirm the motion profile, source set, output boundary, authority rules, and hard gates before creating substantive artifacts.
3. **Post a Motion Launch Packet** that records the selected motion, relief sought, factual/procedural questions, sources, output plan, approval profile, and recommended specialist lanes. For a subpoena MTC, include subpoena requests, objections, meet-and-confer history, production status, and compliance facts when supplied.
4. **Prepare PDFs only when needed.** Load `legal-pdf-processing`, run its capability probe, and choose the smallest sufficient local backend per document or rejected page. Preserve originals and page order; write sidecars only under `{output_root}`. Remote OCR or vision is not implied.
5. **Create or update the motion run state** under `{output_root}` after the Motion Launch Packet. Record phase, scope, artifacts, open questions, approvals, and page-coverage status.
6. **Create parent-linked child issues** with focused contracts as needed:
   - **Source Intake/PDF:** inventory sources, assess extraction, create sidecars, and maintain the source manifest.
   - **Facts & Evidence:** chronology, fact-to-source map, exhibit list, issue table, and motion-specific evidence gaps.
   - **Legal Research/Authority Workup:** supplied-authority table, citation verification, treatment notes, and new research only after approval.
   - **Drafting & Assembly:** motion, memorandum, separate statement where applicable, declarations, RJN, proposed order, TOC/TOA, and new output-root working copies.
   - **Legal QA:** source support, authority discipline, requested-relief fit, stale terms, placeholders, numbering, page coverage, finalization boundary, and approval audit.
   - **Practice Learning:** only when the learning contract authorizes it.
7. **Build intermediary work before major drafting.** Use source/document indexes, chronologies, fact-to-source maps, exhibit/RJN lists, issue or objection tables, authority tables, needed-input lists, TOC, and TOA as appropriate to the motion.
8. **Draft in the motion profile's sequence.** Use approved source facts, approved authorities, and approved examples only. Identify the support for each factual and legal proposition. For subpoena MTC work, use `references/motion-drafting-sequence.md` and `references/subpoena-mtc-checklists.md`.
9. **Monitor and consolidate.** Keep Paperclip issue history and the matter-local run state current. Cure yellow scope or routing defects without blocking safe source-bound work. Do not inspect another matter to fill a gap.
10. **Run final QA before presentation.** Check requested-relief fit, source and authority support, procedural facts, exhibit/declaration numbering, stale shell terms, placeholders, page coverage, unresolved strategy, and approval-gate status.
11. **Present the review package.** Post artifact paths, change log, unresolved inputs, QA risks, and the exact human decisions still required. Do not finalize, file, serve, sign, or send.

## Checkpoint and approval gates

**Green - continue without asking:** source inventory, local PDF/OCR sidecars, source-bound tables, draft text under the output root, research logs from supplied authorities, QA notes, and child issue descriptions.

**Yellow - Legal Ops Supervisor cures:** scope and routing defects, child scope repair, and strategy questions separable from safe work.

**Hard gates - separate approval required before each:** use `legal-matter-intake/references/human-approval-gates.md` as the canonical matrix. Stop for external side effects; authentication, payment, or legal-authority expansion; and destructive or protected mutation. Draft recommendations and new output-root artifacts remain allowed when scope is clear.

Approval for one red-gate action does not authorize any other red-gate action. Never use legal authorities from memory.

## Drafting and file rules

- Use `references/motion-drafting-sequence.md` for the MTC profile and adapt it to the approved motion type.
- Use `references/intermediary-work-product.md`, `references/deliverable-templates.md`, and `references/live-draft-change-log.md` before major drafting.
- Use `references/word-editing-protocol.md` for new working copies and approved active-draft edits.
- Use `references/subpoena-mtc-checklists.md` only when the motion profile is a subpoena MTC.
- Never reorder, overwrite, rename, split, merge, delete, finalize, file, serve, sign, or send source/final documents without the applicable approval.
- OCR and extracted text are sidecar work product. The source PDF image remains authoritative when extraction conflicts with it.

## Outputs

- Motion Launch Packet, focused child issue descriptions, run-state artifact, source-bound tables, draft sections, new working copies, change logs, QA notes, and final review packet.
- Outputs stay in Paperclip issue history or under `{output_root}` after implementation approval.
- Do not create substantive matter files during read-only planning.

## Anti-patterns

- Treating subpoena MTC assumptions as defaults for another motion type.
- Repeating generic matter intake or PDF-tool setup inside the motion skill.
- Drafting before scope, source roots, output root, and authority limits are clear.
- Introducing authorities or facts from memory or another matter.
- Updating active Word/final/source files, finalizing, filing, serving, signing, emailing, or uploading without approval.
- Treating OCR or derived Markdown as a replacement for the source PDF.
- Blocking on a missing field when approved source-bound work remains.

## Reference

- `references/motion-drafting-sequence.md`: MTC profile and adaptable package order.
- `legal-matter-intake/references/human-approval-gates.md`: green/yellow/red checkpoint matrix.
- `references/run-state.md`: motion run-state fields.
- `references/qa-checklist.md`: package QA checks.
- `references/intermediary-work-product.md`: tables and source-bound artifacts.
- `references/deliverable-templates.md`: reusable artifact formats.
- `references/live-draft-change-log.md`: confirmed-change tracking.
- `references/subpoena-mtc-checklists.md`: MTC-specific checks.
- `references/workspace-setup.md`: matter workspace and output conventions.
- `references/word-editing-protocol.md`: Word working-copy safety.
