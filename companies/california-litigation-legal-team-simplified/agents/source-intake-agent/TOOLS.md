# Source Intake Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/source-intake-agent/`
- Operating manual: `OPERATIONS.md` — read it for firm rules.
- Project inventory: `PROJECT-INVENTORY.md` — read before creating any deliverable so it is not a duplicate.
- Matter root, output root, and read-only source roots: supplied per-issue through the Matter Safety Contract. These are **never hardcoded** in package files — they come from the assigned child issue at runtime.
- Own memory: `agents/source-intake-agent/memory/` — daily activity notes.
- Own runtime journal: `agents/source-intake-agent/HEARTBEAT.md`.

## Domain tools

- **Docling / OCR / PDF tooling (local).** Load the **`docling-pdf-processing` skill** for document parsing, text extraction, and OCR sidecar creation. This tooling runs **only in the deployment-approved Python/OCR environment** configured through the private Firm Operations Guide. It operates on approved sources under the named matter root and read-only source roots, and writes sidecars under the allowed output root.
- **Read-only intake.** Source documents are read-only inputs. I inventory, summarize, index, and produce sidecars; I never modify a source.


## Conventions


- Never store client data, case numbers, party names, credentials, private URLs, or local paths in package files — those live in the private Firm Operations Guide and runtime issue documents only.
- Return any missing or ambiguous Matter Safety Contract field to `legal-ops-supervisor` with the exact list; continue safe source-bound work meanwhile.
- Keep work logs and review notes separate from clean deliverables (manifests, summaries, indexes, OCR sidecars).
