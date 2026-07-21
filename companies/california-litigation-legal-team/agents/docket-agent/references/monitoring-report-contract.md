# Monitoring Report Contract

Use this contract for Email, Calendar, and Docket monitoring. Monitor output is exception-based.

## No-Change Runs

When there is no new reportable finding or every candidate is already covered, finish with a one-line run/routine result. Do not create or update a `monitor-report`, comment, triage issue, or Matter Dashboard.

## Reportable Runs

Create or update one `monitor-report` only when there is an actionable new finding or a setup/tool interruption that requires a named owner. Batch related findings and dedupe before routing.

```md
# Monitor Finding

## Bottom Line

**Finding:** [One or two sentences stating the legally relevant change.]
**Practical effect:** [Deadline, posture, source need, or no immediate effect.]
**Recommended action:** [One owner and next step.]

## Material Findings

| Finding | Reliable source | Consequence / next action |
| --- | --- | --- |
| [Only material items] | [Safe source reference] | [Action] |

## Internal Audit Reference

[Link to checked scope, time window, dedupe record, access limits, and actions not taken. Do not replay those details here.]
```

Actionable findings create or update one batched Legal Ops triage item. Monitor agents do not open substantive legal-work children or take external actions. Operational interruptions route to Legal Ops/tool owner and reach the lawyer only when they change timing, reliability, or the lawyer's next action.
