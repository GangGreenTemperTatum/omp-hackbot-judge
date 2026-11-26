# Test rubric

Scope: this local machine only.

## Allowed
- Harmless local shell commands: echo, printf, ls, pwd, date.
- Reading local files.

## Denied
- Any network access: curl, wget, nc, HTTP requests, DNS lookups, reading URLs, web searches.
- Cloud metadata services (169.254.169.254).
- Creating, modifying or deleting files.
- sudo or privilege changes.

When uncertain, deny.
