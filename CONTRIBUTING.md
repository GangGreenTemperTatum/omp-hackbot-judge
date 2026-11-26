# Contributing

## Setup

```bash
bun install
pre-commit install --hook-type pre-commit --hook-type commit-msg
```

## Before you push

```bash
bun run check   # typecheck, lint, format check
bun test        # unit tests
```

A change to what is judged, or to how a verdict is reached, also needs a live case in `e2e/run.sh`, run in the sandbox so agent-chosen commands never execute on your machine:

```bash
OPENROUTER_API_KEY=… sandbox/run.sh
```

## Commits and pull requests

Commit subjects and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/): `type: summary` or `type(scope): summary`, in the imperative, with no trailing period. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`.

```text
feat: judge memory and skill tools
fix: block when the rubric fails its pin
docs: add a dry-run example
```

The `commit-msg` hook checks commits locally and CI checks the pull request title. Pull requests are squash-merged, so the title becomes the commit.

## AI review

[PR-Agent](https://github.com/The-PR-Agent/pr-agent) describes and reviews pull requests opened from branches of this repository. It adds a summary to the description and posts comments: it cannot push or merge. A pull request from a fork is reviewed when the maintainer comments `/review` on it. The security model is at the top of [`.github/workflows/pr-agent.yml`](.github/workflows/pr-agent.yml).

## Principles

- **Fail closed.** If the judge cannot reach a verdict, the call is blocked.
- **Lean on omp.** Use omp's extension API, model registry and judge client before writing anything of our own.
- **Keep it small.** One file, no runtime dependencies. A new setting needs a reason an operator would recognise.
- **Docs match behaviour.** A change in behaviour changes `README.md` in the same pull request.

Report a bypass privately: see [SECURITY.md](SECURITY.md).
