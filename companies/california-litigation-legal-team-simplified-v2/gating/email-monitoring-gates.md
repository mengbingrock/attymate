# Email monitoring gating criteria

Email monitoring is read-only.

## Green (allowed inside a complete approved profile)

- matching message bodies
- thread/conversation context
- metadata
- attachment contents, when the profile authorizes them

## Hard gates (require visible approval on the issue)

- sending / replying / forwarding
- labels / categories / archive / trash / delete
- mark read/unread
- external forwarding or share
- any mailbox mutation
- saving attachments outside the approved reporting/workspace flow
- uploading content, creating calendar entries, filing, serving, signing, or drafting legal work product

If connector access, auth, or scope is missing, stop with a setup checklist rather than reviewing email.
