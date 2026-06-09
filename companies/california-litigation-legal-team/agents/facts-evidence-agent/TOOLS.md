# Facts & Evidence Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/facts-evidence-agent/`
- Operating manual: `OPERATIONS.md` — read it for firm rules and approval gates.
- Project inventory: `PROJECT-INVENTORY.md` — read before creating any deliverable so it is not a duplicate.
- Matter root, output root, and read-only source roots: supplied per-issue through the Matter Safety Contract. These are **never hardcoded** in package files — they come from the assigned child issue at runtime.
- Own memory: `agents/facts-evidence-agent/memory/` — daily activity notes.
- Own runtime journal: `agents/facts-evidence-agent/HEARTBEAT.md`.

## Domain tools

- **Filesystem and source-bound only — no external tools.** I read the approved matter root and read-only source roots, and I write factual narratives, exhibit lists, evidence/source crosswalks, citation tables, replacement tables, and fact-to-source maps under the allowed output root. I have no browser, no external research, no upload/download, and no email or calendar tooling. The `ca-litigation-drafting-workflow` and `ca-subpoena-mtc-drafting-workflow` skills supply the format discipline for these artifacts.
- **RED-GATED for this role (require visible Legal Ops / board approval before action):**
  - Overwriting, deleting, or renaming any file.
  - Uploading to or downloading from any external system.
  - Finalizing, filing, serving, or signing any document.
  - Email send/reply and calendar writes.
  - Using a gold/final/user-edited draft as a source unless the issue expressly designates it controlling.
  - Any external research, browser auth, paid retrieval, or new authority.
  - Inspecting any other matter or forbidden root.

## Conventions

- Source-bound only: every material fact, exhibit entry, and citation ties to a declaration, exhibit, source text, or approved intermediary artifact within scope — never to memory.
- Never store client data, case numbers, party names, credentials, private URLs, or local paths in package files — those live in the private Firm Operations Guide and runtime issue documents only.
- Return any missing or ambiguous Matter Safety Contract field to `legal-ops-supervisor` with the exact list; continue safe fact/evidence work meanwhile.
- Keep gap logs and work notes separate from clean deliverables (narratives, exhibit lists, crosswalks, citation tables, fact-to-source maps).
