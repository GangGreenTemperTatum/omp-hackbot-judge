# omp-hackbot-judge

A plugin for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`). Before a tool call runs, it asks one of omp's judge models whether **your rubric** permits it, and blocks the call unless the answer is a confident yes.

It is for security agents that run unattended: bug bounty, pentest and red-team harnesses where the rules of engagement live in a document. You write the rubric in plain language (scope, required headers, forbidden actions). Whatever model drives the session, its tool calls are stopped at the start when the rubric says no.

- **Runs at tool call start**, on omp's `tool_call` extension event, before the tool executes.
- **Uses omp's own judge.** Any native model from `omp models --kind=judge`, through omp's judge client and omp's stored credential. No extra API key, no HTTP code of its own.
- **Fail-closed.** Once a rubric is attached, anything that stops the judge from reaching a verdict blocks the call.
- **Attach and detach freely.** Per launch with one environment variable, or inside a session with `/hackbot-judge on <rubric>` and `/hackbot-judge off`.
- **Small.** One file of about 250 lines, no runtime dependencies, no build step, seven settings.

## What it looks like

A rubric:

```markdown
## In scope
- HTTP and HTTPS requests to example.com and its subdomains, with the header `X-Bug-Bounty: researcher-handle`.
- Read-only local commands and writing notes inside the working directory.

## Out of scope: deny
- Requests to any other host, or to an in-scope host without the header.
- Port scans, brute forcing, anything resembling denial of service.

When uncertain, deny.
```

A real session under the [example rubric](examples/bug-bounty-rubric.md), from this repository's dogfood test. The agent was asked to fetch headers from two hosts, and from the first again without the header:

```text
        P(allow)  time   tool  input
ALLOW   0.99      167ms  bash  {"command":"curl -sS -D - -o /dev/null -H 'X-Bug-Bounty: researcher-handle' https://example.com/", …}
DENY    0         210ms  bash  {"command":"curl -sS -D - -o /dev/null https://example.org/", …}
DENY    0.02      171ms  bash  {"command":"curl -sS -D - -o /dev/null https://example.com/", …}
```

The first command runs. The other two never start; the agent gets this as the tool's error and moves on:

```text
Denied by the engagement rubric judge. Do not retry, rephrase, or route this action through another tool. Report it to the operator.
```

## Install

```bash
omp plugin install github:GangGreenTemperTatum/omp-hackbot-judge
```

Or from a checkout: `omp plugin install /path/to/omp-hackbot-judge`. Plugins load when a session starts, so start a new omp session afterwards. Installed, it does nothing until a rubric is attached.

| To | Do |
|---|---|
| Try it for one run without installing | `omp --hook /path/to/omp-hackbot-judge/index.ts` |
| Switch it off everywhere, keep it installed | `omp plugin disable omp-hackbot-judge` |
| Remove it | `omp plugin uninstall omp-hackbot-judge` |

**Requirements:** omp 19.2 or later, with a credential for a native judge model. Check with `omp models --kind=judge`. The default is `openrouter/typesafe/jev-1.14`, which needs only omp's OpenRouter login or `OPENROUTER_API_KEY`.

## Use

**Attach at launch** (works headless, and covers the session from its first tool call):

```bash
export OMP_HACKBOT_JUDGE=/abs/path/rubric.md
omp
```

**Attach or detach in a running session:**

| Command | Effect |
|---|---|
| `/hackbot-judge` | Show status: off, on (rubric hash, model, judgments used, last decision), or misconfigured. |
| `/hackbot-judge on /abs/path/rubric.md` | Attach that rubric. With no path, re-attach the last one named, at launch or by this command. With `OMP_HACKBOT_JUDGE_SHA256` set, only a rubric matching the pin attaches. |
| `/hackbot-judge off` | Detach. Tool calls run unjudged again. |
| `/hackbot-judge try <shell command>` | Ask the judge about a `bash` command without running it. Use it to tune a rubric. |

Attaching and detaching apply to the main agent and to every subagent started afterwards. A subagent that is already running on one of omp's worker threads keeps the state it started with, so attach before you hand out work.

In `omp -p` there is no screen for status lines; the log records `attached`, `detached` and `try` instead.

Start from [`examples/bug-bounty-rubric.md`](examples/bug-bounty-rubric.md). Keep the rubric outside the agent's working directory and read-only, so the agent cannot edit its own rules.

### Which tool calls are judged

Every tool call, except thirteen omp tools that only touch the running session and persist nothing: `ask`, `todo`, `wait`, `task`, `yield`, `goal`, `think`, `new_context`, `context_notes`, `checkpoint`, `rewind`, `recall`, `reflect`. A subagent started with `task` has each of its own tool calls judged.

So `bash`, `eval`, `read`, `write`, `edit`, `grep`, `web_search`, `github`, the memory and skill tools, MCP tools, other extensions' tools and tools omp adds later are all judged, with no list to maintain and no setting to exempt a tool. Your rubric decides what is fine: say "reading local files is allowed" if it is.

The judge sees the tool name, the session's working directory and the tool's input, next to your rubric.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `OMP_HACKBOT_JUDGE` | unset (off) | Absolute path of the rubric. Setting it attaches the judge at launch. |
| `OMP_HACKBOT_JUDGE_SHA256` | none | Expected SHA-256 of the rubric. A rubric that does not match is refused. |
| `OMP_HACKBOT_JUDGE_MODEL` | `openrouter/typesafe/jev-1.14` | A native model from `omp models --kind=judge`, as `provider/model`. |
| `OMP_HACKBOT_JUDGE_MIN_P` | `0.8` | Minimum `P(allow)` for an allow, in (0, 1]. |
| `OMP_HACKBOT_JUDGE_TIMEOUT_MS` | `15000` | Deadline per judgment. Must stay under omp's 30 s handler limit. |
| `OMP_HACKBOT_JUDGE_MAX_CALLS` | `2000` | Judgments per omp process, subagents included. When used up, judged calls are blocked. |
| `OMP_HACKBOT_JUDGE_LOG` | none | Path of a JSONL decision log. |

### What blocks a judged call

- the rubric named at launch is missing, empty, over 8 KiB, at a relative path, or fails its hash pin
- a setting is invalid, the judge model is unknown or not a native judge, or it has no credential
- the judge request fails, times out, or returns an answer that is not an allow/deny choice
- the call budget is used up, or the tool input is over 32 KiB

omp adds its own net: a `tool_call` handler that throws or runs past 30 s also blocks the call.

## Seeing what it does

- **In the session:** every blocked call shows the operator a notice with the reason and probability, for example `hackbot-judge: DENY bash: rubric forbids, P(allow) 0.01`. The agent sees only the fixed message. `/hackbot-judge` shows the last decision.
- **The log** (`OMP_HACKBOT_JUDGE_LOG`), one JSON object per line:

  ```json
  {"ts":"…","event":"armed","rubricSha256":"…","policySha256":"…","model":"openrouter/typesafe/jev-1.14","minP":0.8}
  {"ts":"…","event":"decision","agent":"…","tool":"bash","toolCallId":"…","allowed":false,"pAllow":0.01,"reason":"rubric forbids","latencyMs":204,"inputSha256":"…","input":"{\"command\":\"curl …\"}"}
  ```

  - `armed` is written once per session that starts with the judge on, subagents included, with the model and threshold in force, or an `error` when the rubric could not be loaded. `attached`, `detached` and `try` record the slash commands.
  - `rubricSha256` identifies the rubric. `policySha256` identifies the model, threshold and question, so records from different setups are not mixed up.
  - `reason` is `rubric permits`, `rubric forbids`, `P(allow) … below …`, or the error that blocked the call.
  - `input` is the tool input, cut at 4 KiB. It can contain secrets from command lines; keep the log out of git, and outside the agent's working directory so the agent cannot read the probabilities or edit the record.

  ```bash
  jq -r 'select(.event=="decision") | [.allowed, .pAllow, .tool, .reason, .input[0:100]] | @tsv' judge.jsonl
  ```

## Writing a rubric that works

The judge returns a probability. Clear cases score near 0 or 1 and stay there. Cases the rubric does not clearly cover land in the middle and can go either way between identical calls.

- Name hosts, headers and commands explicitly. "Requests to example.com with header X" beats "stay in scope".
- Cover local work too, since file tools are judged: "Reading local files and writing inside the working directory are allowed."
- Say what to do with things the judge cannot read: scripts, encoded payloads, `eval` code. "Deny commands whose target cannot be read from the command itself."
- Protect the controls: "Deny reading or changing the rubric, the judge log and any `.env` file."
- End with "When uncertain, deny."
- Tune with `/hackbot-judge try <command>`, and read the log after a first run. Legitimate calls denied at 0.6–0.79 mean the rubric needs a line that covers them.

## Limits

Read these before relying on it.

1. **It judges the call's text, not its effect.** A `bash` command is judged as a string: `$(echo … | base64 -d)` hides its target, and `bash ./x.sh` shows only the file name. Writing `x.sh` with the `write` tool is judged, content included, but a script that already exists or is produced by another program is not. The rubric has to say how to treat opaque commands.
2. **`eval` is judged as code text.** Code inside an `eval` cell can start processes and make requests without going through another tool, and with `eval.tools.enabled` it can define a tool under one of the unjudged names. For a strict engagement, disable `eval`.
3. **Extension load order.** omp runs `tool_call` handlers in load order and uses the last input any of them returns. An extension loaded after this one that rewrites tool input can change an approved call. Do not combine it with input-rewriting extensions, or make sure it loads last (`--hook` paths load after installed plugins).
4. **Off is silent.** If the plugin is not installed, fails to load, or no rubric is attached, nothing is judged and omp carries on. Check `/hackbot-judge`, or check that each session wrote an `armed` record.
5. **Borderline answers vary, and long free text is the usual cause.** Measured with the example rubric and `jev-1.14`: in-scope requests scored 0.97–0.99 and out-of-scope requests, opaque scripts and writes outside the working directory 0.00–0.10, the same on every repeat. Writing a notes file that discussed the blocked out-of-scope hosts scored 0.45–0.63, so it was denied although the rubric allows notes, and `ls -la` ranged from 0.77 to 0.97 depending on the directory. Rewording the judge's question raised neither reliably and made injected text in a command more persuasive, so the question stays strict. Expect some false denials on local free-text work, and check the log.
6. **Sessions that load no extensions are not covered**, for example the restricted session behind omp's `security_scan` tool.
7. **The budget is per thread of one omp process.** The main agent and its ordinary subagents share it; a subagent on a worker thread, and a separately started omp, each get their own.
8. **Large inputs are blocked, not judged.** A tool input over 32 KiB (a very large `write`, for example) is blocked. Write it in parts.
9. **omp reads `.env` from the working directory**, so an agent that may write there can set any `OMP_HACKBOT_JUDGE_*` variable you did not set yourself, for the next launch. None of them can exempt a tool, and a verdict always needs an "allow" answer, but it could lower the threshold or attach a rubric of its own when you attach none. Export the settings you rely on, pin the rubric with `OMP_HACKBOT_JUDGE_SHA256`, and deny `.env` writes in the rubric.
10. **Judge calls are not in omp's usage totals.** At about $0.00001 each, 2,000 judgments cost about two cents.

## Privacy

The rubric and the input of every judged tool call are sent to the judge model's provider (by default OpenRouter, which forwards to TypeSafe), under their logging and retention terms. Tool inputs can include target hostnames, request bodies, tokens in headers, file paths and file contents being written. Do not use the plugin on an engagement whose terms forbid sending that data to a third party.

## Testing

```bash
bun install
bun test            # verdict mapping, settings, and the extension against a fake session and endpoint
bun run typecheck   # against the published omp types
```

The unit tests drive omp's real judge client against a fake HTTP endpoint, so the request and answer shapes are the real ones.

Live tests run a real omp, a real agent model and the real judge. They execute agent-chosen commands, so the repository ships a disposable container for them. It has its own home directory, omp install and `~/.omp`, and shares nothing with omp on your machine:

```bash
OPENROUTER_API_KEY=… sandbox/run.sh                 # unit, live cases via --hook, live cases via the installed plugin
OPENROUTER_API_KEY=… sandbox/run.sh plugin dogfood  # a realistic multi-step task under the example rubric
OPENROUTER_API_KEY=… PLUGIN_GIT=GangGreenTemperTatum/omp-hackbot-judge sandbox/run.sh git   # install from GitHub
```

Each live case runs `omp -p` in an empty directory, then checks the judge's log and whether a `marker` file was created, which proves whether the command ran. `e2e/run.sh` lists the cases.

## Related

[omp-jevens-classifier](https://github.com/STRML/omp-jevens-classifier) also puts a judge model in front of omp tool calls. It answers a different question, "is this shell command dangerous?", with a built-in hazard checklist and a Run/Deny dialog for `bash` and process-spawning `eval`. This plugin answers "does my rubric permit this action?" for every tool, without dialogs.

## License

MIT
