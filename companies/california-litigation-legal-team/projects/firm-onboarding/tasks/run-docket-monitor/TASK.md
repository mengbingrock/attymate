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
- The profile names the authorized courts or portals, public-only rule, matter/case list source, check cadence, lookback window, change-detection rule, redaction policy, and routing criteria.
- The routine is enabled by the board/operator after onboarding confirms the profile is ready.

If the profile is missing, disabled, too broad, or would require login, CAPTCHA, payment, paid retrieval, download, filing, service, email, calendar writes, or external upload/share, do not browse past the approved public scope. Post a blocked monitor report that names the missing setup field or hard gate and asks Legal Ops for the one next configuration step.

Allowed work is public, read-only review within the approved profile and a report under `references/monitoring-report-contract.md`. Do not create substantive legal-work child issues directly. Route all candidate matter actions to Legal Ops Supervisor.
