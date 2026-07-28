# Workflow Issue Templates

These are reference templates only. They are not import-time starter tasks. Legal Ops Supervisor should create live child issues dynamically from a user-created parent issue and set `parentId` on each child.

## Light Intake Parent Issue

Title: Triage legal intake for [tentative matter label]

Use this when a lawyer gives a short request, a monitor routes a candidate, or scope is not yet complete.

Include:

- Matter Dashboard using `references/matter-status-digest.md`.
- Matter Plan using `references/matter-planning-playbook.md` if the intake may trigger multiple workstreams.
- One-sentence understanding of the request.
- Current safe source scope, defaulting to monitor summary or issue text only.
- Tentative matter label, if available.
- Desired next step: triage only, open parent intake issue, draft a plan, or wait.
- Any material decision needed now, defaulting to none.
- What Legal Ops can do now without more approval.
- One plain-language question if more input is needed.
- Matter Home status: approved Matter Home path or `not yet filed into Matter Home`.

Allowed first-pass output:

- intake summary;
- likely workflow type;
- issue/missing-input list;
- recommended next step;
- proposed Matter Safety Contract for lawyer review if live work should begin.

Do not ask the lawyer to write the Matter Safety Contract. Legal Ops drafts it internally from the answers.

## Motion Parent Issue

Title: Draft [motion type] for selected matter

Include:

- Matter Dashboard using `references/matter-status-digest.md`.
- Matter Plan that classifies all known MTC-related workstreams.
- Matter Safety Contract with the general motion workflow and selected motion profile. MTC is one optional profile.
- Selected matter root or approved source set.
- Output root.
- Matter Home and `_paperclip_issues/{issue-identifier}` audit-output convention when filesystem output is approved.
- Read-only source roots.
- Authority limits.
- Autonomy level.
- Authorization and budget; use `sandbox_autopilot` only when this is a local sandbox/demo/benchmark run.
- Learning mode.
- Any Attorney Decision already recorded.
- Requested deliverables.

## Sandbox Autopilot Parent Issue

Title: Sandbox run for [workflow or matter label]

Use this when testing the company template, running demos, exercising benchmark fixtures, or validating local workflow behavior without live client-facing output.

Include:

- Matter Dashboard using `references/matter-status-digest.md`.
- Matter Plan for the test event or workflow.
- Matter Safety Contract with the target workflow type.
- `approval_profile: sandbox_autopilot`.
- Autonomy level, normally `supervised-tools`.
- Test matter root or approved test source set.
- Output root for new non-client-facing sandbox artifacts.
- Matter Home or test Matter Home path, with issue audit output under `_paperclip_issues/{issue-identifier}`.
- Read-only source roots.
- Forbidden roots, especially live matters, final/signed/filed/served/user-edited documents, and unrelated client files.
- Allowed outputs: new intermediary artifacts, OCR sidecars, QA notes, draft text, proposed calendar tables, run-state updates, benchmark/demo reports, and new working-copy drafts under the output root.
- Learning mode, normally `off` unless a sanitized skill proposal is explicitly requested.
- Statement that outputs are sandbox artifacts and are not attorney-final, client-facing, filed, served, signed, uploaded, or shared.
- Attorney Decisions still required for external acts, payment/budget expansion, protected-file mutation, scope expansion/cross-matter use, or material legal strategy.

## Motion Child Issues

- Launch intake: assigned to Legal Ops Supervisor. Read-only scope, source inventory, deadlines, strategy inputs, authority limits, and missing inputs.
- Source intake/OCR: assigned to Source Intake Agent. Source manifest, OCR sidecars, document indexes, extraction QA.
- Facts and evidence: assigned to Facts & Evidence Agent. Exhibit lists, factual narrative, source crosswalks, citation tables.
- Legal research/authority: assigned to Legal Research Agent. Routine research, citation verification, treatment review, verified authorities, and permitted downloads within parent scope and budget.
- Drafting and assembly: assigned to Drafting & Assembly Agent. Draft text, proposed orders, declarations, and new output-root working-copy assembly.
- QA review: assigned to Legal QA Agent. Source discipline, authority discipline, placeholders, confidentiality, finalization boundaries.

Each child issue references the parent Matter Safety Contract and includes only its objective, relevant sources, output, and exceptions, plus role-relevant context from `references/matter-context-artifacts.md`. Do not create these children during package import.
