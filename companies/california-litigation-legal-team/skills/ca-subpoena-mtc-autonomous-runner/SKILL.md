---
name: ca-subpoena-mtc-autonomous-runner
description: Coordinate a low-interruption California subpoena motion-to-compel run in Paperclip while preserving matter selection, Launch Intake, authority discipline, file safety, QA, and human approval gates.
---

# California Subpoena MTC Autonomous Runner For Paperclip

This is the Paperclip-managed wrapper for the local Codex skill at:

Use this skill from the Legal Ops Supervisor when a Paperclip issue asks for a California subpoena motion-to-compel workflow.

Use that local skill and its reference files as controlling authority for autonomous-run rules. This wrapper exists so Paperclip can inject the workflow into Codex local agents.

## Required Gates

- Begin with user-owned matter selection.
- In planning, inspect only the selected matter and produce a Launch Intake Packet.
- Do not create files, OCR sidecars, draft sections, Word copies, or run-state artifacts during planning.
- After implementation is authorized, create `Intermediary work\00_Autonomous Run State.md` or the matter's equivalent new run-state artifact.
- Create only new intermediary artifacts and new working draft copies.
- Do not overwrite source files, user-edited drafts, final drafts, signed documents, served documents, or filing documents without explicit approval.
- Do not use legal authorities from memory.
- Ask before external research/upload, Lexis, NotebookLM, browser auth, email, filing, service, signing, finalization, strategy changes, sanctions changes, relief changes, privacy/protective-order changes, or conflicting draft selection.

## Paperclip Mapping

- Parent issue: "Run subpoena MTC package for selected matter."
- Child issues: Launch Intake, Source Intake/OCR, Facts & Evidence, Legal Research/Authority Workup, Drafting & Assembly, QA Review.
- Approval interactions: use Paperclip request confirmation or issue comments for every human gate.
- Durable state: keep both Paperclip issue history and matter-local run state current.
