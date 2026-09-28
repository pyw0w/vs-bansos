// Relay egress (Vercel/Cloudflare worker, x-relay-target pattern).
// Ported from pi-bansos: state lives in extension globalStorage, token for
// deploy is used in-memory only and never persisted.
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

export type KnownRelay = { url: string; label?: string; addedAt?: string };
export type RelayState = {
	enabled: boolean;
	url: string;
	relays: KnownRelay[];
	statusBarVisible: boolean;
	/** rolling counters for status display */
	hits: number;
};

type PersistedRelayState = Pick<
	RelayState,
	"enabled" | "url" | "relays" | "statusBarVisible"
>;

const VERCEL_API = "https://api.vercel.com";

// Only the 2 upstreams we talk to. Anything else = open proxy abuse.
const VERCEL_RELAY_WORKER = `// Only the 2 upstreams vs-bansos talks to. Anything else = open proxy abuse.
const ALLOWED_TARGETS = ["https://opencode.ai", "https://api.kilo.ai"];
export const config = { runtime: "edge" };
export default async function handler(req) {
  const target = req.headers.get("x-relay-target");
  const relayPath = req.headers.get("x-relay-path") || "/";
  if (!target) return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), { status: 400, headers: { "content-type": "application/json" } });
  const cleanTarget = target.replace(/\\/$/, "");
  if (!ALLOWED_TARGETS.includes(cleanTarget)) return new Response(JSON.stringify({ error: "Forbidden target" }), { status: 403, headers: { "content-type": "application/json" } });
  if (!relayPath.startsWith("/")) return new Response(JSON.stringify({ error: "Bad path" }), { status: 400, headers: { "content-type": "application/json" } });
  const targetUrl = cleanTarget + relayPath;
  const headers = new Headers(req.headers);
  headers.delete("x-relay-target"); headers.delete("x-relay-path"); headers.delete("host");
  const response = await fetch(targetUrl, { method: req.method, headers, body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined, duplex: "half" });
  return new Response(response.body, { status: response.status, headers: response.headers });
}`;

let stateFile = "";
let lastSavedState: PersistedRelayState = {
	enabled: false,
	url: "",
	relays: [],
	statusBarVisible: true,
};
export const relayState: RelayState = {
	enabled: false,
	url: "",
	relays: [],
	statusBarVisible: true,
	hits: 0,
};

function persistedState(): PersistedRelayState {
	return {
		enabled: relayState.enabled,
		url: relayState.url,
		relays: relayState.relays.map((relay) => ({ ...relay })),
		statusBarVisible: relayState.statusBarVisible,
	};
}

function readPersistedState(): PersistedRelayState {
	try {
		const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
		return {
			enabled: Boolean(s?.enabled),
			url: typeof s?.url === "string" ? s.url.trim() : "",
			relays: Array.isArray(s?.relays)
				? s.relays.filter(
						(relay: unknown): relay is KnownRelay =>
							Boolean(
								relay &&
								typeof relay === "object" &&
								typeof (relay as KnownRelay).url === "string",
							),
					)
				: [],
			statusBarVisible: s?.statusBarVisible !== false,
		};
	} catch {
		return {
			...lastSavedState,
			relays: lastSavedState.relays.map((relay) => ({ ...relay })),
		};
	}
}

function mergeRelayList(
	base: KnownRelay[],
	local: KnownRelay[],
	latest: KnownRelay[],
): KnownRelay[] {
	const result = latest.map((relay) => ({ ...relay }));
	const baseByUrl = new Map(base.map((relay) => [relay.url, relay]));
	const localByUrl = new Map(local.map((relay) => [relay.url, relay]));

	for (const [url, previous] of baseByUrl) {
		const changed = localByUrl.get(url);
		if (!changed) {
			const index = result.findIndex((relay) => relay.url === url);
			if (index >= 0) result.splice(index, 1);
		} else if (JSON.stringify(changed) !== JSON.stringify(previous)) {
			const index = result.findIndex((relay) => relay.url === url);
			if (index >= 0) result[index] = { ...changed };
			else result.push({ ...changed });
		}
	}

	for (const relay of local) {
		if (!baseByUrl.has(relay.url) && !result.some((item) => item.url === relay.url)) {
			result.push({ ...relay });
		}
	}
	return result;
}

function mergePersistedState(
	base: PersistedRelayState,
	local: PersistedRelayState,
	latest: PersistedRelayState,
): PersistedRelayState {
	return {
		enabled: local.enabled === base.enabled ? latest.enabled : local.enabled,
		url: local.url === base.url ? latest.url : local.url,
		statusBarVisible:
			local.statusBarVisible === base.statusBarVisible
				? latest.statusBarVisible
				: local.statusBarVisible,
		relays: mergeRelayList(base.relays, local.relays, latest.relays),
	};
}

function restoreLastSavedState(): void {
	relayState.enabled = lastSavedState.enabled;
	relayState.url = lastSavedState.url;
	relayState.relays = lastSavedState.relays.map((relay) => ({ ...relay }));
	relayState.statusBarVisible = lastSavedState.statusBarVisible;
}

export function initRelayState(storageDir: string): void {
	stateFile = path.join(storageDir, "relay-state.json");
	try {
		const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
		relayState.enabled = Boolean(s?.enabled);
		relayState.url = typeof s?.url === "string" ? s.url.trim() : "";
		relayState.relays = Array.isArray(s?.relays) ? s.relays : [];
		relayState.statusBarVisible = s?.statusBarVisible !== false;
	} catch {
		/* first run */
	}
	lastSavedState = persistedState();
}

export function saveRelayState(): boolean {
	if (!stateFile) return false;
	const desiredState = persistedState();
	const nextState = mergePersistedState(
		lastSavedState,
		desiredState,
		readPersistedState(),
	);
	const tempFile = `${stateFile}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	try {
		fs.mkdirSync(path.dirname(stateFile), { recursive: true });
		fs.writeFileSync(tempFile, JSON.stringify(nextState), { mode: 0o600 });
		fs.renameSync(tempFile, stateFile);
		relayState.enabled = nextState.enabled;
		relayState.url = nextState.url;
		relayState.relays = nextState.relays.map((relay) => ({ ...relay }));
		relayState.statusBarVisible = nextState.statusBarVisible;
		lastSavedState = nextState;
		return true;
	} catch (e) {
		try {
			fs.rmSync(tempFile, { force: true });
		} catch {
			// Preserve the original persistence error.
		}
		restoreLastSavedState();
		console.error("[bansos] could not persist relay state", e);
		return false;
	}
}

export function ensureRelay(url: string, label?: string): void {
	if (!url || relayState.relays.some((r) => r.url === url)) return;
	relayState.relays.push({
		url,
		label,
		addedAt: new Date().toISOString(),
	});
}

export function removeRelay(url: string): void {
	relayState.relays = relayState.relays.filter((r) => r.url !== url);
}

export function setRelay(enabled: boolean, url: string, addLabel?: string): void {
	relayState.enabled = enabled;
	relayState.url = url.trim();
	if (relayState.url) ensureRelay(relayState.url, addLabel);
}

/** Relay-aware fetch. Direct when disabled; otherwise POST to relay URL. */
export async function relayFetch(
	url: string,
	opts: RequestInit = {},
): Promise<Response> {
	if (!relayState.enabled || !relayState.url) return fetch(url, opts);
	try {
		const u = new URL(url);
		relayState.hits++;
		const headers = new Headers(opts.headers);
		headers.set("x-relay-target", `${u.protocol}//${u.host}`);
		headers.set("x-relay-path", `${u.pathname}${u.search}`);
		return await fetch(relayState.url, { ...opts, headers });
	} catch (e) {
		console.error("[bansos] relay fetch failed, falling back to direct", e);
		return fetch(url, opts);
	}
}

/** Deploy a fresh Vercel relay. Token is used in-memory only, never stored. */
export async function deployVercelRelay(
	token: string,
	name: string,
	onProgress?: (msg: string) => void,
): Promise<string> {
	const auth = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
	onProgress?.("Uploading relay to Vercel…");
	const dep = await fetch(`${VERCEL_API}/v13/deployments`, {
		method: "POST",
		headers: auth,
		body: JSON.stringify({
			name,
			files: [
				{ file: "api/relay.js", data: VERCEL_RELAY_WORKER },
				{
					file: "package.json",
					data: JSON.stringify({ name, version: "1.0.0" }),
				},
				{
					file: "vercel.json",
					data: JSON.stringify({
						rewrites: [{ source: "/(.*)", destination: "/api/relay" }],
					}),
				},
			],
			projectSettings: { framework: null },
			target: "production",
		}),
	});
	if (!dep.ok) {
		const e = (await dep.json().catch(() => ({}))) as {
			error?: { message?: string };
		};
		throw new Error(
			e?.error?.message || `Vercel deploy failed (HTTP ${dep.status})`,
		);
	}
	const depJson = (await dep.json()) as {
		id?: string;
		uid?: string;
		projectId?: string;
	};
	const depId = depJson.id || depJson.uid || "";
	const projectId = depJson.projectId || name;
	await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
		method: "PATCH",
		headers: auth,
		body: JSON.stringify({ ssoProtection: null }),
	});
	onProgress?.("Waiting for deployment to go live…");
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const s = await fetch(`${VERCEL_API}/v13/deployments/${depId}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const j = (await s.json()) as {
			readyState?: string;
			url?: string;
		};
		if (j.readyState === "READY") return `https://${j.url}`;
		if (j.readyState === "ERROR" || j.readyState === "CANCELED")
			throw new Error(`Deployment failed: ${j.readyState}`);
		await new Promise((r) => setTimeout(r, 3000));
	}
	throw new Error("Deployment timed out (120s)");
}

// Vercel relay rejects very large max_tokens; clamp only in relay mode.
export const RELAY_MAX_TOKENS = 131_072;

export function clampForRelay(body: Record<string, unknown>): void {
	if (!relayState.enabled || !relayState.url) return;
	const mt =
		body.max_tokens ?? body.maxTokens ?? body.max_output_tokens;
	if (typeof mt === "number" && mt > RELAY_MAX_TOKENS) {
		if ("max_output_tokens" in body) body.max_output_tokens = RELAY_MAX_TOKENS;
		else body.max_tokens = RELAY_MAX_TOKENS;
	}
}

export function showRelayStatus(): string {
	return relayState.enabled
		? `Relay: ON → ${relayState.url} (hits=${relayState.hits}, saved=${relayState.relays.length})`
		: `Relay: OFF (direct, saved=${relayState.relays.length})`;
}
