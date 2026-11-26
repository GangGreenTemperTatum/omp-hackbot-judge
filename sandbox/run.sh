#!/usr/bin/env bash
# Run the whole test suite in a disposable container that shares nothing with the host's omp.
#
# Usage: OPENROUTER_API_KEY=... sandbox/run.sh [stage...]   (no arguments = unit hook plugin)
#   unit    bun test + typecheck
#   hook    live e2e with the file loaded by --hook
#   plugin  `omp plugin install` this checkout, then live e2e through the installed plugin
#   git     `omp plugin install github:$PLUGIN_GIT`, then live e2e (tests the published repo)
#   dogfood a realistic multi-step task under examples/bug-bounty-rubric.md; prints every judgment
#           (through the plugin when it follows `plugin` or `git`, else through --hook)
#   shell   interactive shell in the box
# Environment: OMP_REF (omp release, default v19.2.1), E2E_MODEL, E2E_CASES, SANDBOX_OUT (host
# directory that receives the e2e output).
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
image=omp-hackbot-judge-sandbox
: "${OPENROUTER_API_KEY:?set OPENROUTER_API_KEY (used by the test agent and the judge)}"

docker build -q -t "$image" --build-arg "OMP_REF=${OMP_REF:-v19.2.1}" "$repo/sandbox" >/dev/null

mounts=(-v "$repo:/repo:ro")
[ -n "${SANDBOX_OUT:-}" ] && mkdir -p "$SANDBOX_OUT" && mounts+=(-v "$SANDBOX_OUT:/out")
tty=()
[ "${1:-}" = shell ] && tty=(-it)

# The key reaches the container as an environment variable only; it is never written to the image.
exec docker run --rm ${tty[@]+"${tty[@]}"} "${mounts[@]}" \
	-e OPENROUTER_API_KEY \
	-e "E2E_MODEL=${E2E_MODEL:-openrouter/deepseek/deepseek-v4.1-flash-1017}" \
	-e "E2E_CASES=${E2E_CASES:-}" -e "PLUGIN_GIT=${PLUGIN_GIT:-}" \
	"$image" bash /repo/sandbox/stages.sh "${@:-unit hook plugin}"
