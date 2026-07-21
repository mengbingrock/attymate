---
schema: agentcompanies/v1
kind: task
slug: run-docket-monitor
name: Run Docket monitor
assignee: docket-agent
project: firm-onboarding
priority: medium
recurring: true
---

Run the approved public docket monitoring profile and report candidate matter changes to Legal Ops Supervisor.

Preconditions:

- `docket_monitor_profile` exists in the private Firm Operations Guide or the routine variables.
- The profile names the authorized courts or portals, public-only rule, authorized public-document access, matter/case list source, check cadence, lookback window, change-detection rule, redaction policy, and routing criteria.
- The routine is enabled by the board/operator after onboarding confirms the profile is ready.

If the profile is missing, disabled, or too broad, do not browse outside the approved public scope. For a configuration interruption that needs owner action, create or update one batched `monitor-report` naming the owner and next configuration step. Route login, CAPTCHA, and tool failure as Operational Interruptions. Payment, filing, service, sending, calendar writes, and external sharing require an Attorney Decision.

Allowed work is public, read-only review within the approved profile. Public docket pages, register-of-actions entries, hearing/status details, and free public docket documents may be reviewed when authorized. Dedupe before creating anything. If there is no new reportable finding, finish silently with a one-line run/routine result. If there is an actionable candidate, create or update one batched `monitor-report` and one Legal Ops triage item. Do not create substantive legal-work child issues directly.
