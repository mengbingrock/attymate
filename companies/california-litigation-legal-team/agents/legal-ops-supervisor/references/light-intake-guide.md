# Light Intake Guide

Use this guide when Legal Ops Supervisor receives a monitor finding, a user-created matter issue, or a vague request for legal work.

## Goal

Make intake feel like a short conversation with a capable assistant. The lawyer should answer ordinary questions, not fill out scope forms. Legal Ops translates answers into the internal Matter Authorization Package, Matter Dashboard, Matter Home, approval posture, and child issues.

## Default Path

Start in Light Intake Mode unless the issue already contains a complete scope.

1. Restate what Legal Ops understands in one sentence.
2. Say what the team can do now without more approval.
3. Create or update the Matter Dashboard when this is a parent matter.
4. Continue safe local/source-bound work instead of asking, if there is useful safe work.
5. If a decision is needed, ask one batched question with 2-3 choices and a recommended safe default.
6. Translate the answer into the Matter Authorization Package internally.

## Minimum Lawyer-Facing Questions

Ask only what is needed for the next safe step. Prefer one batched question over serial confirmations:

- "What should I call this matter for now?"
- "Should I use only the monitor summary, review the specific source you identified, or wait for a source package?"
- "Should I close this, proceed with safe local work, or pause for strategy?"
- "Decision needed: should we take this external action, or keep the work internal?"

If the lawyer does not know, recommend the safe default: temporary matter label, monitor-summary-only scope, authorized internal work, and no external action.

## Safe Defaults

- Matter label: tentative label is acceptable.
- Source scope: already-approved monitor summary or issue text only.
- Matter Home: create or use `{workspace}/Matters/{matter-short-name}/` when an output root is approved; otherwise mark the Matter Dashboard `not yet filed into Matter Home`.
- Output: parent issue documents until a Matter Home/output folder is configured.
- Attorney Decisions: none pending unless an external act, payment, protected-file change, scope expansion, or material strategy choice is necessary.
- Authorization: parent Matter Authorization Package applies to descendants; `sandbox_autopilot` is only a test/demo label.
- Learning mode: `off`.
- Work product: Matter Dashboard, intake summary, material gaps, and proposed next step.

## Low-Friction Rule

Do not ask the lawyer to approve source review, local PDF/OCR, routine research, new verified authorities, permitted downloads, working-copy edits, QA, Dashboard updates, issue documents, or internal routing within the parent authorization. Ask only about external acts, payment/budget expansion, protected-file mutation, matter/source expansion or cross-matter use, and material legal strategy.

## Stop Language

If no safe work remains, mark the issue `blocked` and start with:

> I need one thing before I can continue: [plain-language missing decision].

Then give 2-3 choices. Do not paste the full Matter Authorization Package checklist to the lawyer.

Also update the parent Matter Dashboard so the lawyer can see whether the next step belongs to the team or to them.

## Authorization Matrix

Use `skills/legal-matter-intake/references/human-approval-gates.md` as the canonical matrix. Login, MFA, CAPTCHA, connector, and tool failures are Operational Interruptions routed to Legal Ops or the tool owner, not lawyer decisions.
