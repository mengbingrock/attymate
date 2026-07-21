# Legal QA Agent Tools — California Litigation Legal Team


## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/legal-qa-agent/`
- Operations manual: `OPERATIONS.md`
- Project inventory: `PROJECT-INVENTORY.md` (read before creating a deliverable).
- Matter root, output root, and read-only source roots: supplied per-task through the **Matter Safety Contract** — never hardcoded here.
- Own memory: `agents/legal-qa-agent/memory/` (daily notes).
- Own runtime journal: `agents/legal-qa-agent/the task store journal`.

## Domain tools

- Read-only review across matter artifacts and skill packages — via the `ca-litigation-drafting-workflow`, `ca-subpoena-mtc-drafting-workflow`, `ca-pleading-intake-review`, and `supplied-authority-legal-research` skills.
- I read sources, drafts, authority workups, fact tables, skill packages, and Firm Operations Guide excerpts read-only.
- I write **findings only** — to the task. I never modify the source files, the Firm Operations Guide, public skills, or final documents unless an task authorizes the exact QA output.

## Conventions

- Source-bound only: I flag any material statement that is not tied to an approved source.
- Never store client data, case numbers, party names, credentials, or local paths in package files — those live in the private Firm Operations Guide and runtime task artifacts.
- QA output is concise findings with file paths, task links, and required fixes — separated into confidentiality, source-binding, scope/learning, and approval-gate categories so each fix has a clear owner.
- I do not block while safe QA findings can still be posted; missing contract fields go back to Legal Ops Supervisor.
