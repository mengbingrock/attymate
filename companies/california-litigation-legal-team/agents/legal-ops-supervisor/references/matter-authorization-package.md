# Matter Authorization Package

Create this package once on every live parent matter issue. It defines the standing authority inherited by all descendant issues and replaces repeated approval checklists on each child.

Legal Ops builds it from plain-language lawyer instructions, approved source descriptions, and the Firm Operations Guide. Do not ask the lawyer to complete internal fields.

## Parent Package

- Matter and objective: the selected matter, requested legal work, and current litigation objective.
- Matter boundary: matter root or approved source set, forbidden matters/roots, and the no-cross-matter rule.
- Work-product boundary: output root, designated working copies, allowed deliverable classes, and protected originals/final materials.
- Research authority: approved questions, jurisdiction, source classes, research tools, permitted downloads, and budget ceiling.
- Connector authority: configured read-only connectors and approved monitor/browser scope.
- Material strategy reserved to the lawyer: claims/defenses, relief, waiver, settlement, sanctions, and significant privacy/protective-order positions not already decided.
- External actions reserved to the lawyer: filing, service, signature, sends, calendar writes, public posting, uploads/shares, and payments.
- Firm guide reference: the narrow Firm Operations Guide sections needed for the matter.
- Learning policy: `off`, `private-profile`, or `sanitized-skill-proposal`, with allowed sources and a do-not-learn list when enabled.
- Expiration/change conditions: lawyer revocation, matter/source expansion, material objective change, or exhausted budget.

If a parent field is incomplete, apply a safe default and ask one plain-language question only when the answer changes available work. Continue all work already authorized.

## Child Work Order

Every child references the parent issue/package and contains only:

- Objective and concrete completion standard.
- Relevant sources and matter-context artifacts.
- Output or work product to create/update.
- Exceptions or narrower limits that differ from the parent package.

Do not copy the full parent package, full approval matrix, Firm Operations Guide, sibling history, or forbidden-root list into the child. A missing child detail is an internal scope repair for Legal Ops unless it would expand the parent authority.

## Inheritance Rules

- Parent authority applies to all descendants by default.
- Internal delegation, specialist handoff, working-copy revision, routine research, permitted downloads, and configured read-only tool use do not require new approval.
- A child may narrow but never broaden parent authority.
- Broader sources, budget, external action, protected mutation, or material strategy requires the appropriate parent update or attorney decision.
- Existing decisions remain valid until their target changes materially or the lawyer revokes them.

Use `skills/legal-matter-intake/references/human-approval-gates.md` as the canonical action matrix.
