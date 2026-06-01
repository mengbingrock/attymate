# Matter Safety Contract

Every implementation child issue in a subpoena MTC run must include this contract. If any field is missing, ambiguous, or points outside the selected matter, the specialist agent must block and ask Legal Ops Supervisor to cure the issue before doing implementation work.

- Matter root: exact absolute selected matter folder.
- Output root: exact absolute `Intermediary work` folder inside the selected matter.
- Read-only source roots: explicit folders the child may inspect, such as `Exhibits`, `Context (not exhibit)`, `Authorities`, or `Examples`.
- Forbidden roots: all other matter folders; gold, final, signed, filed, served, or user-edited documents unless expressly approved.
- Allowed outputs: new intermediary artifacts, OCR sidecars, QA notes, or new working draft copies appropriate to the child issue.
- No cross-matter inspection: do not inspect or use files outside Matter root unless the issue explicitly permits a named path.
- Approval gates: Lexis, NotebookLM, uploads, browser auth, new authorities, sanctions/relief/strategy/privacy/protective-order changes, conflicting drafts, overwrite/delete/rename, finalization, filing, service, signing, and email.

Supervisor delegation requirements:

- Start every live run from one parent Paperclip issue assigned to Legal Ops Supervisor.
- Complete read-only Launch Intake before any implementation child issue is created.
- Create child issues only after run-start approval, except for blocked approval or missing-input issues.
- Set `parentId` on every child issue to the Legal Ops parent issue.
- Assign each child issue to the correct specialist agent.

Specialist refusal rule:

- Do not proceed without explicit Matter root, Output root, allowed read-only source roots, forbidden roots/no-cross-matter inspection, allowed outputs, and approval gates.
- Do not inspect other matter folders to infer missing paths or sources.
- Write only the allowed outputs, normally under Output root.
