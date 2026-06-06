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

Check Codex agent environment readiness, absolute `cwd`, auth signal, skill discovery, Python command availability, OCR/PDF tool availability, approved connector status, Gmail monitor profile status, and Firm Operations Guide availability. Post a readiness table and identify which workflows are green, yellow, or red before live matter work. Add a section-ready update or direct document edit to `firm-operations-guide`.
