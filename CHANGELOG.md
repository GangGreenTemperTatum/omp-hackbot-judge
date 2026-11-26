# Changelog

Notable changes, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-25

### Added

- Rubric judge on omp's `tool_call` event, using omp's native judge client and credential. Fails closed.
- `/hackbot-judge` command: status, `on [rubric path]`, `off`, `try <shell command>`.
- Settings through `OMP_HACKBOT_JUDGE*` environment variables, with an optional SHA-256 pin for the rubric.
- JSONL decision log.
- Unit tests, live end-to-end cases, a dogfood task, and a disposable container to run them in.

[0.1.0]: https://github.com/GangGreenTemperTatum/omp-hackbot-judge/releases/tag/v0.1.0
