# Onboarding Unblock Runbook

Use this runbook when an onboarding task appears blocked by workspace, runner, or status-update plumbing instead of the legal-company setup work itself. Keep the explanation user-facing: say what is complete, what is technical, and whether the user needs to act.

## Workspace mismatch

- Treat the active AttyMate WORKSPACE folder as the deployment source of truth.
- If a run reports a missing or cross-machine workspace path, stop before inspecting source files or creating matter work.
- Ask the operator to open AttyMate -> WORKSPACE and choose a reachable local folder, then record that folder only in the private Firm Operations Guide.
- Do not copy stale paths from previous runs into the reusable company package or into new guide sections.
- Once the active workspace and guide agree, do not keep blocking on older historical paths.

## Runner and tool checks

- Separate missing tools from blocked probes. A denied no-mutation probe is a runtime/policy task, not proof that the tool is absent.
- Record the exact denied probe, the owner who can unblock it, and the safe next action.
- If the guide section can be completed from available evidence, complete it and mark the remaining probe as yellow or red in readiness instead of rerunning the same setup task.

## Disposition and retry loops

- A completed onboarding task should end with an explicit terminal disposition: `done`, `blocked`, or `in_review`.
- If direct the pi orchestrator status update is unavailable, post a final comment that starts with `Disposition: done` or `Disposition: blocked`, explains the evidence, and names any product/tooling owner.
- Do not rerun implementation only because task-status mutation failed. Repeated successful runs with the same final comment are a control-plane task, not more company setup work.
- If the only remaining problem is task-status mutation, tell the user that no lawyer action is needed and route the problem to the the pi orchestrator/AttyMate product owner.

## Readiness smoke interpretation

- Green: the workspace exists, guide sections are current, required auth/tool probes pass, and no hard-gate approval is pending.
- Yellow: setup is usable for limited task-comment or supplied-source work, but a connector, optional tool, or policy probe still needs owner action.
- Red: live matter work would be unsafe because workspace, auth, source scope, output scope, or approval policy is missing.
- Historical stale paths, denied optional probes, or completed-work status plumbing should be recorded as technical follow-up, not as a reason to ask the user to rerun completed onboarding tasks.
