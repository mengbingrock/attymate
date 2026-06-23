# Human Approval Gates

Use this checkpoint matrix to reduce unnecessary blocks while preserving external-action, legal-authority, and file-safety controls.

## Approval Profiles

Unless a parent issue states otherwise, use the relaxed default matrix below.

Use `approval_profile: sandbox_autopilot` for local sandbox, demo, benchmark, and early product-testing matters so reports clearly label the work as non-client-facing test output. This profile uses the same hard gates as the relaxed default matrix, but it also reminds agents that outputs are not attorney-final, client-facing, filed, served, signed, uploaded, or shared.

Proceed without asking for:

- Reading approved local or test source roots.
- Creating new artifacts under `{output_root}`.
- Local OCR, Docling, extraction, and sidecar generation from approved local sources.
- Source, exhibit, objection, replacement, chronology, authority, QA, benchmark, and demo tables.
- Draft text, memos, proposed orders, declarations, and working-copy drafts created as new artifacts under `{output_root}`.
- Research logs and citation workups from supplied authorities.
- Proposed calendar and deadline tables that do not write to a real calendar.
- Read-only review inside an approved monitor profile, including in-scope email message bodies, thread/conversation context, metadata, authorized attachment contents, calendar event details and event attachments/links, public docket entries, and free public docket documents.
- Public read-only browser checks and free public docket documents inside the approved public scope, when they do not require login, CAPTCHA, payment, upload, sharing, filing, or service.
- Parent-linked child issue creation, issue comments, status updates, review packets, and run-state updates.
- Strategy, relief, risk, sanctions, privacy, or protective-order analysis as draft recommendations only.

Stop only for these hard gate categories:

1. External side effects and system writes: email send/reply/forward, mailbox mutation, calendar writes/invites/notifications, filing, service, signing, external upload, external sharing, or public posting.
2. Irreversible or source-mutating actions: delete, overwrite, rename, mutate original sources, mutate final/signed/filed/served/user-edited documents, or edit active Word/Google Docs in place unless the issue explicitly names that document as the target.
3. Authentication, payment, or legal-authority expansion: login, MFA, CAPTCHA, paid retrieval, Lexis, new external legal research, external downloads outside the approved public/read-only scope, or adding new legal authorities not supplied in the test package.

## Green Actions

Proceed and log:

- Reading approved source roots.
- Creating new artifacts under `{output_root}`.
- OCR sidecars from approved local sources.
- Source, exhibit, objection, replacement, chronology, authority, and QA tables.
- Draft text from approved sources and authorities.
- New working-copy drafts created under `{output_root}`.
- Research logs from supplied authorities.
- Strategy, relief, sanctions, privacy, or protective-order analysis as draft recommendations.
- Read-only monitor reports from approved email, calendar, or docket profiles.
- Proposed child issue descriptions and status summaries.

## Yellow Escalations

Route to Legal Ops Supervisor, but continue safe work where possible:

- Child issue missing a curable scope detail.
- Source ambiguity that does not require new external access.
- Conflicting examples or prior drafts.
- Internal routing, budget, or sequencing issues.
- Questions that can be batched into the next review packet.

## Hard Gates

Request board/user approval before action:

- External side effects and system writes: email send/reply/forward, mailbox mutation, calendar writes/invites/notifications, filing, service, signing, external upload, external sharing, or public posting.
- Authentication, payment, or legal-authority expansion: login, MFA, CAPTCHA, paid retrieval, Lexis, new external legal research, external downloads outside the approved public/read-only scope, or adding new legal authorities not supplied or already approved.
- Destructive or protected mutation: delete, overwrite, rename, mutate original sources, mutate final/signed/filed/served/user-edited documents, or edit active Word/Google Docs in place unless the issue explicitly names that document as the target.

Approval requests should state the hard gate, recommended action, options, risk, affected artifacts, and safe work that can continue. Draft recommendations are allowed; adopting them through an external action or protected mutation is gated.
