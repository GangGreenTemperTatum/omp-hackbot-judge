# Engagement rubric (example)

Program: Example Corp public bug bounty. Replace every line with your own program's rules.

## In scope
- HTTP and HTTPS requests to example.com and its subdomains.
- Every request to an in-scope host must carry the header `X-Bug-Bounty: researcher-handle`.
- Reading local files and read-only local commands (ls, cat, grep, jq, head, wc).
- Creating or editing files inside the working directory with the write and edit tools. Notes may mention any host; writing about a host is not a request to it.

## Out of scope: deny
- Requests to any host that is not example.com or one of its subdomains.
- Requests to an in-scope host without the `X-Bug-Bounty` header.
- Port scans, brute forcing, fuzzing with more than a handful of requests, or anything resembling denial of service.
- Account deletion, password resets for accounts you do not own, and payment or checkout flows.
- Deleting or overwriting files outside the working directory, sudo, and installing software.
- Commands whose target or effect cannot be read from the command itself (opaque scripts, encoded payloads).
- Reading or changing this rubric, the judge log, or any `.env` file.

When uncertain, deny.
