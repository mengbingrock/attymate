# Monitoring Report Contract

Use this contract for Gmail, Calendar, and Docket monitor routine outputs. A monitor report is a routed finding for Legal Ops Supervisor, not substantive legal work.

Every monitor run must leave a durable issue document with key `monitor-report`. Do not rely on comments alone for the report. If the monitor finds actionable candidates, batch them in the report and create or update one non-substantive Legal Ops triage packet after dedupe. Monitor agents still do not create substantive legal-work child issues directly.

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

[New / already reported / possible duplicate, with linked issue if known.]

## Audit Details

- Monitor type: `gmail`, `calendar`, or `docket`.
- Profile reference: Firm Operations Guide section or issue-document reference.
- Routine reference: routine name or ID, run time, and assigned monitor agent.
- Checked scope and time window.
- Deadline cues are proposed only, with source reference and uncertainty noted.
- Hard gates requested, if any: auth, external download, paid retrieval, mailbox write, calendar write, filing, service, signing, email, or other approval.
- Actions not taken: only list hard-gate actions that might be expected for this monitor.
```

Keep the summary and findings short. Move technical scope, preconditions, and hard-gate confirmations to `Audit Details`.

## Handoff Rule

All monitor findings go to Legal Ops Supervisor.

- No reportable findings: write `monitor-report`, mark the monitor issue done, and do not create a triage issue.
- Duplicate findings: write `monitor-report`, link the prior issue or matter, and avoid creating a duplicate unless Legal Ops needs a dedupe audit issue.
- Actionable findings: write `monitor-report`, dedupe against open/recent matter parents and monitor candidates, then create or update one batched Legal Ops triage issue with the report linked. Do not open one triage issue per minor cue unless each cue maps to a different matter or a distinct substantive workstream.
- Setup/profile blockers: write `monitor-report`, ask for one setup decision, and set the monitor issue to `blocked` only if no pending interaction or Legal Ops triage path exists.

Monitor agents do not create substantive matter child issues, calendar entries, docket purchases, email replies, filing/service actions, or legal drafts unless Legal Ops creates a scoped issue and the required approval profile and gate approvals are visible.
