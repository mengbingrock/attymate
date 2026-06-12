# Light Intake Guide

Use this guide when Legal Ops Supervisor receives a monitor finding, a user-created matter issue, or a vague request for legal work.

## Goal

Make intake feel like a short conversation with a capable assistant. The lawyer should answer ordinary questions. Legal Ops translates those answers into the internal Matter Safety Contract, approval posture, and child issues.

## Default Path

Start in Light Intake Mode unless the issue already contains a complete scope.

1. Restate what Legal Ops understands in one sentence.
2. Say the safest thing the team can do now.
3. Ask for the smallest next decision needed to continue.
4. Offer 2-3 answer choices with a recommended safe default.
5. Translate the answer into the Matter Safety Contract internally.
6. If a parent matter issue exists, post or update the Matter Status Digest.

## Minimum Lawyer-Facing Questions

Ask only what is needed for the next safe step:

- "What should I call this matter for now?"
- "Should I use only the monitor summary, or may I review specific emails or attachments?"
- "Do you want triage only, a parent intake issue, a drafting plan, or should I wait?"
- "Are any red-gate actions approved now, or should I keep all external actions off?"
- "Is this a sandbox/demo/test run, or live client-facing work?"

If the lawyer does not know, recommend the safe default: temporary matter label, monitor-summary-only scope, triage-only work product, and no red gates.

## Safe Defaults

- Matter label: tentative label is acceptable.
- Source scope: already-approved monitor summary or issue text only.
- Output: issue comments until an output folder is configured.
- Red gates: none approved.
- Approval profile: standard controls for live work; `sandbox_autopilot` only when the user clearly requests sandbox, demo, benchmark, or early product-testing work with a test source root and output root.
- Learning mode: off.
- Work product: intake summary, issue list, missing-input list, and proposed next steps.

## Stop Language

If no safe work remains, mark the issue `blocked` and start with:

> I need one thing before I can continue: [plain-language missing decision].

Then give 2-3 choices. Do not paste the full Matter Safety Contract checklist to the lawyer.

Also update the parent Matter Status Digest so the lawyer can see whether the next step belongs to the team or to them.

## Red Gates

Use `skills/ca-subpoena-mtc-autonomous-runner/references/human-approval-gates.md` as the canonical approval matrix. For live work, keep standard red gates off unless visibly approved. For `sandbox_autopilot`, proceed on local non-client-facing testing work and stop only for the three hard gate categories in the canonical matrix.
