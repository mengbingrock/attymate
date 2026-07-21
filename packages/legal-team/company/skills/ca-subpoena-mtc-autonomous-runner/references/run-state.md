# Run State

After implementation is authorized, maintain durable state in the pi orchestrator and, when approved, a matter-local run-state artifact under `{output_root}`.

Recommended fields:

- Matter record and delegated task IDs.
- Matter Safety Contract summary.
- Firm Operations Guide reference.
- Current phase.
- Approved source roots.
- Output root.
- Red gates approved.
- Red gates pending.
- Assumptions log.
- Unresolved-input list.
- Artifact index.
- Authority status.
- Draft status.
- QA status.
- Last session journals summary.
- Next recommended action.

Do not create run-state files during read-only planning. Do not store client facts in reusable company package files.
