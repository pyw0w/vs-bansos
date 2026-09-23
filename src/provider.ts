// BansosChatModelProvider — contributes free models to the VS Code /
// Copilot Chat model picker via the Language Model Chat Provider API.
// Streaming, tool calling, vision, relay egress and rate guards ported
// from pi-bansos behavior, adapted to the extension-host fetch path.
import * as vscode from "vscode";
import {
	LanguageModelChatInformation,
	LanguageModelChatProvider,
	LanguageModelChatRequestMessage,
	LanguageModelChatMessageRole,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	LanguageModelDataPart,
	LanguageModelChatTool,
	LanguageModelChatToolMode,
	LanguageModelResponsePart,
	ProvideLanguageModelChatResponseOptions,
	Progress,
	CancellationToken,
} from "vscode";
import { KILO_CHAT_URL, OPENCODE_API, opencodeHeaders, transformOpencodeChatBody, prepareResponsesBody } from "./opencode";
import { relayFetch, relayState, clampForRelay } from "./relay";
import { getAliveCatalog, runHealthCheck, sourceLabel, type RegisteredModel } from "./health";
import { modelById, type Upstream } from "./models";

// ── Local rate guards (mirror pi-bansos) ──────────────────────────
// Kilo: 200 req/hour/IP. OpenCode: own daily quota; guard just stops floods.
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_MAX: Record<Upstream, number> = { opencode: 200, kilo: 200 };

function rateKey(upstream: Upstream): string {
	const now = Date.now();
	if (upstream === "kilo") {
		// rolling one-hour window
		return `kilo:${Math.floor(now / 3_600_000)}`;
	}
	return `opencode:${new Date(now).toISOString().slice(0, 10)}`;
}

function checkRateLimit(upstream: Upstream): boolean {
	const key = rateKey(upstream);
	const now = Date.now();
	const entry = rateMap.get(key);
	if (!entry || entry.resetAt <= now) {
		const resetAt =
			upstream === "kilo"
				? now + 3_600_000
				: (() => {
						const d = new Date(now);
						d.setUTCHours(24, 0, 0, 0);
						return d.getTime();
					})();
		rateMap.set(key, { count: 1, resetAt });
		return true;
	}
	if (entry.count >= RATE_MAX[upstream]) return false;
	entry.count++;
	return true;
}

export function resetRateLimits(): void {
	rateMap.clear();
}

// ── Type helpers ──────────────────────────────────────────────────
type ChatRole = "user" | "assistant" | "system" | "tool";
interface ChatMessage {
	role: ChatRole;
	content: string | ContentPart[] | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
}
interface ContentPart {
	type: "text" | "image_url" | "input_text" | "input_image";
	text?: string;
	image_url?: { url: string };
}
interface ToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

function partText(content: readonly unknown[]): string {
	const out: string[] = [];
	for (const part of content) {
		if (part instanceof LanguageModelTextPart) out.push(part.value);
		else if (part && typeof part === "object" && "value" in part && typeof (part as { value: unknown }).value === "string") {
			// prompt-tsx / unknown text-like parts
			out.push((part as { value: string }).value);
		}
	}
	return out.join("");
}

function dataPartToImageUrl(part: unknown): string | null {
	if (part instanceof LanguageModelDataPart) {
		if (part.mimeType.startsWith("image/")) {
			const b64 = Buffer.from(part.data).toString("base64");
			return `data:${part.mimeType};base64,${b64}`;
		}
	}
	return null;
}

// ── Request body builders ─────────────────────────────────────────
interface ConvertedBody {
	messages: ChatMessage[]; // used for chat API
	input?: unknown[]; // used for responses API
	usesResponses: boolean;
}

function convertMessages(
	messages: readonly LanguageModelChatRequestMessage[],
): ConvertedBody {
	const chat: ChatMessage[] = [];
	const responsesInput: unknown[] = [];

	for (const msg of messages) {
		const isUser = msg.role === LanguageModelChatMessageRole.User;
		const textParts: string[] = [];
		const imageParts: string[] = [];
		const toolResults: LanguageModelToolResultPart[] = [];
		const toolCalls: ToolCall[] = [];

		for (const part of msg.content) {
			if (part instanceof LanguageModelTextPart) {
				textParts.push(part.value);
			} else if (part instanceof LanguageModelToolResultPart) {
				toolResults.push(part);
			} else if (part instanceof LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: "function",
					function: {
						name: part.name,
						arguments: JSON.stringify(part.input ?? {}),
					},
				});
			} else {
				const url = dataPartToImageUrl(part);
				if (url) imageParts.push(url);
			}
		}

		if (isUser) {
			// tool results become standalone "tool" messages (chat API)
			for (const tr of toolResults) {
				const text = partText(tr.content);
				const imgs: string[] = [];
				for (const c of tr.content) {
					const u = dataPartToImageUrl(c);
					if (u) imgs.push(u);
				}
				chat.push({
					role: "tool",
					tool_call_id: tr.callId,
					content: imgs.length && !text
						? JSON.stringify(imgs.map((u) => ({ type: "image_url", image_url: { url: u } })))
						: text || "(no result)",
				});
				responsesInput.push({
					type: "function_call_output",
					call_id: tr.callId,
					output: text || "(no result)",
				});
			}

			const content: ContentPart[] = textParts.map((t) => ({
				type: "text",
				text: t,
			}));
			for (const u of imageParts) {
				content.push({ type: "image_url", image_url: { url: u } });
			}
			if (content.length) {
				chat.push({
					role: "user",
					content: imageParts.length ? content : textParts.join(""),
				});
				responsesInput.push({
					type: "message",
					role: "user",
					content: content.map((c) =>
						c.type === "text"
							? { type: "input_text", text: c.text }
							: { type: "input_image", image_url: c.image_url!.url },
					),
				});
			}
		} else {
			// assistant message: text + previous tool calls
			const content: ContentPart[] = textParts.map((t) => ({
				type: "text",
				text: t,
			}));
			for (const u of imageParts) {
				content.push({ type: "image_url", image_url: { url: u } });
			}
			if (textParts.length || toolCalls.length) {
				chat.push({
					role: "assistant",
					content: textParts.length
						? imageParts.length
							? content
							: textParts.join("")
						: null,
					tool_calls: toolCalls.length ? toolCalls : undefined,
				});
				if (textParts.length) {
					responsesInput.push({
						type: "message",
						role: "assistant",
						content: textParts.map((t) => ({ type: "output_text", text: t })),
					});
				}
				for (const tc of toolCalls) {
					responsesInput.push({
						type: "function_call",
						call_id: tc.id,
						name: tc.function.name,
						arguments: tc.function.arguments,
					});
				}
			}
		}
	}

	return {
		messages: chat,
		input: responsesInput,
		usesResponses: false, // set by caller for muse models
	};
}

function convertTools(
	tools: readonly LanguageModelChatTool[] | undefined,
	usesResponses: boolean,
): unknown[] | undefined {
	if (!tools || !tools.length) return undefined;
	return tools.map((t) =>
		usesResponses
			? {
					type: "function",
					name: t.name,
					description: t.description,
					parameters: t.inputSchema ?? { type: "object", properties: {} },
				}
			: {
					type: "function",
					function: {
						name: t.name,
						description: t.description,
						parameters: t.inputSchema ?? { type: "object", properties: {} },
					},
				},
	);
}

// ── SSE parsing helpers ───────────────────────────────────────────
async function* sseLines(
	res: Response,
	signal: AbortSignal,
): AsyncGenerator<string> {
	const reader = res.body?.getReader();
	if (!reader) return;
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			if (signal.aborted) break;
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith("data:")) yield trimmed.slice(5).trim();
			}
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* reader already released/closed */
		}
	}
}

function safeJsonParse(s: string): Record<string, unknown> | null {
	try {
		return JSON.parse(s) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** LanguageModelError with a code; static factories when available. */
function lmError(message: string, code?: "NotFound" | "Blocked"): vscode.LanguageModelError {
	if (code === "NotFound") return vscode.LanguageModelError.NotFound(message);
	if (code === "Blocked") return vscode.LanguageModelError.Blocked(message);
	return new vscode.LanguageModelError(message);
}

/**
 * Read reasoning effort from VS Code `options.modelOptions` (free-form dict;
 * key names vary). Mirrors pi behavior: "off"/"none" → undefined, i.e. the
 * field is omitted entirely (pi: thinkingLevelMap off→null, and
 * `clamped === "off" ? undefined`).
 */
function effortFromModelOptions(modelOptions: unknown): string | undefined {
	if (!modelOptions || typeof modelOptions !== "object") return undefined;
	const mo = modelOptions as Record<string, unknown>;
	const nestedReasoning =
		typeof mo.reasoning === "object" && mo.reasoning !== null
			? (mo.reasoning as Record<string, unknown>).effort
			: mo.reasoning;
	for (const raw of [
		mo.reasoningEffort,
		mo.reasoning_effort,
		mo.effort,
		nestedReasoning,
	]) {
		if (typeof raw === "string" && raw) {
			const v = raw.toLowerCase();
			// "off"/"none" suppress the field (Muse rejects effort:"none").
			if (v === "off" || v === "none") return undefined;
			return v;
		}
	}
	return undefined;
}

// ── The provider ──────────────────────────────────────────────────
export class BansosChatModelProvider
	implements LanguageModelChatProvider
{
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	async refresh(): Promise<void> {
		await runHealthCheck(true);
		this._onDidChange.fire();
	}

	provideLanguageModelChatInformation(
		_options: { silent: boolean },
		_token: CancellationToken,
	): Thenable<LanguageModelChatInformation[]> {
		return runHealthCheck().then((models) =>
			models.map((m) => this.toInfo(m)),
		);
	}

	private toInfo(m: RegisteredModel): LanguageModelChatInformation {
		const supportsImage = Boolean(m.input?.includes("image"));
		return {
			id: m.id,
			name: `${sourceLabel(m.source)} · ${m.name}`,
			family: m.source === "kilo" ? "kilocode" : "opencode",
			version: "1.0.0",
			tooltip:
				`${m.name} (${m.id})\n` +
				`Upstream: ${sourceLabel(m.source)} — free, no API key\n` +
				`Context: ${Math.round(m.contextWindow / 1000)}K · ` +
				`Max output: ${Math.round(m.maxTokens / 1000)}K\n` +
				`Reasoning: ${m.reasoning ? "yes" : "no"} · ` +
				`Vision: ${supportsImage ? "yes" : "no"}` +
				(m.thinkingFormat ? "\nThinking: openrouter format" : ""),
			detail:
				`${sourceLabel(m.source)} · ${Math.round(m.contextWindow / 1000)}K ctx` +
				(supportsImage ? " · vision" : ""),
			maxInputTokens: Math.max(1, m.contextWindow - m.maxTokens),
			maxOutputTokens: m.maxTokens,
			capabilities: {
				imageInput: supportsImage,
				toolCalling: true,
			},
		};
	}

	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatRequestMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken,
	): Promise<void> {
		const def = modelById(model.id);
		if (!def) {
			throw lmError(`bansos: unknown model ${model.id}`, "NotFound");
		}
		if (!checkRateLimit(def.source)) {
			throw lmError(
				`bansos: local ${def.source} rate limit reached — try later or refresh`,
				"Blocked",
			);
		}

		const usesResponses = def.api === "openai-responses";
		const converted = convertMessages(messages);
		const tools = convertTools(options.tools, usesResponses);
		const required =
			options.toolMode === LanguageModelChatToolMode.Required;
		const effort = effortFromModelOptions(options.modelOptions);

		let body: Record<string, unknown>;
		let url: string;
		let headers: Record<string, string>;

		if (usesResponses) {
			body = {
				model: def.id,
				input: converted.input ?? [],
				stream: true,
				store: false,
				...(tools ? { tools } : {}),
				...(required ? { tool_choice: "required" } : {}),
				...(effort ? { reasoning: { effort } } : {}),
			};
			prepareResponsesBody(body);
			clampForRelay(body);
			url = relayState.enabled && relayState.url
				? relayState.url
				: `${OPENCODE_API}/responses`;
			headers = { ...opencodeHeaders(), "content-type": "application/json" };
		} else if (def.source === "kilo") {
			body = {
				model: def.id,
				messages: converted.messages,
				stream: true,
				...(tools ? { tools } : {}),
				...(required ? { tool_choice: "required" } : {}),
			};
			clampForRelay(body);
			url = KILO_CHAT_URL;
			// Kilo free tier is anonymous: no Authorization header.
			// (Bearer kilo-free → 401 INVALID_TOKEN.)
			headers = {
				"Content-Type": "application/json",
			};
		} else {
			body = {
				model: def.id,
				messages: converted.messages,
				stream: true,
				...(tools ? { tools } : {}),
				...(required ? { tool_choice: "required" } : {}),
				// OpenCode chat models: compat.supportsReasoningEffort → true
				// upstream; Kilo (branch above) never sends effort.
				...(effort ? { reasoning_effort: effort } : {}),
			};
			transformOpencodeChatBody(body);
			clampForRelay(body);
			url = `${OPENCODE_API}/chat/completions`;
			headers = { ...opencodeHeaders(), "content-type": "application/json" };
		}

		// Relay path: re-target via x-relay-headers (relayFetch handles it).
		// Direct path for responses models must hit /responses — handled below.
		const controller = new AbortController();
		const cancel = () => controller.abort();
		token.onCancellationRequested(cancel);

		let res: Response;
		try {
			res = await relayFetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			} as RequestInit);
		} catch (e) {
			if (controller.signal.aborted) return;
			throw lmError(`bansos: network error — ${String(e)}`);
		}

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw lmError(
				`bansos: upstream ${res.status} — ${text.slice(0, 500)}`,
				res.status === 404 ? "NotFound" : res.status === 429 ? "Blocked" : undefined,
			);
		}

		if (usesResponses) {
			await this.streamResponses(res, controller.signal, progress, token);
		} else {
			await this.streamChat(res, controller.signal, progress, token, def);
		}
	}

	// OpenAI Chat Completions SSE → VS Code parts.
	private async streamChat(
		res: Response,
		signal: AbortSignal,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken,
		def: RegisteredModel,
	): Promise<void> {
		type PendingCall = { id: string; name: string; args: string };
		const pending = new Map<number, PendingCall>();
		let reasoningBuffer = "";
		let emittedText = false;

		for await (const data of sseLines(res, signal)) {
			if (token.isCancellationRequested) return;
			if (!data || data === "[DONE]") break;
			const chunk = safeJsonParse(data);
			if (!chunk) continue;
			if (chunk.error) {
				throw lmError(`bansos: ${JSON.stringify(chunk.error)}`);
			}
			const choices = chunk.choices as
				| { delta?: Record<string, unknown>; finish_reason?: string }[]
				| undefined;
			const delta = choices?.[0]?.delta;
			if (!delta) continue;

			const content = delta.content;
			if (typeof content === "string" && content) {
				emittedText = true;
				progress.report(new LanguageModelTextPart(content));
			}
			// Some upstreams (nemotron-super) stream into reasoning fields.
			const reasoning =
				(delta as { reasoning?: unknown }).reasoning ??
				(delta as { reasoning_content?: unknown }).reasoning_content;
			if (typeof reasoning === "string" && reasoning) {
				reasoningBuffer += reasoning;
			}

			const tcRaw = delta.tool_calls as
				| { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
				| undefined;
			if (Array.isArray(tcRaw)) {
				for (const tc of tcRaw) {
					const idx = tc.index ?? 0;
					let entry = pending.get(idx);
					if (!entry) {
						entry = { id: tc.id ?? `call_${idx}`, name: "", args: "" };
						pending.set(idx, entry);
					}
					if (tc.id) entry.id = tc.id;
					if (tc.function?.name) entry.name += tc.function.name;
					if (tc.function?.arguments) entry.args += tc.function.arguments;
				}
			}

			if (choices?.[0]?.finish_reason === "tool_calls") break;
		}

		// flush tool calls
		for (const call of pending.values()) {
			if (!call.name) continue;
			let input: object = {};
			try {
				input = call.args ? (JSON.parse(call.args) as object) : {};
			} catch {
				input = {};
			}
			progress.report(new LanguageModelToolCallPart(call.id, call.name, input));
		}

		// If the model only produced reasoning (known nemotron quirk), show it.
		if (!emittedText && reasoningBuffer) {
			progress.report(new LanguageModelTextPart(reasoningBuffer));
		}
		void def;
	}

	// OpenAI Responses SSE → VS Code parts.
	private async streamResponses(
		res: Response,
		signal: AbortSignal,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken,
	): Promise<void> {
		for await (const data of sseLines(res, signal)) {
			if (token.isCancellationRequested) return;
			if (!data || data === "[DONE]") break;
			// Responses API events: "event: X" lines are separate, data lines carry JSON.
			const chunk = safeJsonParse(data);
			if (!chunk) continue;

			const type = typeof chunk.type === "string" ? chunk.type : "";
			if (type === "response.output_text.delta") {
				if (typeof chunk.delta === "string" && chunk.delta) {
					progress.report(new LanguageModelTextPart(chunk.delta));
				}
			} else if (type === "response.output_item.done") {
				const item = chunk.item as
					| { type?: string; call_id?: string; name?: string; arguments?: string }
					| undefined;
				if (item?.type === "function_call" && item.call_id && item.name) {
					let input: object = {};
					try {
						input = item.arguments ? (JSON.parse(item.arguments) as object) : {};
					} catch {
						input = {};
					}
					progress.report(
						new LanguageModelToolCallPart(item.call_id, item.name, input),
					);
				}
			} else if (type === "response.failed" || type === "error") {
				throw lmError(`bansos: ${JSON.stringify(chunk).slice(0, 500)}`);
			}
		}
	}

	async provideTokenCount(
		_model: LanguageModelChatInformation,
		text: string | LanguageModelChatRequestMessage,
		_token: CancellationToken,
	): Promise<number> {
		if (typeof text === "string") {
			return Math.ceil(text.length / 4);
		}
		let total = 0;
		for (const part of text.content) {
			if (part instanceof LanguageModelTextPart) total += part.value.length;
		}
		return Math.ceil(total / 4);
	}
}

export function aliveCount(): number {
	return getAliveCatalog().length;
}
