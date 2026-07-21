---
schema: agentcompanies/v1
kind: task
slug: run-environment-readiness-smoke
name: Run local environment readiness smoke test
assignee: legal-ops-supervisor
project: firm-onboarding
priority: high
---

Run a no-mutation readiness smoke test after workspace, runtime, tools, and connector statuses are recorded.

Check agent environment readiness, auth signal, skill discovery, Python command availability, OCR/PDF tool availability, configured connector status, Email/Calendar/Docket monitor profile status, imported monitor routine existence and paused/enabled state, schedule triggers, and Firm Operations Guide availability. Post a concise readiness table using `Ready`, `Limited`, or `Not ready`, name the owner of each Operational Interruption, and add a section-ready update or direct document edit to `firm-operations-guide`.

Use `references/onboarding-unblock-runbook.md` to classify technical findings. Do not fail readiness solely because stale historical paths appear in old runs or because a no-mutation probe is denied by runner policy; classify those as yellow or red with owner/action. If all implementation evidence is complete but issue status cannot be updated, post the terminal disposition and stop retrying.
