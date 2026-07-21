# Gmail Toolkit (local, Composio-style)

A minimal, real Gmail integration that talks to Google's Gmail REST API directly
with **your own OAuth credentials**. Two tools, same slugs / inputs / output
envelope as Composio:

- `GMAIL_SEND_EMAIL` — actually sends mail (`users.messages.send`)
- `GMAIL_FETCH_EMAILS` — lists + hydrates messages

```python
from gmail_toolkit import GmailToolkit
tk = GmailToolkit()
tk.execute("GMAIL_SEND_EMAIL", {"recipient_email": "you@example.com",
                                "subject": "Hi", "body": "Sent locally."})
# -> {"data": {...}, "error": None, "successful": True}
```

## Files

| File | Purpose |
|---|---|
| `gmail_toolkit.py` | The toolkit + `execute()` dispatch. |
| `send_test.py` | `python send_test.py <recipient>` — send one real email. |
| `requirements.txt` | Pinned Google API deps. |
| `.venv/` | Local virtualenv (already created, deps installed). |
| `credentials.json` | **You provide** — OAuth client (see below). Gitignored. |
| `token.json` | Auto-written after first consent. Gitignored. |

## One-time setup — grant the app access to your Google Account data

The toolkit acts as a **Desktop OAuth app**. On first run Google shows a consent
screen — *"AttyMate Gmail Toolkit wants access to your Google Account"* listing
the Gmail permissions below. You approve it once; a refresh token is cached in
`token.json` so later runs are non-interactive.

### 1. Create a Google Cloud project + enable Gmail API
1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → Library → Gmail API → Enable**.

### 2. Configure the OAuth consent screen
1. **APIs & Services → OAuth consent screen**.
2. User type **External** → Create. Fill app name ("AttyMate Gmail Toolkit"),
   your support + developer email.
3. **Scopes** — you can leave this blank here; the app requests them at runtime.
   (For reference the app asks for:)
   - `https://www.googleapis.com/auth/gmail.send` — *Send email on your behalf*
   - `https://www.googleapis.com/auth/gmail.readonly` — *Read your email*
4. **Test users → Add users**: add the exact Google account you'll authorize
   (e.g. `edutok00@gmail.com`). While the app is in "Testing", only listed test
   users can consent — this is the intended "some apps have access to your
   Google Account data" state without going through Google verification.

### 3. Create the OAuth client (credentials.json)
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type **Desktop app** → Create.
3. **Download JSON** and save it here as `gmail-toolkit/credentials.json`.

### 4. First run → approve the consent screen
```sh
cd gmail-toolkit
./.venv/bin/python gmail_toolkit.py          # fetches 5 unread (read test)
# or send a real email:
./.venv/bin/python send_test.py you@example.com "Test" "Hello"
```
A browser opens → pick the test-user account → *"Google hasn't verified this
app"* → **Continue** → check the Gmail permissions → **Continue**. `token.json`
is written; you won't be prompted again until it's revoked/expired.

## Managing / revoking access later

See and revoke what this app can touch at
<https://myaccount.google.com/connections> (or *Google Account → Data & privacy
→ Third-party apps & services*). Delete `token.json` to force re-consent.

## Notes

- **Scopes are least-privilege**: only `gmail.send` + `gmail.readonly`. Add more
  (e.g. `gmail.modify`) only if you extend the toolkit — changing `SCOPES`
  invalidates the cached token and forces re-consent.
- `credentials.json` and `token.json` are secrets and are gitignored. Never
  commit them.
- Python 3.9 works but is EOL; 3.11+ is recommended (the deps print a warning
  on 3.9, otherwise harmless).
