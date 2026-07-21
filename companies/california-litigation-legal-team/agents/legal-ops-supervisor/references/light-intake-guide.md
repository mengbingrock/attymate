# Light Intake Guide

Use this guide when Legal Ops Supervisor receives a monitor finding, a user-created matter issue, or a vague request for legal work.

## Goal

Make intake feel like a short conversation with a capable assistant. The lawyer should answer ordinary questions, not fill out scope forms. Legal Ops translates answers into the internal Matter Safety Contract, Matter Dashboard, Matter Home, approval posture, and child issues.

## Default Path

Start in Light Intake Mode unless the issue already contains a complete scope.

1. Restate what Legal Ops understands in one sentence.
2. Say what the team can do now without more approval.
3. Create or update the Matter Dashboard when this is a parent matter.
4. Continue safe local/source-bound work instead of asking, if there is useful safe work.
5. If a decision is needed, ask one batched question with 2-3 choices and a recommended safe default.
6. Translate the answer into the Matter Safety Contract internally.

## Minimum Lawyer-Facing Questions

Ask only what is needed for the next safe step. Prefer one batched question over serial confirmations:

- "What should I call this matter for now?"
- "Should I use only the monitor summary, review the specific source you identified, or wait for a source package?"
- "Should I close this, proceed with safe local work, or pause for strategy?"
- "Do you approve this one named hard-gate action, or should I keep all external actions off?"

If the lawyer does not know, recommend the safe default: temporary matter label, monitor-summary-only scope, safe local work only, no hard gates, and no external action.

## Safe Defaults

- Matter label: tentative label is acceptable.
- Source scope: already-approved monitor summary or issue text only.
- Matter Home: create or use `{workspace}/Matters/{matter-short-name}/` when an output root is approved; otherwise mark the Matter Dashboard `not yet filed into Matter Home`.
- Output: parent issue documents until a Matter Home/output folder is configured.
- Hard gates: none approved.
- Approval profile: relaxed default controls; `sandbox_autopilot` is only a test/demo label, not the only low-friction path.
- Learning mode: `off`.
- Work product: Matter Dashboard, intake summary, coverage table, missing-input list, and proposed next steps.

## Low-Friction Rule

Do not ask the lawyer to approve routine local/source-bound steps, issue documents, Matter Dashboard updates, local draft recommendations, QA notes, or internal routing when scope is clear. Ask only for external side effects, authentication/payment/new-authority expansion, destructive/protected mutation, or a real source/strategy choice that blocks all useful safe work.

## Stop Language

If no safe work remains, mark the issue `blocked` and start with:

> I need one thing before I can continue: [plain-language missing decision].

Then give 2-3 choices. Do not paste the full Matter Safety Contract checklist to the lawyer.

Also update the parent Matter Dashboard so the lawyer can see whether the next step belongs to the team or to them.

## Red Gates

Use `skills/legal-matter-intake/references/human-approval-gates.md` as the canonical approval matrix. Proceed on local/source-bound work, output-root artifacts, new output-root working copies, draft recommendations, QA, issue updates, and internal routing. Stop only for external side effects; authentication, payment, or legal-authority expansion; and destructive or protected mutation.
