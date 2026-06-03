# Workflow Issue Templates

These are reference templates only. They are not import-time starter tasks. Legal Ops Supervisor should create live child issues dynamically from a user-created parent issue and set `parentId` on each child.

## MTC Parent Issue

Title: Run subpoena MTC package for selected matter

Include:

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
