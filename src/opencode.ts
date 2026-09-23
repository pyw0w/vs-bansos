// OpenCode Zen free-tier client fingerprint (ported from pi-bansos).
// Missing any gate → 403 FreeTierError.
import { randomBytes } from "node:crypto";

export const UPSTREAM_OPENCODE = "https://opencode.ai/zen";
export const KILO_CHAT_URL =
	"https://api.kilo.ai/api/gateway/chat/completions";
export const OPENCODE_API = `${UPSTREAM_OPENCODE}/v1`;

const OPENCODE_UA = "opencode/1.18.31";
const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62 =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"] as const;

let lastSessionTs = 0;
let sessionCounter = 0;

function unstableRandom(): string {
	const bytes = randomBytes(14);
	let out = "";
	for (let i = 0; i < 14; i++) out += BASE62[bytes[i]! % 62];
	return out;
}

function timeHexFrom(value: bigint): string {
	return Array.from({ length: 6 }, (_, i) =>
		Number((value >> BigInt(40 - 8 * i)) & 0xffn)
			.toString(16)
			.padStart(2, "0"),
	).join("");
}

function generateSessionId(timestamp = Date.now()): string {
	if (timestamp !== lastSessionTs) {
		lastSessionTs = timestamp;
		sessionCounter = 0;
	}
	sessionCounter++;
	const current = BigInt(timestamp) * 0x1000n + BigInt(sessionCounter);
	return `ses_${timeHexFrom(~current)}${unstableRandom()}`;
}

function generateRequestId(timestamp = Date.now()): string {
	const current = BigInt(timestamp) * 0x1000n + 1n;
	return `msg_${timeHexFrom(current)}${unstableRandom()}`;
}

// One stable session per extension-host process.
const OPENCODE_SESSION = generateSessionId();
if (!OPENCODE_SESSION_RE.test(OPENCODE_SESSION)) {
	throw new Error("opencode session id generation failed shape check");
}

export function opencodeHeaders(): Record<string, string> {
	return {
		"User-Agent": OPENCODE_UA,
		Authorization: "Bearer public",
		"x-opencode-client": "desktop",
		"x-opencode-project": "global",
		"x-opencode-session": OPENCODE_SESSION,
		"x-opencode-request": generateRequestId(),
		Accept: "text/event-stream",
	};
}

type FnTool = {
	type: "function";
	function: { name: string; description: string; parameters: object };
};

function toolNameOf(tool: unknown): string {
	if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
	const t = tool as Record<string, unknown>;
	const fn =
		t.function && typeof t.function === "object" && !Array.isArray(t.function)
			? (t.function as Record<string, unknown>)
			: null;
	const raw =
		typeof t.name === "string"
			? t.name
			: typeof fn?.name === "string"
				? fn.name
				: "";
	return raw.trim();
}

function ensureChatFingerprintTools(body: Record<string, unknown>): void {
	const present = new Set<string>();
	if (!Array.isArray(body.tools)) body.tools = [];
	for (const tool of body.tools as unknown[]) {
		const name = toolNameOf(tool);
		if (name) present.add(name);
	}
	for (const name of FINGERPRINT_TOOLS) {
		if (present.has(name)) continue;
		const stub: FnTool = {
			type: "function",
			function: {
				name,
				description: `OpenCode built-in ${name} tool`,
				parameters: { type: "object", properties: {} },
			},
		};
		(body.tools as unknown[]).push(stub);
	}
}

function ensureResponsesFingerprintTools(body: Record<string, unknown>): void {
	const present = new Set<string>();
	if (!Array.isArray(body.tools)) body.tools = [];
	for (const tool of body.tools as unknown[]) {
		const name = toolNameOf(tool);
		if (name) present.add(name);
	}
	for (const name of FINGERPRINT_TOOLS) {
		if (present.has(name)) continue;
		(body.tools as unknown[]).push({
			type: "function",
			name,
			description: `OpenCode built-in ${name} tool`,
			parameters: { type: "object", properties: {} },
		});
	}
}

export function sanitizeResponsesItems(body: Record<string, unknown>): void {
	if (!Array.isArray(body.input)) return;
	body.input = (body.input as unknown[]).filter((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return true;
		const it = item as Record<string, unknown>;
		// Drop prior-turn reasoning: pooled Bearer public cannot decrypt
		// encrypted_content across rotated Console accounts (400).
		if (it.type === "reasoning") return false;
		delete it.encrypted_content;
		delete it.reasoning_encrypted_content;
		return true;
	});
}

/**
 * Rewrite an OpenCode chat-completions body to pass Zen client fingerprint gates.
 * (Responses bodies are prepared directly by the provider; see prepareResponsesBody.)
 */
export function transformOpencodeChatBody(
	body: Record<string, unknown>,
): Record<string, unknown> {
	// Gate: stream:false → 403 even with valid UA/session/tools.
	body.stream = true;
	ensureChatFingerprintTools(body);
	return body;
}

export function prepareResponsesBody(
	body: Record<string, unknown>,
): Record<string, unknown> {
	body.stream = true;
	body.store = false;
	if (body.max_output_tokens === undefined) {
		if (typeof body.max_completion_tokens === "number")
			body.max_output_tokens = body.max_completion_tokens;
		else if (typeof body.max_tokens === "number")
			body.max_output_tokens = body.max_tokens;
	}
	delete body.max_tokens;
	delete body.max_completion_tokens;
	ensureResponsesFingerprintTools(body);
	sanitizeResponsesItems(body);
	return body;
}
