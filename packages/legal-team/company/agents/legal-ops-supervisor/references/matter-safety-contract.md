# Matter Safety Contract

Every live matter matter record and every implementation delegated task must include this contract. If required scope is missing, Legal Ops Supervisor cures the task before specialists expand work. Specialists should continue safe work when the approved sources and output root are clear, and should only block when no safe work remains.

This is an internal coordination contract. Lawyers should not be asked to fill it out field by field. Legal Ops Supervisor should use `light-intake-guide.md` to ask plain-language questions, apply safe defaults, and translate the answers into the contract.

- Workflow type: MTC, pleading intake, docket check, calendaring, research, drafting, QA, learning, or another named workflow.
- Autonomy level: `safe-draft-only`, `supervised-tools`, or `approved-external-actions`.
- Approval profile: relaxed default controls unless the task explicitly labels the work `sandbox_autopilot` for local non-client-facing testing.
- Firm guide reference: private Firm Operations Guide task-document section or scoped guide excerpt that defines workspace, tools, connectors, and approval policy.
- Matter root: exact selected matter folder or approved source set supplied at runtime.
- Output root: exact allowed output location, normally the matter's intermediary work folder.
- Matter context index: optional path or task-document reference to `00_Matter_Context_Index.md` for existing matters.
- Role-relevant matter context artifacts: optional small artifact set selected under `references/matter-context-artifacts.md`; do not require every agent to read the whole matter context folder.
- Read-only source roots: explicit folders or files the child may inspect, such as exhibits, context, authorities, examples, pleadings, or docket materials.
- Forbidden roots: all other matters; gold, final, signed, filed, served, or user-edited documents unless expressly approved.
- Allowed outputs: new intermediary artifacts, OCR sidecars, QA notes, research logs, proposed calendar tables, draft text, or new working draft copies appropriate to the delegated task.
- Learning mode: `off`, `private-profile`, or `sanitized-skill-proposal`.
- Allowed learning sources: task reports, documents, attachments, run summaries, named artifacts, or none.
- Do-not-learn list: client facts, privileged strategy, confidential source text, local paths, credentials, private URLs, account IDs, matter identifiers, and any task-specific exclusions.
- No cross-matter inspection: do not inspect or use files outside the approved scope unless the task explicitly permits a named path.
- Hard-gate approvals already granted: the active approval profile plus any specific external side effect, authentication/payment/legal-authority expansion, or destructive/protected mutation explicitly approved for this task.

Supervisor delegation requirements:

- Use Light Intake Mode for vague user requests, monitor findings, and first-pass matter triage. Start from the least intrusive approved source set and ask only for the next decision needed.
- If a contract field is missing, ask one natural-language question or offer 2-3 concrete choices instead of returning the full checklist to the lawyer.
- Start every live matter workflow from one parent tasks assigned to Legal Ops Supervisor.
- Complete read-only intake before implementation delegated tasks are created when the workflow requires matter selection or source scoping.
- Use `references/matter-planning-playbook.md` to classify all plausible workstreams before delegating isolated delegated tasks from a new event.
- Use `references/matter-context-artifacts.md` to pass only the context index and role-relevant artifacts each child needs.
- Create delegated tasks dynamically from the matter record; do not rely on import-time MTC starter tasks.
- Set `parentId` on every delegated task to the Legal Ops matter record.
- Assign each delegated task to the correct specialist agent.
- Include the full Matter Safety Contract or a focused subset that includes every field needed for the delegated task.

Checkpoint policy:

- Green actions proceed autonomously and are logged: reading approved sources, creating new output-root artifacts, OCR sidecars, source indexes, draft text, QA notes, research logs from supplied sources, and proposed calendar tables.
- Yellow escalations go to Legal Ops Supervisor when the matter record already authorizes the needed cure: routing, internal scope clarification, delegated task contract repair, or source ambiguity that does not require new external action.
- Hard gates require supervising-attorney approval before action: external side effects; authentication, payment, or legal-authority expansion; and destructive or protected mutation. Use `skills/ca-subpoena-mtc-autonomous-runner/references/human-approval-gates.md` as the canonical matrix.
- Local/source-bound work, output-root artifacts, new output-root working copies, draft recommendations, QA findings, task updates, and internal routing proceed without human approval when the approved source scope and output root are clear. `sandbox_autopilot` is a label for local non-client-facing testing, not the only low-friction path.
