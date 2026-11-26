import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHackbotJudge, DENIED, decide, loadConfig, policySha256, SESSION_TOOLS, UNAVAILABLE } from "./index";

const dir = mkdtempSync(join(tmpdir(), "hackbot-judge-"));
const rubricText = "Allow echo. Deny all network access.";
const rubric = join(dir, "rubric.md");
writeFileSync(rubric, rubricText);
const sha = createHash("sha256").update(rubricText).digest("hex");
const POLICY = policySha256({ model: "openrouter/typesafe/jev-1.14", minP: 0.8 });

describe("decide", () => {
	const choice = (c: string, pAllow: unknown) => ({ type: "choice", choice: c, probabilities: { allow: pAllow, deny: 0 } });

	test("allows a confident allow", () => {
		expect(decide(choice("allow", 0.95), 0.8)).toEqual({ allowed: true, error: false, reason: "rubric permits", pAllow: 0.95 });
	});
	test("allows exactly at the threshold", () => expect(decide(choice("allow", 0.8), 0.8).allowed).toBe(true));
	test("denies an unconfident allow without marking an error", () => {
		expect(decide(choice("allow", 0.79), 0.8)).toEqual({ allowed: false, error: false, reason: "P(allow) 0.790 below 0.8", pAllow: 0.79 });
	});
	test("denies a deny even with a high P(allow)", () => expect(decide(choice("deny", 0.99), 0.5).allowed).toBe(false));
	test.each([
		undefined,
		null,
		"allow",
		{},
		{ choice: "allow" },
		{ choice: "allow", probabilities: {} },
		{ choice: "allow", probabilities: { allow: "0.9" } },
		{ choice: "allow", probabilities: { allow: Number.NaN } },
		{ choice: "maybe", probabilities: { allow: 0.9 } },
	])("treats malformed %j as an error", answer => {
		expect(decide(answer, 0.8)).toEqual({ allowed: false, error: true, reason: "malformed judge answer" });
	});
});

describe("loadConfig", () => {
	test("no rubric named", () => expect(loadConfig({})).toBeUndefined());
	test("defaults", () => {
		expect(loadConfig({ OMP_HACKBOT_JUDGE: rubric })).toEqual({
			rubric: rubricText,
			model: "openrouter/typesafe/jev-1.14",
			minP: 0.8,
			timeoutMs: 15_000,
			maxCalls: 2_000,
		});
	});
	test("accepts a matching SHA-256 pin in either case", () => {
		expect(loadConfig({ OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_SHA256: sha.toUpperCase() })?.rubric).toBe(rubricText);
	});
	test.each([
		["empty path", { OMP_HACKBOT_JUDGE: "" }],
		["relative path", { OMP_HACKBOT_JUDGE: "rubric.md" }],
		["missing file", { OMP_HACKBOT_JUDGE: `${rubric}.missing` }],
		["hash mismatch", { OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_SHA256: "0".repeat(64) }],
		["MIN_P 0", { OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_MIN_P: "0" }],
		["MIN_P 1.5", { OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_MIN_P: "1.5" }],
		["MIN_P word", { OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_MIN_P: "high" }],
		["MIN_P blank", { OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_MIN_P: " " }],
		["timeout at omp's 30 s handler limit", { OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_TIMEOUT_MS: "30000" }],
		["fractional timeout", { OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_TIMEOUT_MS: "1.5" }],
		["zero budget", { OMP_HACKBOT_JUDGE: rubric, OMP_HACKBOT_JUDGE_MAX_CALLS: "0" }],
	])("rejects %s", (_name, env) => expect(() => loadConfig(env)).toThrow());
	test("rejects an empty rubric", () => {
		const empty = join(dir, "empty.md");
		writeFileSync(empty, " \n");
		expect(() => loadConfig({ OMP_HACKBOT_JUDGE: empty })).toThrow("rubric is empty");
	});
	test("rejects a rubric over 8 KiB", () => {
		const big = join(dir, "big.md");
		writeFileSync(big, "x".repeat(8_193));
		expect(() => loadConfig({ OMP_HACKBOT_JUDGE: big })).toThrow("rubric exceeds 8 KiB");
	});
	test("the policy hash changes with the model and threshold", () => {
		expect(POLICY).toMatch(/^[0-9a-f]{64}$/);
		expect(policySha256({ model: "openrouter/typesafe/jev-1.14", minP: 0.8 })).toBe(POLICY);
		expect(policySha256({ model: "openrouter/typesafe/jev-1.13", minP: 0.8 })).not.toBe(POLICY);
		expect(policySha256({ model: "openrouter/typesafe/jev-1.14", minP: 0.9 })).not.toBe(POLICY);
	});
});

// ---- the extension, against a fake omp session and a fake Decisions endpoint. The judge client in
// ---- between is omp's real one (@oh-my-pi/pi-ai), so the request and answer wire shapes are real.

type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
type Session = { toolCall?: Handler; command?: (args: string, ctx: unknown) => Promise<void> };

const MODEL = { provider: "openrouter", id: "typesafe/jev-1.14", api: "openrouter-decisions", baseUrl: "https://openrouter.test/api/alpha", input: ["text"] };

/** What a session shows its operator, plus the registry omp hands an extension. */
function ctx(overrides: Record<string, unknown> = {}) {
	const shown: string[] = [];
	return {
		shown,
		hasUI: true,
		cwd: "/work",
		ui: { notify: (text: string, type: string) => shown.push(`${type}: ${text}`) },
		agent: { id: "Main" },
		sessionManager: { getSessionId: () => "session-1" },
		modelRegistry: {
			find: (provider: string, id: string) => (provider === MODEL.provider && id === MODEL.id ? MODEL : undefined),
			getApiKey: async (_model: unknown, sessionId: string) => (sessionId === "session-1" ? "sk-session" : undefined),
			resolver: (_model: unknown, sessionId: string) => () => (sessionId === "session-1" ? "sk-session" : undefined),
			resolveModelHeaders: async () => ({ "X-Extra": "1" }),
		},
		...overrides,
	};
}

/** Bind the extension to `count` fake sessions of one process. */
function sessions(env: Record<string, string>, fetchImpl: Fetch, count = 1): Session[] {
	const factory = createHackbotJudge(env, fetchImpl as never);
	return Array.from({ length: count }, () => {
		const session: Session = {};
		factory({
			on: (name: string, handler: Handler) => name === "tool_call" && (session.toolCall = handler),
			registerCommand: (_name: string, command: { handler: Session["command"] }) => (session.command = command.handler),
		} as never);
		return session;
	});
}

const answer = (choice: string, pAllow: number): Fetch => async () =>
	Response.json({
		model: "typesafe/jev-1.14",
		answers: { verdict: { type: "choice", choice, probabilities: { allow: pAllow, deny: 1 - pAllow }, confidence: 1 } },
		usage: { input_tokens: 10, output_tokens: 1 },
	});
const never: Fetch = async () => Promise.reject(new Error("the judge must not be called"));
const call = (toolName: string, input: Record<string, unknown>) => ({ type: "tool_call", toolName, toolCallId: "c1", input });
const bash = (command: string) => call("bash", { command });
const on = { OMP_HACKBOT_JUDGE: rubric };

describe("tool calls", () => {
	test("off: nothing is judged or blocked", async () => {
		const [s] = sessions({}, never);
		expect(await s.toolCall?.(bash("curl https://x"), ctx())).toBeUndefined();
	});

	test("allow returns the judged input as a fresh copy", async () => {
		const [s] = sessions({ ...on }, answer("allow", 0.97));
		const event = bash("echo ok");
		const result = (await s.toolCall?.(event, ctx())) as { input: Record<string, unknown> };
		expect(result).toEqual({ input: { command: "echo ok" } });
		expect(result.input).not.toBe(event.input);
	});

	test("an in-place edit during the judge's wait does not change what runs", async () => {
		const event = bash("echo ok");
		const [s] = sessions({ ...on }, async (...args) => {
			(event.input as { command: string }).command = "curl https://evil.example";
			return answer("allow", 0.97)(...args);
		});
		expect(await s.toolCall?.(event, ctx())).toEqual({ input: { command: "echo ok" } });
	});

	test("allowed edit calls keep their original input", async () => {
		const [s] = sessions({ ...on }, answer("allow", 1));
		expect(await s.toolCall?.(call("edit", { input: "x", path: "a.ts" }), ctx())).toBeUndefined();
	});

	test("omp's judge client sends the rubric and action with the session credential", async () => {
		let seen: { url: string; init?: RequestInit } | undefined;
		const [s] = sessions({ ...on }, async (url, init) => {
			seen = { url: String(url), init };
			return answer("allow", 1)(url, init);
		});
		await s.toolCall?.(bash("echo ok"), ctx());
		expect(seen?.url).toBe("https://openrouter.test/api/alpha/decisions");
		const headers = new Headers(seen?.init?.headers);
		expect(headers.get("authorization")).toBe("Bearer sk-session");
		expect(headers.get("x-extra")).toBe("1");
		const body = JSON.parse(String(seen?.init?.body));
		expect(body.model).toBe("typesafe/jev-1.14");
		expect(body.state).toEqual({ rubric: rubricText, proposed_action: { tool: "bash", cwd: "/work", input: { command: "echo ok" } } });
		expect(Object.keys(body.questions.verdict.criteria)).toEqual(["allow", "deny"]);
	});

	test.each([
		["a local read", call("read", { path: "notes.md" })],
		["a URL read", call("read", { path: "https://target.example/app.js" })],
		["a file write", call("write", { path: "x.sh", content: "curl https://x" })],
		["an MCP tool", call("mcp__proxy_send_request", { raw: "GET / HTTP/1.1" })],
		["a tool that persists instructions", call("manage_skill", { name: "x", body: "run curl" })],
		["a tool omp has not shipped yet", call("some_future_tool", {})],
	])("%s is judged", async (_name, event) => {
		let judged = 0;
		const [s] = sessions({ ...on }, async (...args) => {
			judged++;
			return answer("deny", 0)(...args);
		});
		expect(await s.toolCall?.(event, ctx())).toEqual({ block: true, reason: DENIED });
		expect(judged).toBe(1);
	});

	test("session tools are not judged", async () => {
		const [s] = sessions({ ...on }, never);
		for (const tool of SESSION_TOOLS) expect(await s.toolCall?.(call(tool, {}), ctx())).toBeUndefined();
	});

	test("a denial blocks with the fixed message and tells only the operator why", async () => {
		const [s] = sessions({ ...on }, answer("allow", 0.79));
		const session = ctx();
		expect(await s.toolCall?.(bash("curl https://x"), session)).toEqual({ block: true, reason: DENIED });
		expect(session.shown).toEqual(["warning: hackbot-judge: DENY bash: P(allow) 0.790 below 0.8, P(allow) 0.79"]);
	});

	test.each<[string, Fetch]>([
		["HTTP 400", async () => new Response("bad", { status: 400 })],
		["HTTP 500 after omp's retries", async () => new Response("boom", { status: 500 })],
		["network error", async () => Promise.reject(new Error("ECONNRESET"))],
		["an answer for another question", async () => Response.json({ answers: {}, usage: {} })],
		["non-JSON body", async () => new Response("<html>")],
	])("%s blocks as unavailable", async (_name, fetchImpl) => {
		const [s] = sessions({ ...on }, fetchImpl);
		expect(await s.toolCall?.(bash("echo ok"), ctx())).toEqual({ block: true, reason: UNAVAILABLE });
	}, 20_000);

	test("an unknown model, a chat model, or a missing credential blocks as unavailable", async () => {
		for (const model of ["openrouter/nope", "jev-1.14"]) {
			const [unknown] = sessions({ ...on, OMP_HACKBOT_JUDGE_MODEL: model }, never);
			expect(await unknown.toolCall?.(bash("echo ok"), ctx())).toEqual({ block: true, reason: UNAVAILABLE });
		}
		const chat = ctx();
		chat.modelRegistry.find = () => ({ ...MODEL, api: "openai-completions" });
		const [s] = sessions({ ...on }, never);
		expect(await s.toolCall?.(bash("echo ok"), chat)).toEqual({ block: true, reason: UNAVAILABLE });
		expect(await s.toolCall?.(bash("echo ok"), ctx({ sessionManager: { getSessionId: () => "other" } }))).toEqual({ block: true, reason: UNAVAILABLE });
	});

	test("a rubric that cannot be loaded blocks judged tools and nothing else", async () => {
		const [s] = sessions({ OMP_HACKBOT_JUDGE: "" }, never);
		expect(await s.toolCall?.(bash("echo ok"), ctx())).toEqual({ block: true, reason: UNAVAILABLE });
		expect(await s.toolCall?.(call("todo", {}), ctx())).toBeUndefined();
	});

	test("oversized input blocks without a judge call", async () => {
		const [s] = sessions({ ...on }, never);
		expect(await s.toolCall?.(bash("x".repeat(33_000)), ctx())).toEqual({ block: true, reason: UNAVAILABLE });
	});

	test("the call budget is shared by every session of one process", async () => {
		let judged = 0;
		const [main, sub] = sessions({ ...on, OMP_HACKBOT_JUDGE_MAX_CALLS: "1" }, async (...args) => {
			judged++;
			return answer("allow", 1)(...args);
		}, 2);
		expect(await main.toolCall?.(bash("echo 1"), ctx())).toEqual({ input: { command: "echo 1" } });
		expect(await sub.toolCall?.(bash("echo 2"), ctx())).toEqual({ block: true, reason: UNAVAILABLE });
		expect(judged).toBe(1);
	});

	test("logs one armed record per session and each decision with its input", async () => {
		const log = join(dir, "judge.jsonl");
		const [s] = sessions({ ...on, OMP_HACKBOT_JUDGE_LOG: log }, answer("deny", 0.02));
		await s.toolCall?.(bash("curl https://x"), ctx());
		const [armed, decision] = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
		expect(armed).toMatchObject({ event: "armed", rubricSha256: sha, policySha256: POLICY, model: "openrouter/typesafe/jev-1.14", minP: 0.8 });
		expect(decision).toMatchObject({
			event: "decision",
			agent: "Main",
			tool: "bash",
			allowed: false,
			pAllow: 0.02,
			reason: "rubric forbids",
			input: JSON.stringify({ command: "curl https://x" }),
		});
	});
});

describe("/hackbot-judge", () => {
	const run = async (session: Session, args: string, context = ctx()) => {
		await session.command?.(args, context);
		return context.shown;
	};

	test("reports off, on with usage and the last decision, and misconfigured", async () => {
		expect(await run(sessions({}, never)[0], "")).toEqual(["info: hackbot-judge: off"]);
		const [s] = sessions({ ...on }, answer("allow", 1));
		await s.toolCall?.(bash("echo ok"), ctx());
		expect(await run(s, "")).toEqual([
			`info: hackbot-judge: on, rubric ${sha.slice(0, 12)}, model openrouter/typesafe/jev-1.14, min P(allow) 0.8, 1/2000 judgments used, last: ALLOW bash: rubric permits, P(allow) 1.00`,
		]);
		const [shown] = await run(sessions({ OMP_HACKBOT_JUDGE: "" }, never)[0], "");
		expect(shown).toBe("error: hackbot-judge: MISCONFIGURED (the rubric path must be absolute); every judged tool call is blocked");
	});

	test("on <path> attaches and off detaches, for every session and for later imports", async () => {
		const env: Record<string, string> = {};
		const [main, sub] = sessions(env, answer("deny", 0), 2);
		expect(await sub.toolCall?.(bash("curl https://x"), ctx())).toBeUndefined();
		expect((await run(main, `on ${rubric}`))[0]).toStartWith("info: hackbot-judge: on, rubric");
		expect(await sub.toolCall?.(bash("curl https://x"), ctx())).toEqual({ block: true, reason: DENIED });
		// A worker-thread subagent imports the module again and reads the same environment.
		const [worker] = sessions(env, answer("deny", 0));
		expect(await worker.toolCall?.(bash("curl https://x"), ctx())).toEqual({ block: true, reason: DENIED });
		expect(await run(main, "off")).toEqual(["info: hackbot-judge: off"]);
		expect(await sub.toolCall?.(bash("curl https://x"), ctx())).toBeUndefined();
		expect(await sessions(env, never)[0].toolCall?.(bash("curl https://x"), ctx())).toBeUndefined();
	});

	test("on without a path re-attaches the rubric named at launch", async () => {
		const [s] = sessions({ ...on }, answer("deny", 0));
		await run(s, "off");
		expect(await s.toolCall?.(bash("curl https://x"), ctx())).toBeUndefined();
		expect((await run(s, "on"))[0]).toStartWith("info: hackbot-judge: on, rubric");
	});

	test("a failed attach reports why and keeps the current rubric", async () => {
		const [s] = sessions({ ...on }, answer("deny", 0));
		expect(await run(s, "on /no/such/rubric.md")).toEqual([expect.stringContaining("error: hackbot-judge: not attached (")]);
		expect(await s.toolCall?.(bash("curl https://x"), ctx())).toEqual({ block: true, reason: DENIED });
		expect(await run(sessions({}, never)[0], "on")).toEqual(["error: hackbot-judge: not attached (no rubric: pass a path, or set OMP_HACKBOT_JUDGE)"]);
	});

	test("the SHA-256 pin also guards a rubric attached in the session", async () => {
		const [s] = sessions({ OMP_HACKBOT_JUDGE_SHA256: "0".repeat(64) }, never);
		expect(await run(s, `on ${rubric}`)).toEqual(["error: hackbot-judge: not attached (rubric SHA-256 mismatch)"]);
	});

	test("try judges a shell command against the attached rubric without running it", async () => {
		const log = join(dir, "try.jsonl");
		const [s] = sessions({ ...on, OMP_HACKBOT_JUDGE_LOG: log }, answer("deny", 0.03));
		expect(await run(s, "try curl https://x")).toEqual(["warning: hackbot-judge: DENY bash: rubric forbids, P(allow) 0.03"]);
		expect(JSON.parse(readFileSync(log, "utf8").trim().split("\n")[1])).toMatchObject({
			event: "try",
			command: "curl https://x",
			allowed: false,
			pAllow: 0.03,
		});
	});

	test("anything else prints usage", async () => {
		expect(await run(sessions({ ...on }, never)[0], "bogus")).toEqual(["warning: usage: /hackbot-judge [on [rubric path] | off | try <shell command>]"]);
		expect(await run(sessions({}, never)[0], "try ls")).toEqual(["warning: usage: /hackbot-judge [on [rubric path] | off | try <shell command>]"]);
	});
});
