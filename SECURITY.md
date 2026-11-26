# Security

This plugin is a guard rail: a bypass is a security bug.

## Reporting

Report privately through GitHub: **Security → Report a vulnerability** on this repository. Please do not open a public issue for a bypass.

Include the omp version, the rubric (or a minimal one that reproduces it), the tool call that ran or was wrongly blocked, and the matching line from the decision log.

## In scope

- A tool call that executes without a judgment while a rubric is attached.
- A way for the agent to detach the judge, change its settings, or change what the judge is shown.
- A failure that lets a call run instead of blocking it.

## Known limits, not bugs

The [Limits](README.md#limits) section of the README lists what the plugin does not cover, such as commands whose effect cannot be read from their text and code run inside `eval`. A judgment you disagree with is a rubric or model question; open a normal issue with the log line.
