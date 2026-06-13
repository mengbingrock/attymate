---
schema: agentcompanies/v1
kind: task
slug: configure-docket-monitoring
name: Configure Docket monitoring
assignee: docket-agent
project: firm-onboarding
priority: medium
---

Initialize the Docket Agent: scan the available court/portal connections, list them for the user, and confirm which one the user selects to monitor.

Once the user confirms the docket selection, propose or create a Paperclip routine assigned to `docket-agent` with status `paused` until the board/operator enables it. Use `coalesce_if_active` and `skip_missed`. The routine output must follow `references/monitoring-report-contract.md` and report findings to Legal Ops Supervisor.

Docket monitoring is public and read-only by default. Do not cross login, CAPTCHA, payment, paid retrieval, download, filing, service, email, or calendar-write gates without visible approval on the issue.
