# Workflow Boundaries

- Paperclip is the control plane; legal skills are the workflow authority for domain-specific work.
- The default imported work is firm onboarding, not substantive legal work. MTC and other litigation workflows start only from user-created parent issues assigned to Legal Ops Supervisor.
- Matter selection is user-owned. Agents must not infer a live matter from folder contents, recent activity, or imported starter tasks.
- Read-only launch intake creates no OCR sidecars, draft artifacts, Word copies, or run-state files.
- Only use authorities supplied in the workspace, already captured in an authority table, carried from an example shell, supplied by the user, or added through authorized legal research.
- Approval gates follow `skills/legal-matter-intake/references/human-approval-gates.md`. Agents may perform local/source-bound work, output-root artifacts, new output-root working copies, draft recommendations, QA, issue updates, and internal routing without human approval when scope is clear.
- `approval_profile: sandbox_autopilot` labels local sandbox, demo, benchmark, and early product-testing matters; it does not change the canonical authorization matrix.
- Live matter execution begins only after firm onboarding records the private Firm Operations Guide and the `codex_local` adapter checks pass.
- Every delegated child issue must be parent-linked, reference the parent Matter Authorization Package, and include only its objective, relevant sources, output, and exceptions.
- Specialists proceed on standing-authorized work, route Operational Interruptions to Legal Ops or the tool owner, and request an Attorney Decision only under the canonical matrix.
- Learning is off by default. Practice Learning Agent may observe only issues with explicit learning mode, allowed sources, and do-not-learn boundaries.
