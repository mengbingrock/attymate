---
schema: agentcompanies/v1
slug: legal-matter-intake
name: legal-matter-intake
description: Turn a lawyer's matter request and approved source list into a scoped Paperclip Launch Intake Packet and Matter Safety Contract for the next legal workflow, without assuming a motion, tool, or external connector.
---

# legal-matter-intake

*The general front door for matter selection, scope, source boundaries, workflow routing, and safe startup.*

## When to load this skill

- A lawyer describes a new matter, document set, deadline, or legal work request.
- Legal Ops needs to create or confirm a matter parent issue before specialist work begins.
- A workflow needs a source/output boundary, approval profile, or tool-readiness handoff.
- The requested work could become a motion, pleading, research, calendar proposal, docket check, document review, or another supported workflow.

This skill does not draft legal arguments, perform OCR, conduct external research, or make external changes. It creates the scoped handoff those skills require.

## Inputs

Collect or discover within the approved scope:

- User-selected matter and no-cross-matter boundary.
- Plain-language request, likely workflow type, urgency, and requested deliverable.
- Matter root or approved source set, output root, forbidden roots, and allowed outputs.
- Source inventory, including exact files, read-only folders, and any missing sources.
- Authority limits and whether external research is approved.
- Autonomy level, approval profile, learning mode, do-not-learn list, and visible hard-gate approvals.
- Firm Operations Guide reference or scoped guide excerpt.
- Available runtime/tool profile: local workspace, PDF/OCR capability, document tooling, browser/connectors, and authentication state.

If a field is missing, return a concise missing-field list with recommended defaults and identify safe work that can continue. Do not infer a matter, source, or client boundary from unrelated context.

## Procedure

1. **Checkout or create the matter parent.** Read current comments, linked documents, existing dashboard/context, and prior work state.
2. **Plan read-only.** Inspect only the selected matter and approved source roots. Do not create substantive drafts, OCR sidecars, downloads, uploads, or external actions during intake.
3. **Produce the Launch Intake Packet** using `references/launch-inputs.md`. State what is known, what is missing, what sources are in scope, what outputs are allowed, and the next safe action.
4. **Build or confirm the Matter Safety Contract.** Translate lawyer-facing answers into explicit paths, source roots, forbidden roots, authority limits, approval profile, learning boundaries, and hard gates.
5. **Route by workflow profile.** Hand the scoped packet to the narrowest next skill, such as `ca-motion-drafting-workflow`, `ca-pleading-intake-review`, `ca-litigation-drafting-workflow`, `legal-pdf-processing`, `legal-calendaring-workflow`, or a monitor/research workflow. A PDF source does not imply a motion; a motion request does not imply OCR.
6. **Create only the needed child issues.** Use parent-linked specialist issues for durable deliverables, long-running work, parallel lanes, true blockers, or hard-gate paths. Keep small clarifications and triage on the parent.
7. **Keep status durable.** Post the packet, missing-input list, routing decision, open approvals, and next owner to Paperclip and the approved matter context location.

## Checkpoint and approval gates

**Green:** read-only scope review, source inventory, intake summary, Matter Safety Contract drafting, workflow routing, and new intake artifacts under an approved output root.

**Yellow:** scope/routing ambiguity, missing source decisions, conflicting matter identity, or strategy questions that can be separated from safe intake.

**Hard gates:** authentication, external downloads/uploads, new external research, calendar/email/filing/service actions, payments, and destructive or protected mutation require visible approval under `references/human-approval-gates.md`.

## Outputs

- Launch Intake Packet.
- Matter Safety Contract or focused child-task contract.
- Source and output boundary summary.
- Missing-input and approval list.
- Workflow routing and parent-linked child issue recommendations.

## Anti-patterns

- Treating intake as a motion or assuming MTC-specific facts.
- Inspecting another matter to fill gaps.
- Starting OCR, drafting, research, downloads, uploads, authentication, or external actions before scope and approval state are clear.
- Asking the lawyer to fill internal implementation fields when a plain-language question will do.
- Creating a large child-issue tree before the matter plan and next durable deliverables are known.

## Reference

- `references/launch-inputs.md`: discovery order and packet fields.
- `references/intake-output-format.md`: concise lawyer-facing intake output format.
