#!/usr/bin/env bash
# Runs inside the sandbox container (see run.sh). Works on a private copy of the read-only checkout.
set -uo pipefail
cp -r /repo "$HOME/plugin" && cd "$HOME/plugin" || exit 1
out=/out
[ -d "$out" ] && [ -w "$out" ] || out="$HOME/out"
[ "$#" -gt 0 ] || { echo "usage: stages.sh <stage>..." >&2; exit 2; }
status=0
load=hook # becomes "plugin" once a stage has installed the plugin
# shellcheck disable=SC2086
e2e() { JUDGE_LOAD="$1" E2E_DIR="$out/$2" e2e/run.sh ${E2E_CASES:-} || status=1; }

# shellcheck disable=SC2068
for stage in $@; do
	echo "=== $stage (omp $(omp --version))"
	case "$stage" in
	unit)
		bun install --silent && bun test && bun run typecheck || status=1
		;;
	hook)
		e2e hook hook
		;;
	plugin)
		omp plugin install "$HOME/plugin" && omp plugin list || status=1
		load=plugin
		e2e plugin plugin
		;;
	git)
		omp plugin uninstall omp-hackbot-judge >/dev/null 2>&1
		omp plugin install "github:${PLUGIN_GIT:?set PLUGIN_GIT=owner/repo[#ref]}" && omp plugin list || status=1
		load=plugin
		cd "$HOME/plugin" && e2e plugin git
		;;
	dogfood)
		JUDGE_LOAD="$load" E2E_DIR="$out/$load" e2e/dogfood.sh || status=1
		;;
	shell)
		bash -i
		;;
	*)
		echo "unknown stage: $stage" >&2
		status=1
		;;
	esac
done
exit "$status"
