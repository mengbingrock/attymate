# Monitoring Report Contract

Use this contract for Email, Calendar, and Docket monitor routine outputs. A monitor report is a routed finding for Legal Ops Supervisor, not substantive legal work.

Every monitor run must leave a durable task artifact with key `monitor-report`. Do not rely on comments alone for the report. If the monitor finds actionable candidates, batch them in the report and create or update one non-substantive Legal Ops triage packet after dedupe. Monitor agents still do not create substantive legal-work delegated tasks directly.

## Required Fields

Use this compact lawyer-first format:

```md
# Monitor Report

## Summary

**Result:** [No reportable findings / new finding / duplicate / blocked by setup.]
**Bottom line:** [1-2 plain-English sentences.]
**Recommended next action:** [Dismiss, update matter, create/update Legal Ops triage, ask one approval/source question.]

## Findings

| Finding | Source | Suggested Legal Ops action |
| --- | --- | --- |
| [Finding or no findings] | [Safe source reference] | [Action] |

## Dedupe

[New / already reported / possible duplicate, with linked task if known.]

## Audit Details

- Monitor type: `email`, `calendar`, or `docket`.
- Profile reference: Firm Operations Guide section or task-document reference.
- Routine reference: routine name or ID, run time, and assigned monitor agent.
- Checked scope and time window.
- Evidence reviewed: concise list of message/thread/conversation/attachment types, calendar event/detail/attachment types, or docket entry/public-document types reviewed. Do not paste raw private content.
- Deadline cues are proposed only, with source reference and uncertainty noted.
- Hard gates requested, if any: auth, external download, paid retrieval, mailbox write, calendar write, filing, service, signing, email, or other approval.
- Actions not taken: only list hard-gate actions that might be expected for this monitor.
```

Keep the summary and findings short. Move technical scope, preconditions, and hard-gate confirmations to `Audit Details`.

## Handoff Rule

All monitor findings go to Legal Ops Supervisor.

- No reportable findings: write `monitor-report`, mark the monitor task done, and do not create a triage task.
- Duplicate findings: write `monitor-report`, link the prior task or matter, and avoid creating a duplicate unless Legal Ops needs a dedupe audit task.
- Actionable findings: write `monitor-report`, dedupe against open/recent matter parents and monitor candidates, then create or update one batched Legal Ops triage task with the report linked. Do not open one triage task per minor cue unless each cue maps to a different matter or a distinct substantive workstream.
- Setup/profile blockers: write `monitor-report`, ask for one setup decision, and set the monitor task to `blocked` only if no pending interaction or Legal Ops triage path exists.

Monitor agents do not create substantive matter delegated tasks, calendar entries, docket purchases, email replies, filing/service actions, or legal drafts unless Legal Ops creates a scoped task and the required approval profile and gate approvals are visible.
