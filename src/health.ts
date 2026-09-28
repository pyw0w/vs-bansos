// Startup catalog cache: register live-listed models, pinned exceptions, or
// the static catalog on a cold start when both upstreams are unavailable.
import * as fs from "node:fs";
import * as path from "node:path";
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

type CatalogCache = {
	fetchedAt: number;
	opencode?: string[];
	kilo?: string[];
};

const PINNED_KILO_IDS = new Set(["openrouter/free"]);

let aliveCatalog: RegisteredModel[] = [];
let checked = false;
let checking: Promise<RegisteredModel[]> | null = null;
let cacheFile = "";
let catalogCache: CatalogCache = { fetchedAt: 0 };

function validIdList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((id) => typeof id === "string");
}

function modelsFromCache(cache: CatalogCache): RegisteredModel[] {
	const opencode = new Set(cache.opencode ?? []);
	const kilo = new Set(cache.kilo ?? []);
	return [
		...OPENCODE_MODELS.filter((model) => opencode.has(model.id)),
		...KILO_MODELS.filter(
			(model) => kilo.has(model.id) || PINNED_KILO_IDS.has(model.id),
		),
	];
}

/** Load the last-known catalogs before the VS Code model picker requests them. */
export function initCatalogCache(storageDir: string): void {
	cacheFile = path.join(storageDir, "bansos-models.json");
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
		const value = raw as Record<string, unknown>;
		catalogCache = {
			fetchedAt: typeof value.fetchedAt === "number" ? value.fetchedAt : 0,
			...(validIdList(value.opencode) ? { opencode: value.opencode } : {}),
			...(validIdList(value.kilo) ? { kilo: value.kilo } : {}),
		};
		const hasCachedIds =
			(catalogCache.opencode?.length ?? 0) + (catalogCache.kilo?.length ?? 0) > 0;
		if (hasCachedIds) {
			aliveCatalog = modelsFromCache(catalogCache);
			checked = true;
		}
	} catch {
		// First run or unreadable cache: perform a live check.
	}
}

function saveCatalogCache(cache: CatalogCache): void {
	if (!cacheFile) return;
	const tempFile = `${cacheFile}.${process.pid}.tmp`;
	try {
		fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
		fs.writeFileSync(tempFile, JSON.stringify(cache), { mode: 0o600 });
		fs.renameSync(tempFile, cacheFile);
	} catch (error) {
		try {
			fs.rmSync(tempFile, { force: true });
		} catch {
			// Preserve the original cache-write failure.
		}
		console.error("[bansos] could not persist model catalog", error);
	}
}

async function fetchCatalogIds(
	url: string,
	headers?: Record<string, string>,
): Promise<Set<string> | null> {
	try {
		const r = await fetch(url, {
			...(headers ? { headers } : {}),
			signal: AbortSignal.timeout(10_000),
		});
		if (!r.ok) return null;
		const d: unknown = await r.json();
		if (!d || typeof d !== "object" || !Array.isArray((d as { data?: unknown }).data)) {
			return null;
		}
		const items = (d as { data: unknown[] }).data;
		if (
			!items.every(
				(item) =>
					item !== null &&
					typeof item === "object" &&
					typeof (item as { id?: unknown }).id === "string",
			)
		) {
			return null;
		}
		return new Set(items.map((item) => (item as { id: string }).id));
	} catch {
		return null;
	}
}

const opencodeCatalog = () =>
	fetchCatalogIds(`${OPENCODE_API}/models`, opencodeHeaders());
const kiloCatalog = () =>
	fetchCatalogIds(KILO_CHAT_URL.replace("/chat/completions", "/models"));

/**
 * Check both catalogs and keep only alive models. On total network failure
 * both catalogs are null — keep previously known list (or the full static
 * list on first run) so the picker is not empty while offline.
 */
export async function runHealthCheck(
	force = false,
): Promise<RegisteredModel[]> {
	if (checked && !force) return aliveCatalog;
	if (checking) return checking;

	checking = (async () => {
		const [oc, kc] = await Promise.all([opencodeCatalog(), kiloCatalog()]);
		const bothDown = oc === null && kc === null;
		const next: CatalogCache = {
			fetchedAt: oc || kc ? Date.now() : catalogCache.fetchedAt,
			...(oc ? { opencode: [...oc] } : catalogCache.opencode ? { opencode: catalogCache.opencode } : {}),
			...(kc ? { kilo: [...kc] } : catalogCache.kilo ? { kilo: catalogCache.kilo } : {}),
		};
		if (oc || kc) {
			catalogCache = next;
			saveCatalogCache(next);
		}
		if (bothDown && !aliveCatalog.length && !catalogCache.opencode && !catalogCache.kilo) {
			// Preserve the VS Code port's offline-first fallback on a cold start.
			aliveCatalog = [...OPENCODE_MODELS, ...KILO_MODELS];
		} else {
			aliveCatalog = modelsFromCache(next);
		}
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
