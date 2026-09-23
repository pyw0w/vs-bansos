// Smoke test: activates the bundled extension against a vscode stub,
// lists alive models, then sends a real chat request upstream.
const Module = require("node:module");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

class Emitter {
	constructor() { this.listeners = []; }
	get event() { return (l) => { this.listeners.push(l); return { dispose() {} }; }; }
	fire(v) { for (const l of this.listeners) l(v); }
}
class LanguageModelTextPart { constructor(v) { this.value = v; } }
class LanguageModelToolCallPart { constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input; } }
class LanguageModelToolResultPart { constructor(callId, content) { this.callId = callId; this.content = content; } }
class LanguageModelDataPart {
	constructor(data, mimeType) { this.data = data; this.mimeType = mimeType; }
	static image(d, m) { return new LanguageModelDataPart(d, m); }
}
class LanguageModelError extends Error {
	constructor(msg, code) { super(msg); this.code = code || "Unknown"; }
	static NotFound(m) { return new LanguageModelError(m, "NotFound"); }
	static Blocked(m) { return new LanguageModelError(m, "Blocked"); }
	static NoPermissions(m) { return new LanguageModelError(m, "NoPermissions"); }
}
const LanguageModelChatMessageRole = { User: 1, Assistant: 2 };
const LanguageModelChatToolMode = { Auto: 1, Required: 2 };
class CancellationTokenSource {
	constructor() {
		this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
	}
	cancel() { this.token.isCancellationRequested = true; }
	dispose() {}
}

let registeredProvider = null;
const vscodeStub = {
	EventEmitter: Emitter,
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	LanguageModelToolResultPart,
	LanguageModelDataPart,
	LanguageModelError,
	LanguageModelChatMessageRole,
	LanguageModelChatToolMode,
	CancellationTokenSource,
	StatusBarAlignment: { Right: 2 },
	ProgressLocation: { Notification: 15 },
	lm: {
		registerLanguageModelChatProvider: (vendor, provider) => {
			registeredProvider = provider;
			console.log(`[stub] registered vendor=${vendor}`);
			return { dispose() {} };
		},
	},
	window: {
		createStatusBarItem: () => ({ show() {}, dispose() {}, text: "", tooltip: "", command: "" }),
		showInformationMessage: (m) => { console.log("[info]", m); return Promise.resolve(); },
		showWarningMessage: (m) => { console.log("[warn]", m); return Promise.resolve(); },
		showErrorMessage: (m) => { console.log("[error]", m); return Promise.resolve(); },
		showQuickPick: () => Promise.resolve(undefined),
		showInputBox: () => Promise.resolve(undefined),
		withProgress: (_o, task) => task(),
	},
	commands: { registerCommand: () => ({ dispose() {} }) },
};

const origLoad = Module._load;
Module._load = function (request) {
	if (request === "vscode") return vscodeStub;
	return origLoad.apply(this, arguments);
};

(async () => {
	const ext = require(path.join(__dirname, "..", "out", "extension.js"));
	const storage = fs.mkdtempSync(path.join(os.tmpdir(), "bansos-smoke-"));
	const ctx = {
		globalStorageUri: { fsPath: storage },
		subscriptions: [],
		storagePath: storage,
		globalStoragePath: storage,
	};
	await ext.activate(ctx);
	if (!registeredProvider) throw new Error("provider not registered");

	const token = new CancellationTokenSource().token;
	const models = await registeredProvider.provideLanguageModelChatInformation({ silent: true }, token);
	console.log(`alive models: ${models.length}`);
	for (const m of models.slice(0, 40)) console.log(` - ${m.name} [${m.id}] toolCalling=${m.capabilities.toolCalling} vision=${m.capabilities.imageInput}`);
	if (!models.length) throw new Error("no alive models");

	// pick a lightweight kilo model first
	const target =
		models.find((m) => m.id === "kilo-auto/free") ||
		models.find((m) => m.id.includes("free"));
	console.log(`\nchat test → ${target.id}`);
	const messages = [
		{ role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart("Reply with exactly OK.")], name: undefined },
	];
	let text = "";
	const started = Date.now();
	await registeredProvider.provideLanguageModelChatResponse(
		target,
		messages,
		{ toolMode: 1 },
		{ report: (part) => { if (part instanceof LanguageModelTextPart) text += part.value; } },
		token,
	);
	console.log(`reply (${Date.now() - started}ms): ${JSON.stringify(text.slice(0, 200))}`);
	if (!text.trim()) throw new Error("empty reply");
	console.log("\nSMOKE OK");
	ext.deactivate();
	process.exit(0);
})().catch((e) => {
	console.error("SMOKE FAILED:", e);
	process.exit(1);
});
