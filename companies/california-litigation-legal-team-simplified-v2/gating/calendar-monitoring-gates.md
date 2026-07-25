# Calendar monitoring gating criteria

Calendar monitoring is read-only.

## Green (allowed inside the approved profile)

- event title/body/description/location/attendees/recurrence/notes
- event attachments or linked files, when the profile authorizes them
- proposed deadline tables, when the triggering facts and policy source are supplied

## Hard gates (require visible approval on the issue)

- create / update / delete calendar entries
- invites or notifications
- email
- inspecting calendars, events, attendees, or private notes outside the approved profile

If the profile or a live provider connector is missing, stop with a setup checklist — or report `setup-ready / pending connector` or manual-source mode — rather than inspecting calendars.
