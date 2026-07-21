"""
gmail_toolkit.py
================

A minimal, real Gmail integration modeled on the Composio Gmail toolkit.

It implements two tools with the same slugs, input parameters, and output
shape that Composio documents:

    - GMAIL_SEND_EMAIL     (docs slug: GMAIL_SEND_EMAIL)
    - GMAIL_FETCH_EMAILS   (docs slug: GMAIL_FETCH_EMAILS)

Unlike Composio (which runs the execution + OAuth on its own servers), this
talks to Google's Gmail REST API directly using your own OAuth credentials.

--------------------------------------------------------------------------
DESIGN NOTES — how this mirrors Composio
--------------------------------------------------------------------------
Composio exposes tools as: execute(slug, arguments) -> {data, error, successful}
We replicate exactly that contract:

    result = toolkit.execute("GMAIL_SEND_EMAIL", {"recipient_email": "...", ...})
    # -> {"data": {...}, "error": None, "successful": True}

Each tool is a plain function registered under its slug. Input validation and
the {data, error, successful} envelope are handled centrally, so adding the
other 61 tools later is just: write a function, register its slug. That's the
"pattern" you asked to see.

--------------------------------------------------------------------------
SETUP (one time)
--------------------------------------------------------------------------
1. Create an OAuth client in Google Cloud Console:
   - Enable the Gmail API for your project.
   - APIs & Services -> Credentials -> Create OAuth client ID -> Desktop app.
   - Download the JSON, save it next to this file as `credentials.json`.
2. First run pops a browser consent screen and writes `token.json` (the
   refresh token) so later runs are non-interactive.

Scopes: gmail.send + gmail.readonly cover these two tools. Add more scopes if
you extend the toolkit (e.g. gmail.modify for label changes).
"""

from __future__ import annotations

import base64
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any, Callable, Dict, List, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


# Only the scopes the two implemented tools actually need.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
]

# Resolve credential/token paths relative to THIS file, not the caller's cwd,
# so the toolkit works no matter which directory you run it from.
_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_CREDENTIALS = os.path.join(_HERE, "credentials.json")
_DEFAULT_TOKEN = os.path.join(_HERE, "token.json")


# --------------------------------------------------------------------------
# Auth / client
# --------------------------------------------------------------------------
def _get_service(
    credentials_path: str = _DEFAULT_CREDENTIALS,
    token_path: str = _DEFAULT_TOKEN,
):
    """Build an authenticated Gmail API client.

    Handles the full local OAuth dance: load a cached token, refresh it if
    expired, or run the browser consent flow on first use. This is the piece
    Composio does server-side; here it's yours to own.
    """
    creds: Optional[Credentials] = None

    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(credentials_path):
                raise FileNotFoundError(
                    f"OAuth client file not found at '{credentials_path}'. "
                    "Download it from Google Cloud Console (Desktop app OAuth "
                    "client) and place it there. See the module docstring."
                )
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())

    return build("gmail", "v1", credentials=creds)


# --------------------------------------------------------------------------
# Tool 1: GMAIL_SEND_EMAIL
# --------------------------------------------------------------------------
def gmail_send_email(service, arguments: Dict[str, Any]) -> Any:
    """Send an email immediately via the Gmail API.

    Mirrors the Composio GMAIL_SEND_EMAIL input parameters:
      recipient_email / to, cc, bcc, subject, body, is_html,
      extra_recipients, from_email, user_id.

    At least one of recipient_email/cc/bcc must be present, and at least one
    of subject/body — same validation Composio documents.
    """
    user_id = arguments.get("user_id", "me")

    # 'to' is documented as an alias for recipient_email.
    to = arguments.get("recipient_email") or arguments.get("to")
    cc = arguments.get("cc") or []
    bcc = arguments.get("bcc") or []
    extra = arguments.get("extra_recipients") or []
    subject = arguments.get("subject")
    body = arguments.get("body")
    is_html = bool(arguments.get("is_html", False))
    from_email = arguments.get("from_email")

    to_list: List[str] = ([to] if to else []) + list(extra)

    # Validation matching the documented contract.
    if not (to_list or cc or bcc):
        raise ValueError(
            "At least one of 'recipient_email'/'to', 'cc', or 'bcc' is required."
        )
    if not (subject or body):
        raise ValueError("At least one of 'subject' or 'body' is required.")

    # Build a MIME message. multipart/alternative lets clients pick text vs html.
    message = MIMEMultipart("alternative")
    if to_list:
        message["To"] = ", ".join(to_list)
    if cc:
        message["Cc"] = ", ".join(cc)
    if bcc:
        message["Bcc"] = ", ".join(bcc)
    if from_email:
        message["From"] = from_email
    if subject:
        message["Subject"] = subject

    if body:
        subtype = "html" if is_html else "plain"
        message.attach(MIMEText(body, subtype))

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    sent = (
        service.users()
        .messages()
        .send(userId=user_id, body={"raw": raw})
        .execute()
    )
    # Return the Gmail send response (id, threadId, labelIds) as 'data'.
    return sent


# --------------------------------------------------------------------------
# Tool 2: GMAIL_FETCH_EMAILS
# --------------------------------------------------------------------------
def gmail_fetch_emails(service, arguments: Dict[str, Any]) -> Any:
    """List messages, optionally hydrating each with subject/from/snippet.

    Mirrors the Composio GMAIL_FETCH_EMAILS input parameters:
      query, user_id, max_results, label_ids, page_token,
      include_spam_trash, ids_only, verbose/include_payload (see note).

    Composio warns results are NOT sorted by recency and that 'messages' may
    be absent — we surface the raw list plus a hydrated view so the caller can
    sort by internalDate themselves.
    """
    user_id = arguments.get("user_id", "me")
    query = arguments.get("query")
    max_results = int(arguments.get("max_results", 10))
    label_ids = arguments.get("label_ids")
    page_token = arguments.get("page_token")
    include_spam_trash = bool(arguments.get("include_spam_trash", False))
    ids_only = bool(arguments.get("ids_only", False))
    # Treat verbose/include_payload as "hydrate each message with details".
    hydrate = bool(arguments.get("verbose", True)) or bool(
        arguments.get("include_payload", False)
    )

    list_kwargs: Dict[str, Any] = {
        "userId": user_id,
        "maxResults": max_results,
        "includeSpamTrash": include_spam_trash,
    }
    if query:
        list_kwargs["q"] = query
    if label_ids:
        list_kwargs["labelIds"] = label_ids
    if page_token:
        list_kwargs["pageToken"] = page_token

    resp = service.users().messages().list(**list_kwargs).execute()
    messages = resp.get("messages", [])  # may be absent — null-safe default
    next_page_token = resp.get("nextPageToken")

    # Fast path: just IDs, no per-message fetch.
    if ids_only or not hydrate:
        return {
            "messages": messages,
            "nextPageToken": next_page_token,
            "resultSizeEstimate": resp.get("resultSizeEstimate"),
        }

    # Hydrate: pull metadata for each message (subject/from/date/snippet).
    hydrated: List[Dict[str, Any]] = []
    for m in messages:
        full = (
            service.users()
            .messages()
            .get(
                userId=user_id,
                id=m["id"],
                format="metadata",
                metadataHeaders=["Subject", "From", "To", "Date"],
            )
            .execute()
        )
        headers = {
            h["name"].lower(): h["value"]
            for h in full.get("payload", {}).get("headers", [])
        }
        hydrated.append(
            {
                "messageId": full.get("id"),
                "threadId": full.get("threadId"),
                "labelIds": full.get("labelIds", []),
                "internalDate": full.get("internalDate"),  # sort key
                "snippet": full.get("snippet"),
                "subject": headers.get("subject"),
                "sender": headers.get("from"),
                "to": headers.get("to"),
                "date": headers.get("date"),
            }
        )

    return {
        "messages": hydrated,
        "nextPageToken": next_page_token,
        "resultSizeEstimate": resp.get("resultSizeEstimate"),
    }


# --------------------------------------------------------------------------
# Registry + execute() — the Composio-style dispatch surface
# --------------------------------------------------------------------------
class GmailToolkit:
    """Dispatches tools by slug and wraps results in Composio's envelope.

    Adding a new tool is two steps:
        1. write `def gmail_x(service, arguments): ...`
        2. add it to `_TOOLS` under its slug.
    """

    def __init__(
        self,
        credentials_path: str = _DEFAULT_CREDENTIALS,
        token_path: str = _DEFAULT_TOKEN,
    ):
        self._credentials_path = credentials_path
        self._token_path = token_path
        self._service = None  # lazy: only auth when a tool actually runs

    _TOOLS: Dict[str, Callable[[Any, Dict[str, Any]], Any]] = {
        "GMAIL_SEND_EMAIL": gmail_send_email,
        "GMAIL_FETCH_EMAILS": gmail_fetch_emails,
    }

    def _svc(self):
        if self._service is None:
            self._service = _get_service(self._credentials_path, self._token_path)
        return self._service

    def execute(self, slug: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Run a tool by slug. Always returns {data, error, successful}."""
        arguments = arguments or {}
        fn = self._TOOLS.get(slug)
        if fn is None:
            return {
                "data": None,
                "error": f"Unknown tool slug: {slug}. "
                f"Available: {', '.join(self._TOOLS)}",
                "successful": False,
            }
        try:
            data = fn(self._svc(), arguments)
            return {"data": data, "error": None, "successful": True}
        except HttpError as e:
            # Gmail API errors (401 auth, 429 rate limit, 400 bad request, ...)
            return {"data": None, "error": f"Gmail API error: {e}", "successful": False}
        except Exception as e:
            return {"data": None, "error": str(e), "successful": False}


# --------------------------------------------------------------------------
# Example usage
# --------------------------------------------------------------------------
if __name__ == "__main__":
    toolkit = GmailToolkit()

    # 1) Fetch the 5 most-recently-listed unread emails.
    print(">>> GMAIL_FETCH_EMAILS")
    res = toolkit.execute(
        "GMAIL_FETCH_EMAILS",
        {"query": "is:unread", "max_results": 5, "verbose": True},
    )
    if res["successful"]:
        for msg in res["data"]["messages"]:
            print(f"  [{msg['date']}] {msg['sender']}: {msg['subject']}")
    else:
        print("  error:", res["error"])

    # 2) Send an email. (Uncomment and fill in to actually send.)
    # print(">>> GMAIL_SEND_EMAIL")
    # res = toolkit.execute(
    #     "GMAIL_SEND_EMAIL",
    #     {
    #         "recipient_email": "someone@example.com",
    #         "subject": "Hello from the local Gmail toolkit",
    #         "body": "This was sent by mirroring the Composio pattern.",
    #         "is_html": False,
    #     },
    # )
    # print("  ", res)
