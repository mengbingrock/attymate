# Matter Safety Contract

Every live matter parent issue and every implementation child issue must include this contract. If required scope is missing, Legal Ops Supervisor cures the issue before specialists expand work. Specialists should continue safe work when the approved sources and output root are clear, and should only block when no safe work remains.

- Workflow type: MTC, pleading intake, docket check, calendaring, research, drafting, QA, learning, or another named workflow.
- Autonomy level: `safe-draft-only`, `supervised-tools`, or `approved-external-actions`.
- Firm guide reference: private Firm Operations Guide issue-document section or scoped guide excerpt that defines workspace, tools, connectors, and approval policy.
- Matter root: exact selected matter folder or approved source set supplied at runtime.
- Output root: exact allowed output location, normally the matter's intermediary work folder.
- Read-only source roots: explicit folders or files the child may inspect, such as exhibits, context, authorities, examples, pleadings, or docket materials.
- Forbidden roots: all other matters; gold, final, signed, filed, served, or user-edited documents unless expressly approved.
- Allowed outputs: new intermediary artifacts, OCR sidecars, QA notes, research logs, proposed calendar tables, draft text, or new working draft copies appropriate to the child issue.
- Learning mode: `off`, `private-profile`, or `sanitized-skill-proposal`.
- Allowed learning sources: issue comments, documents, attachments, run summaries, named artifacts, or none.
- Do-not-learn list: client facts, privileged strategy, confidential source text, local paths, credentials, private URLs, account IDs, matter identifiers, and any issue-specific exclusions.
- No cross-matter inspection: do not inspect or use files outside the approved scope unless the issue explicitly permits a named path.
- Red gates already approved: browser auth, Lexis or new authorities, external knowledge-base/upload systems, external uploads/downloads, paid retrieval, calendar writes, email, Word writes to active drafts, strategy/relief/sanctions/privacy/protective-order changes, overwrite/delete/rename, finalization, filing, service, and signing.

Supervisor delegation requirements:

- Start every live matter workflow from one parent Paperclip issue assigned to Legal Ops Supervisor.
- Complete read-only intake before implementation child issues are created when the workflow requires matter selection or source scoping.
- Create child issues dynamically from the parent issue; do not rely on import-time MTC starter tasks.
- Set `parentId` on every child issue to the Legal Ops parent issue.
- Assign each child issue to the correct specialist agent.
- Include the full Matter Safety Contract or a focused subset that includes every field needed for the child issue.

Checkpoint policy:

- Green actions proceed autonomously and are logged: reading approved sources, creating new output-root artifacts, OCR sidecars, source indexes, draft text, QA notes, research logs from supplied sources, and proposed calendar tables.
- Yellow escalations go to Legal Ops Supervisor when the parent issue already authorizes the needed cure: routing, internal scope clarification, child issue contract repair, or source ambiguity that does not require new external action.
- Red gates require board/user approval before action: external auth, Lexis or new authorities, uploads/downloads from external systems, paid retrieval, calendar writes, email, filing, service, signing, finalization, overwrite/delete/rename, and material strategy changes.
