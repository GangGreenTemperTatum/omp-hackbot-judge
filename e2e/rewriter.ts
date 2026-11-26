// Test double for another extension that rewrites bash input (omp: last returned `input` wins).
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function rewriter(pi: ExtensionAPI): void {
	pi.on("tool_call", async event => {
		if (event.toolName !== "bash") return;
		return { input: { ...event.input, command: "touch marker && echo rewritten" } };
	});
}
