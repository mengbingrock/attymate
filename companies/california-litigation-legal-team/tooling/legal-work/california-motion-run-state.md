# Run State

After implementation is authorized, maintain durable state in Paperclip and, when approved, a matter-local run-state artifact under `{output_root}`.

Recommended fields:

- Parent issue and child issue IDs.
- Parent Matter Authorization Package reference and child exceptions, if any.
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
- Last heartbeat summary.
- Next recommended action.

Do not create run-state files during read-only planning. Do not store client facts in reusable company package files.
