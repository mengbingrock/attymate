---
schema: agentcompanies/v1
kind: task
slug: configure-agent-runtime
name: Configure Codex and Paperclip agent runtime
assignee: legal-ops-supervisor
project: firm-onboarding
priority: high
---

Create a private Firm Environment Profile section for agent runtime.

Confirm each agent's `codex_local` configuration has an absolute `cwd`, model, timeout, grace period, and approved auth mechanism. Verify Codex CLI availability, authentication signal, skill discovery, and a hello probe before live matter work. Use Paperclip secret references for sensitive environment values.
