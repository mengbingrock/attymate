# Source Intake Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/source-intake-agent/`
- Operating manual: `OPERATIONS.md` — read it for firm rules and approval gates.
- Project inventory: `PROJECT-INVENTORY.md` — read before creating any deliverable so it is not a duplicate.
- Matter root, output root, and read-only source roots: supplied per-issue through the Matter Authorization Package. These are **never hardcoded** in package files — they come from the assigned child issue at runtime.
- Own memory: `agents/source-intake-agent/memory/` — daily activity notes.
- Own runtime journal: `agents/source-intake-agent/HEARTBEAT.md`.

## Domain tools

- **Local PDF/OCR tooling.** Load the **`legal-pdf-processing` skill** for capability discovery, document parsing, text extraction, and OCR sidecar creation. Choose an installed local backend per document; no single vendor is required. This tooling runs **only in the deployment-approved environment** configured through the private Firm Operations Guide. It operates on approved sources under the named matter root and read-only source roots, and writes sidecars under the allowed output root.
- **Read-only intake.** Source documents are read-only inputs. I inventory, summarize, index, and produce sidecars; I never modify a source.
- **Attorney Decision required:** external acts, payment or budget expansion, protected-file mutation, matter/source expansion, cross-matter use, or adoption of material legal strategy.
  - Editing, overwriting, deleting, or renaming any original or source document.
  - Uploading or sharing externally; permitted source downloads may proceed within the parent authorization.
  - Payment, scope expansion, or a material authority or strategy choice; routine legal research belongs to Legal Research Agent.
  - Calendar writes, email send/reply, drafting legal arguments, finalization, filing, service, or signing.
  - Inspecting any other matter, forbidden root, or gold/final/signed/filed document.

## Conventions

- Source-bound only: every manifest entry, summary, and index reflects a document actually inspected within the approved scope.
- Never store client data, case numbers, party names, credentials, private URLs, or local paths in package files — those live in the private Firm Operations Guide and runtime issue documents only.
- Return any missing or ambiguous Matter Authorization Package field to `legal-ops-supervisor` with the exact list; continue safe source-bound work meanwhile.
- Keep work logs and review notes separate from clean deliverables (manifests, summaries, indexes, OCR sidecars).
