---
name: ca-subpoena-mtc-autonomous-runner
description: Coordinate a low-interruption California subpoena motion-to-compel run in Paperclip while preserving matter selection, Launch Intake, authority discipline, file safety, QA, and human approval gates.
---

# California Subpoena MTC Autonomous Runner For Paperclip

Use this skill from the Legal Ops Supervisor when a Paperclip issue asks for a California subpoena motion-to-compel workflow.

Use this Paperclip-native wrapper as the runtime authority for MTC coordination, issue delegation, autonomy boundaries, and approval gates.

## Required Contract And Gates

- Begin with user-owned matter selection.
- Require a parent issue assigned to Legal Ops Supervisor. Do not start from import-time MTC seed issues.
- Confirm Matter Safety Contract fields: workflow type, autonomy level, Firm Operations Guide reference or scoped guide excerpt, matter root, output root, source roots, forbidden roots, allowed outputs, learning mode, do-not-learn list, and red gates already approved.
- In planning, inspect only the selected matter and produce a Launch Intake Packet.
- Do not create files, OCR sidecars, draft sections, Word copies, or run-state artifacts during planning.
- After implementation is authorized, create `Intermediary work\00_Autonomous Run State.md` or the matter's equivalent new run-state artifact.
- Create only new intermediary artifacts and new working draft copies.
- Do not overwrite source files, user-edited drafts, final drafts, signed documents, served documents, or filing documents without explicit approval.
- Do not use legal authorities from memory.
- Stop at red gates: external research/upload, Lexis or new authorities, external knowledge-base/upload systems, browser auth, external downloads, paid retrieval, email, filing, service, signing, finalization, Word writes to active drafts, strategy changes, sanctions changes, relief changes, privacy/protective-order changes, or conflicting draft selection.
- Continue green work without asking: source inventory, safe OCR planning, source-bound tables, draft text under the output root, research logs from supplied authorities, QA notes, and proposed child issue descriptions.

## Paperclip Mapping

- Parent issue: "Run subpoena MTC package for selected matter."
- Child issues: create dynamically after intake; use `parentId` for Source Intake/OCR, Facts & Evidence, Legal Research/Authority Workup, Drafting & Assembly, QA Review, and Practice Learning when learning is enabled.
- Approval interactions: use Paperclip request confirmation or approval requests only for red gates or plan acceptance that truly stops further safe work.
- Durable state: keep both Paperclip issue history and matter-local run state current.
