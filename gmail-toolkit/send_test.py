"""
send_test.py — send a single real email via GMAIL_SEND_EMAIL.

Usage:
    python send_test.py <recipient> [subject] [body]

Example:
    python send_test.py you@example.com "Test" "Hello from the local toolkit"

Requires credentials.json (Google Cloud desktop OAuth client) next to this
file. First run opens a browser consent screen and caches token.json.
"""

import sys

from gmail_toolkit import GmailToolkit


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    recipient = sys.argv[1]
    subject = sys.argv[2] if len(sys.argv) > 2 else "Gmail toolkit send test"
    body = sys.argv[3] if len(sys.argv) > 3 else (
        "This email was sent by the local Gmail toolkit "
        "(GMAIL_SEND_EMAIL), which mirrors the Composio pattern."
    )

    toolkit = GmailToolkit()
    res = toolkit.execute(
        "GMAIL_SEND_EMAIL",
        {"recipient_email": recipient, "subject": subject, "body": body},
    )

    if res["successful"]:
        sent = res["data"]
        print(f"Sent. id={sent.get('id')} threadId={sent.get('threadId')}")
        return 0

    print("Send failed:", res["error"])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
