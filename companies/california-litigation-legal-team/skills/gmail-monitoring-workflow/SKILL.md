---
name: gmail-monitoring-workflow
description: Use when a Paperclip Gmail monitor agent reviews an authorized Gmail scope for legal intake, deadline cues, assignment signals, or matter-routing signals. Do not use to send, reply, forward, label, archive, delete, mark read/unread, download attachments, authenticate, calendar deadlines, draft legal work, or inspect mailbox areas outside the proper Gmail plugin's approved scope.
---

# Gmail Monitoring Workflow

## Paperclip Role

Use this skill from the Gmail Monitor Agent or a supervisor-delegated mailbox-monitoring child issue. The skill is deployment-safe: it contains no account identifiers, search terms, sender names, labels, client facts, case numbers, or firm-private mailbox details. Deployment-specific scope comes from the issue, Firm Operations Guide, and the proper Gmail plugin configuration.

## Issue Context

Use whatever scope hints the issue, supplied guide excerpt, and proper Gmail plugin configuration provide, such as account or mailbox scope, allowed queries, labels, exclusions, message count, lookback period, dedupe policy, redaction policy, and routing criteria. When a hint is absent, proceed with the proper Gmail plugin's default authorized scope.

## Heartbeat Workflow

1. Checkout the assigned issue before doing substantive work.
2. Read the issue body, comments, parent issue, and proper Gmail plugin configuration.
3. Use the proper Gmail plugin to search the mailbox for candidate signals.
4. Review the metadata and snippets or body text needed to classify candidate signals.
5. Apply dedupe before routing or commenting.
6. Create or update a routed issue for Legal Ops Supervisor when a candidate signal is found.
7. Post a monitor outcome with source-bound facts and recommended next routing.

## Inputs And Outputs

Inputs are the approved Gmail plugin configuration, authorized Gmail metadata, and authorized snippets or body text necessary for the run. Outputs are limited to redacted monitor outcomes, missing-input lists, and routed Legal Ops Supervisor issues.

When routing a candidate, include only source-bound facts allowed by the redaction policy: sender category or redacted sender, date/time, thread or message reference, redacted subject summary, assignment or deadline cues, missing inputs, and recommended next routing. Do not store full message bodies, account identifiers, personal names, client facts, case numbers, or private mailbox details in public package files or reusable skills.

## Tool Policy

Use the proper Gmail plugin to read the mailbox and classify candidate signals. Prefer metadata and snippets before body text.

## Handoff Rules

Route candidate signals to Legal Ops Supervisor. Mark done after posting the run outcome and any candidate routing action.
