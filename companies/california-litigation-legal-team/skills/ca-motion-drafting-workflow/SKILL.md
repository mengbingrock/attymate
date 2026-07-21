---
schema: agentcompanies/v1
slug: ca-motion-drafting-workflow
name: ca-motion-drafting-workflow
description: Coordinate and draft a source-bound California motion package under inherited matter authority; subpoena MTC is one motion profile, not a separate intake or approval system.
---

# ca-motion-drafting-workflow

## Use

Load for a California motion, memorandum, declaration package, proposed order, separate statement, RJN, or related review. Supported profiles include subpoena MTC, discovery motions, protective orders, sanctions motions, and other approved motion types.

Matter intake belongs to `legal-matter-intake`; reusable PDF work belongs to `legal-pdf-processing`.

## Required Handoff

Begin from the parent Matter Authorization Package and a focused motion work order identifying motion type, objective/relief, procedural posture, known deadlines, relevant sources/context, expected package, and exceptions. Do not repeat the parent package.

## Procedure

1. Confirm the motion profile, requested legal product, verified source/authority set, and reserved material strategy decisions.
2. Post one concise Motion Launch artifact only when it adds substantive scope; do not narrate workflow stages.
3. Create only needed lanes for source/PDF, facts, research, drafting, and QA. Direct handoffs are allowed under parent authority.
4. Use `legal-pdf-processing` only when extraction affects source usability.
5. Build motion-specific intermediary work: chronology, fact-to-source map, exhibit/RJN list, issue/objection table, authority table, TOC, or TOA as needed.
6. Draft from verified facts and authorities using `references/motion-drafting-sequence.md`. For subpoena MTC, also load `references/subpoena-mtc-checklists.md`; do not import those assumptions into other profiles.
7. Run package QA for source/authority support, procedural facts, requested relief, numbering, placeholders, and protected/final boundaries.
8. Present one controlling review package with material issues and any batched attorney decision.

## Authorization And Decisions

Routine research, verified new authorities, permitted downloads, configured read-only tools, working-copy revision, and agent coordination proceed under the parent package. Use `legal-matter-intake/references/human-approval-gates.md` for attorney decisions involving external acts, payment/budget expansion, protected mutation, matter/source expansion, or material strategy.

## Communication

Write substantive analysis once in the controlling motion work product. The Matter Dashboard links to it. Comments are limited to review readiness, material change, decision, attorney-owned blocker, or completion; run results do not repeat the analysis.

## References

- `references/motion-drafting-sequence.md`
- `references/subpoena-mtc-checklists.md`
- `references/intermediary-work-product.md`
- `references/deliverable-templates.md`
- `references/qa-checklist.md`
- `references/word-editing-protocol.md`
- `references/workspace-setup.md`
- `references/run-state.md`
