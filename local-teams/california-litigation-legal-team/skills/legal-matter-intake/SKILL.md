---
schema: agentcompanies/v1
slug: legal-matter-intake
name: legal-matter-intake
description: Turn a lawyer's matter request and approved source description into a concise Launch Intake Packet and inherited Matter Authorization Package for the next legal workflow.
---

# legal-matter-intake

*The general front door for matter selection, standing authority, source boundaries, and workflow routing.*

## When to load this skill

- A lawyer describes a new matter, document set, deadline, or legal work request.
- Legal Ops needs to create or confirm a parent matter before specialist work begins.
- A workflow needs matter scope, standing research/tool authority, output boundaries, or a material strategy decision.

This skill does not draft legal arguments or perform specialist work. It creates one parent authorization package that downstream work inherits.

## Inputs

Collect or discover within approved scope:

- Selected matter and no-cross-matter boundary.
- Plain-language objective, urgency, requested deliverable, and known deadlines.
- Approved source set, protected/forbidden sources, output root, and designated working copies.
- Routine research questions, jurisdiction, source classes, configured tools/connectors, and budget ceiling.
- Material legal positions already decided or reserved to the lawyer.
- External actions, payments, protected mutations, or scope expansions already authorized, if any.
- Firm Operations Guide reference and learning policy.

Use safe defaults for internal implementation details. Ask the lawyer only when the missing answer changes the legal objective, matter/source boundary, material strategy, budget, or external action.

## Procedure

1. **Checkout or create the parent matter.** Read current comments, linked documents, and existing matter context without replaying unrelated history.
2. **Plan read-only.** Confirm matter identity, objective, source boundary, output boundary, standing tool/research authority, and reserved lawyer decisions.
3. **Produce a concise Launch Intake Packet** using `references/intake-output-format.md`. State the objective, what can proceed now, any material source gap, and the next owner.
4. **Create or confirm the Matter Authorization Package** using `agents/legal-ops-supervisor/references/matter-authorization-package.md`.
5. **Route to the narrowest next skill.** A PDF does not imply a motion; a motion does not imply OCR.
6. **Create only needed child work orders.** Each child references the parent package and includes only objective, relevant sources/context, output, completion standard, and exceptions.
7. **Ask one decision only when required.** Use `references/human-approval-gates.md`; consolidate related material strategy or external-action choices into one first-class interaction.
8. **Keep the lawyer-facing surface concise.** Update the Matter Dashboard only for a material posture, deliverable, risk, deadline, or decision change.

## Outputs

- Concise Launch Intake Packet.
- Parent Matter Authorization Package.
- Workflow routing and focused child work orders.
- At most one batched lawyer decision when required.

## Anti-patterns

- Copying the full parent authorization package into every child.
- Treating agent delegation, configured read-only tools, routine research, or working-copy edits as new approvals.
- Asking the lawyer for internal paths, profiles, gate names, or contract fields.
- Starting work outside the matter/source boundary or crossing an attorney-decision category without a decision.
- Creating comments or documents that merely narrate intake process.

## Reference

- `references/launch-inputs.md`: discovery order and package inputs.
- `references/intake-output-format.md`: concise attorney-facing intake format.
- `references/human-approval-gates.md`: canonical authorization, attorney-decision, and operational-interruption matrix.
