# Workflow Issue Templates

These are reference templates only. They are not import-time starter tasks. Legal Ops Supervisor should create live child issues dynamically from a user-created parent issue and set `parentId` on each child.

## Light Intake Parent Issue

Title: Triage legal intake for [tentative matter label]

Use this when a lawyer gives a short request, a monitor routes a candidate, or scope is not yet complete.

Include:

- Matter Status Digest using `references/matter-status-digest.md`.
- One-sentence understanding of the request.
- Current safe source scope, defaulting to monitor summary or issue text only.
- Tentative matter label, if available.
- Desired next step: triage only, open parent intake issue, draft a plan, or wait.
- Red gates approved now, defaulting to none.
- What Legal Ops can do now without more approval.
- One plain-language question if more input is needed.

Allowed first-pass output:

- intake summary;
- likely workflow type;
- issue/missing-input list;
- recommended next step;
- proposed Matter Safety Contract for lawyer review if live work should begin.

Do not ask the lawyer to write the Matter Safety Contract. Legal Ops drafts it internally from the answers.

## MTC Parent Issue

Title: Run subpoena MTC package for selected matter

Include:

- Matter Status Digest using `references/matter-status-digest.md`.
- Matter Safety Contract with workflow type `MTC`.
- Selected matter root or approved source set.
- Output root.
- Read-only source roots.
- Authority limits.
- Autonomy level.
- Learning mode.
- Red gates already approved.
- Requested deliverables.

## MTC Child Issues

- Launch intake: assigned to Legal Ops Supervisor. Read-only scope, source inventory, deadlines, strategy inputs, authority limits, and missing inputs.
- Source intake/OCR: assigned to Source Intake Agent. Source manifest, OCR sidecars, document indexes, extraction QA.
- Facts and evidence: assigned to Facts & Evidence Agent. Exhibit lists, factual narrative, source crosswalks, citation tables.
- Legal research/authority: assigned to Legal Research Agent. Supplied-authority workup, citation verification, Shepardizing, and approved Lexis research only when authorized.
- Drafting and assembly: assigned to Drafting & Assembly Agent. Draft text, proposed orders, declarations, and approved working-copy assembly.
- QA review: assigned to Legal QA Agent. Source discipline, authority discipline, placeholders, confidentiality, finalization boundaries.
- Practice learning: assigned to Practice Learning Agent only when learning mode is enabled.

Each child issue must include a focused Matter Safety Contract. Do not create these children during package import.
