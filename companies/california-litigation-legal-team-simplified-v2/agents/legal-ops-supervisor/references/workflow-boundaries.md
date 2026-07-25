# Workflow Boundaries

- The control plane owns coordination; legal skills are the workflow authority for domain-specific work.
- The default imported work is firm onboarding, not substantive legal work. MTC and other litigation workflows start only from user-created parent issues assigned to Legal Ops Supervisor.
- Matter selection is user-owned. Agents must not infer a live matter from folder contents, recent activity, or imported starter tasks.
- Read-only launch intake creates no OCR sidecars, draft artifacts, Word copies, or run-state files.
- Only use authorities supplied in the workspace, already captured in an authority table, carried from an example shell, supplied by the user, or added through authorized legal research.
- Approval gates follow `gating/human-approval-gates.md`. Agents may perform local/source-bound work, output-root artifacts, new output-root working copies, draft recommendations, QA, issue updates, and internal routing without human approval when scope is clear.
- `approval_profile: sandbox_autopilot` labels local sandbox, demo, benchmark, and early product-testing matters. It uses the same three canonical hard gate categories as the relaxed default matrix.
- Live matter execution begins only after firm onboarding records the private Firm Operations Guide and the `codex_local` adapter checks pass.
- Every delegated child issue must be parent-linked to the Legal Ops parent issue and must include the required Matter Safety Contract fields.
- Specialist agents should proceed with green safe work when scope is sufficient, route yellow issues back to Legal Ops Supervisor, and stop only at hard gates or true missing inputs.
- Learning is off by default. Practice Learning Agent may observe only issues with explicit learning mode, allowed sources, and do-not-learn boundaries.
