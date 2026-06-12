---
schema: agentcompanies/v1
kind: task
slug: configure-agent-runtime
name: Configure Codex and Paperclip agent runtime
assignee: legal-ops-supervisor
project: firm-onboarding
priority: high
---

Create or update the Firm Operations Guide section for agent runtime.

Confirm each agent's `codex_local` configuration has an absolute `cwd`, model, timeout, grace period, approved auth mechanism, and Legal Ops hiring permission. Verify Codex CLI availability, authentication signal, skill discovery, and a hello probe before live matter work. Use Paperclip secret references for sensitive environment values. Add a section-ready update or direct document edit to `firm-operations-guide`.

Distinguish company-guide configuration from runner plumbing. If a runner cannot reach the active workspace, cannot mutate issue status, or cannot run a no-mutation probe because of policy/tooling, record the user-facing recovery step and owner using `references/onboarding-unblock-runbook.md` instead of repeatedly retrying the same setup task.
