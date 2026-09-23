// Startup health check: fetch upstream catalogs once and register only models
// that are actually listed (ported from pi-bansos behavior).
import {
	OPENCODE_API,
	KILO_CHAT_URL,
	opencodeHeaders,
} from "./opencode";
import {
	OPENCODE_MODELS,
	KILO_MODELS,
	type ModelDef,
	type Upstream,
} from "./models";

export type RegisteredModel = ModelDef;

let aliveCatalog: RegisteredModel[] = [];
let checked = false;
let checking: Promise<RegisteredModel[]> | null = null;

async function fetchCatalogIds(
	url: string,
	headers: Record<string, string>,
): Promise<Set<string> | null> {
	try {
		const r = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(10_000),
		});
		if (!r.ok) return null;
		const d = (await r.json()) as { data?: { id: string }[] };
		return new Set<string>((d?.data ?? []).map((m) => m.id));
	} catch {
		return null;
	}
}

const opencodeCatalog = () =>
	fetchCatalogIds(`${OPENCODE_API}/models`, opencodeHeaders());
const kiloCatalog = () =>
	fetchCatalogIds(
		KILO_CHAT_URL.replace("/chat/completions", "/models"),
		{ Authorization: "Bearer kilo-free" },
	);

/**
 * Check both catalogs and keep only alive models. On total network failure
 * both catalogs are null — keep previously known list (or the full static
 * list on first run) so the picker is not empty while offline.
 */
export async function runHealthCheck(
	force = false,
): Promise<RegisteredModel[]> {
	if (checked && !force) return aliveCatalog;
	if (checking && !force) return checking;

	checking = (async () => {
		const [oc, kc] = await Promise.all([opencodeCatalog(), kiloCatalog()]);
		const bothDown = oc === null && kc === null;
		if (bothDown && aliveCatalog.length) {
			// Keep previous results; retry later via refresh command.
			return aliveCatalog;
		}
		const ocAlive = OPENCODE_MODELS.filter((m) =>
			bothDown ? true : (oc?.has(m.id) ?? false),
		);
		const kcAlive = KILO_MODELS.filter((m) =>
			bothDown ? true : (kc?.has(m.id) ?? false),
		);
		aliveCatalog = [...ocAlive, ...kcAlive];
		checked = true;
		return aliveCatalog;
	})();

	try {
		return await checking;
	} finally {
		checking = null;
	}
}

export function getAliveCatalog(): RegisteredModel[] {
	return aliveCatalog;
}

export function sourceLabel(s: Upstream): string {
	return s === "kilo" ? "KiloCode" : "OpenCode";
}
