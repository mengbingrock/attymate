# Monitoring Report Contract

Use this contract for Gmail, Calendar, and Docket monitor routine outputs. A monitor report is a routed finding for Legal Ops Supervisor, not substantive legal work.

## Required Fields

- Monitor type: `gmail`, `calendar`, or `docket`.
- Profile reference: Firm Operations Guide section or issue-document reference used for scope.
- Routine reference: routine name or ID when available, run time, and assigned monitor agent.
- Checked scope: mailbox query/labels, calendar set, or docket/court/case-list scope actually checked.
- Time window: lookback/lookahead period and run timestamp.
- Sources checked: message/thread references, event references, or docket/register references when safe to record.
- Lawyer summary: one plain-English sentence Legal Ops can paste or adapt into a Matter Status Digest.
- Findings: either `No reportable findings` or a concise list of source-bound findings.
- Recommended next action: one practical Legal Ops action, such as dismiss, update an existing matter, ask for approval, open a parent issue, or delegate a scoped child issue.
- Candidate Legal Ops actions: create parent issue, update existing issue, request approval, delegate to a specialist, dismiss/no action, or ask for missing input.
- Deadline cues: proposed only, with source reference and uncertainty noted.
- Dedupe result: new, already reported, or possible duplicate.
- Red gates requested: auth, external download, paid retrieval, mailbox write, calendar write, filing, service, signing, email, or other approval needed.
- Actions not taken: confirm no sends, replies, labels, archives, deletes, downloads, uploads, paid retrieval, calendar writes, filing, service, signing, cross-matter inspection, or substantive drafting occurred.

## Handoff Rule

All monitor findings go to Legal Ops Supervisor. Monitor agents do not create substantive matter child issues, calendar entries, docket purchases, email replies, filing/service actions, or legal drafts unless Legal Ops creates a scoped issue and the required red-gate approvals are visible.
