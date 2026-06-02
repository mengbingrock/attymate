---
schema: agentcompanies/v1
kind: company
slug: california-litigation-legal-team
name: California Litigation Legal Team
description: Paperclip company for reusable California litigation workflows with supervised issue scope, approvals, and specialist agents.
version: 0.3.0
license: MIT
goals:
  - Coordinate reusable California litigation workflows through Paperclip issues, approvals, budgets, and Codex local agents.
  - Complete deployment onboarding before live matter work so local tools, workspace structure, external connectors, and approval policy are explicit.
requirements:
  runtime:
    - Paperclip with codex_local adapter support.
    - Authenticated Codex CLI or an approved deployment-specific API-key auth mechanism.
    - Python and OCR/PDF tooling configured through a private runtime environment profile.
    - Matter and output paths supplied at runtime through issue contracts.
includes:
  - agents/legal-ops-supervisor/AGENTS.md
  - agents/source-intake-agent/AGENTS.md
  - agents/facts-evidence-agent/AGENTS.md
  - agents/legal-research-agent/AGENTS.md
  - agents/drafting-assembly-agent/AGENTS.md
  - agents/docket-agent/AGENTS.md
  - agents/calendar-agent/AGENTS.md
  - agents/notebooklm-kb-agent/AGENTS.md
  - agents/legal-qa-agent/AGENTS.md
  - agents/practice-learning-agent/AGENTS.md
  - projects/firm-onboarding/PROJECT.md
  - skills/legal-calendaring-workflow/SKILL.md
  - skills/lexis-browseros-legal-research/SKILL.md
  - skills/ca-litigation-drafting-workflow/SKILL.md
  - skills/ca-pleading-intake-review/SKILL.md
  - skills/docling-pdf-processing/SKILL.md
  - skills/lasc-browseros-docket-check/SKILL.md
  - skills/notebooklm-legal-kb/SKILL.md
  - skills/ca-subpoena-mtc-autonomous-runner/SKILL.md
  - skills/ca-subpoena-mtc-drafting-workflow/SKILL.md
  - skills/practice-workflow-learning/SKILL.md
---

# California Litigation Legal Team

This Paperclip company packages reusable California litigation workflows into a legal-team org chart. Paperclip owns coordination: onboarding issues, live matter issues, child issues, agent assignment, heartbeats, approvals, and audit trail. The legal skills own domain workflow discipline.

Productized skills in this package must not include client confidentiality, firm-specific procedures, private URLs, credentials, account details, or hardcoded local paths. Deployment-specific behavior belongs in runtime issue contracts, deployment profiles, or local adapter configuration.

The default imported project is firm onboarding. It helps the board configure workspace structure, Codex/Paperclip runtime, Python/OCR tools, external connectors, firm SOPs, templates, matter mapping, approval policy, and learning policy before live matter work.

The subpoena MTC workflow remains available as a specialized skill-triggered workflow inside the broader litigation team. It is handled by Legal Ops Supervisor and the unified specialists, not by an import-time MTC project or separate MTC sub-organization. Live MTC work must begin from a user-created parent issue assigned to Legal Ops Supervisor with matter selection, explicit source/output scope, autonomy level, learning mode, and red-gate approvals.
