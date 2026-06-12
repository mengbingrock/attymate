# Human Approval Gates

Use this checkpoint matrix to reduce unnecessary blocks while preserving legal and file-safety controls.

## Approval Profiles

Unless a parent issue states otherwise, use the standard green/yellow/red matrix below.

Use `approval_profile: sandbox_autopilot` only for local sandbox, demo, benchmark, and early product-testing matters. This profile grants one blanket approval for non-client-facing local work inside the approved source scope and `{output_root}`. It should not be used for live client work, attorney-final work product, or production filing workflows.

In `sandbox_autopilot`, continue without asking for:

- Reading approved local or test source roots.
- Creating new artifacts under `{output_root}`.
- Local OCR, Docling, extraction, and sidecar generation from approved local sources.
- Source, exhibit, objection, replacement, chronology, authority, QA, benchmark, and demo tables.
- Draft text, memos, proposed orders, declarations, and working-copy drafts created as new artifacts under `{output_root}`.
- Research logs and citation workups from supplied authorities.
- Proposed calendar and deadline tables that do not write to a real calendar.
- Public read-only browser checks that do not require login, CAPTCHA, payment, download, upload, sharing, filing, or service.
- Parent-linked child issue creation, issue comments, status updates, review packets, and run-state updates.
- Strategy, relief, risk, sanctions, privacy, or protective-order analysis as draft recommendations only.

In `sandbox_autopilot`, stop only for the three hard gate categories:

1. External side effects: email send/reply, calendar writes/invites/notifications, filing, service, signing, external upload, external sharing, or public posting.
2. Irreversible or source-mutating actions: delete, overwrite, rename, mutate original sources, mutate final/signed/filed/served/user-edited documents, or edit active Word/Google Docs in place unless the issue explicitly names that document as the target.
3. Authentication, payment, or legal-authority expansion: login, MFA, CAPTCHA, paid retrieval, Lexis, new external legal research, external downloads, or adding new legal authorities not supplied in the test package.

## Green Actions

Proceed and log:

- Reading approved source roots.
- Creating new artifacts under `{output_root}`.
- OCR sidecars from approved local sources.
- Source, exhibit, objection, replacement, chronology, authority, and QA tables.
- Draft text from approved sources and authorities.
- Research logs from supplied authorities.
- Proposed child issue descriptions and status summaries.

## Yellow Escalations

Route to Legal Ops Supervisor, but continue safe work where possible:

- Child issue missing a curable scope detail.
- Source ambiguity that does not require new external access.
- Conflicting examples or prior drafts.
- Internal routing, budget, or sequencing issues.
- Questions that can be batched into the next review packet.

## Red Gates

Request board/user approval before action:

- External auth, external research, new authorities, external uploads, external downloads, paid retrieval, browser login, email, calendar writes, filing, service, signing, finalization, active Word writes, overwrite, delete, rename, source mutation, strategy changes, relief changes, sanctions changes, privacy treatment, protective-order changes, or conflicting controlling drafts.

Approval requests should state the gate, recommended action, options, risk, affected artifacts, and safe work that can continue.
