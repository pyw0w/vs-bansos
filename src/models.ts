// Model catalogs ported from pi-bansos (npm:pi-bansos 0.4.x).
// All models are free; OpenCode models are keyless, KiloCode is keyless 200 req/hr/IP.

export type ProviderApi = "openai-completions" | "openai-responses";
export type Upstream = "opencode" | "kilo";

export interface ModelDef {
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
	api?: ProviderApi;
	input?: ("text" | "image")[];
	/** KiloCode thinking models emit reasoning in openrouter format. */
	thinkingFormat?: "openrouter";
	source: Upstream;
}

// OpenCode Zen free models (verified against live catalog 2026-09).
export const OPENCODE_MODELS: ModelDef[] = [
	{
		id: "muse-spark-1.3-contributor-free",
		name: "Muse Spark 1.3 Free",
		reasoning: true,
		contextWindow: 1_048_576,
		maxTokens: 131_072,
		api: "openai-responses",
		input: ["text", "image"],
		source: "opencode",
	},
	{
		id: "muse-spark-1.2-contributor-free",
		name: "Muse Spark 1.2 Free",
		reasoning: true,
		contextWindow: 1_048_576,
		maxTokens: 131_072,
		api: "openai-responses",
		input: ["text", "image"],
		source: "opencode",
	},
	{
		id: "mimo-v2.5-free",
		name: "MiMo V2.5 Free",
		reasoning: true,
		contextWindow: 200_000,
		maxTokens: 32_000,
		input: ["text", "image"],
		source: "opencode",
	},
	{
		id: "mimo-v2.6-flash-free",
		name: "MiMo V2.6 Flash Free",
		reasoning: true,
		contextWindow: 200_000,
		maxTokens: 32_000,
		input: ["text", "image"],
		source: "opencode",
	},
	{
		id: "ling-3.0-flash-fin-free",
		name: "Ling 3.0 Flash Fin Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 32_768,
		source: "opencode",
	},
	{
		id: "nemotron-3-ultra-free",
		name: "Nemotron 3 Ultra Free",
		reasoning: true,
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		source: "opencode",
	},
	{
		id: "nemotron-3.5-lightning-free",
		name: "Nemotron 3.5 Lightning Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 262_144,
		source: "opencode",
	},
	{
		id: "big-pickle",
		name: "Big Pickle",
		reasoning: true,
		contextWindow: 200_000,
		maxTokens: 32_000,
		source: "opencode",
	},
	{
		id: "space-bunny-free",
		name: "Space Bunny",
		reasoning: true,
		contextWindow: 1_000_000,
		maxTokens: 524_288,
		input: ["text", "image"],
		source: "opencode",
	},
];

// KiloCode gateway free models (keyless — 200 req/hr per IP).
export const KILO_MODELS: ModelDef[] = [
	{
		id: "kilo-auto/free",
		name: "Kilo Auto Free",
		reasoning: false,
		contextWindow: 256_000,
		maxTokens: 10_000,
		source: "kilo",
	},
	{
		id: "stepfun/step-3.7-flash:free",
		name: "Step 3.7 Flash Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 262_144,
		input: ["text", "image"],
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "nvidia/nemotron-3-ultra-550b-a55b:free",
		name: "Nemotron 3 Ultra Free",
		reasoning: true,
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "nvidia/nemotron-3-super-120b-a12b:free",
		name: "Nemotron 3 Super Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 235_929,
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "dots-studio/dots-3-note-preview:free",
		name: "Dots3-Note Preview Free",
		reasoning: true,
		contextWindow: 512_000,
		maxTokens: 460_800,
		input: ["text", "image"],
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "cohere/north-mini-code:free",
		name: "North Mini Code Free",
		reasoning: false,
		contextWindow: 256_000,
		maxTokens: 64_000,
		source: "kilo",
	},
	{
		id: "poolside/laguna-xs-2.1:free",
		name: "Laguna XS 2.1 Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 32_768,
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
		name: "Nemotron 3 Nano Omni Free",
		reasoning: true,
		contextWindow: 256_000,
		maxTokens: 65_536,
		input: ["text", "image"],
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "openrouter/free",
		name: "OpenRouter Free (auto)",
		reasoning: false,
		contextWindow: 200_000,
		maxTokens: 65_536,
		input: ["text", "image"],
		source: "kilo",
	},
	{
		id: "nvidia/nemotron-3.5-lightning:free",
		name: "Nemotron 3.5 Lightning Free",
		reasoning: true,
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "nvidia/nemotron-3.5-content-safety:free",
		name: "Nemotron 3.5 Content Safety Free",
		reasoning: true,
		contextWindow: 128_000,
		maxTokens: 8_192,
		input: ["text", "image"],
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "inclusionai/ling-3.0-flash-sante:free",
		name: "Ling 3.0 Flash Sante Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 32_768,
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "inclusionai/ling-3.0-flash-fin:free",
		name: "Ling 3.0 Flash Fin Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 32_768,
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "liquid/lfm-2.5-2.6b:free",
		name: "Liquid LFM 2.5 2.6B Free",
		reasoning: true,
		contextWindow: 65_536,
		maxTokens: 8_192,
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "poolside/laguna-s-2.1:free",
		name: "Laguna S 2.1 Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 32_768,
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "thinkingmachines/inkling-small:free",
		name: "Inkling Small Free",
		reasoning: true,
		contextWindow: 1_048_576,
		maxTokens: 262_144,
		input: ["text", "image"],
		thinkingFormat: "openrouter",
		source: "kilo",
	},
	{
		id: "qwen/qwen3.8-27b:free",
		name: "Qwen3.8 27B Free",
		reasoning: true,
		contextWindow: 262_144,
		maxTokens: 235_929,
		input: ["text", "image"],
		thinkingFormat: "openrouter",
		source: "kilo",
	},
];

export const KILO_MODEL_IDS = new Set(KILO_MODELS.map((m) => m.id));
export const ALL_MODELS: ModelDef[] = [...OPENCODE_MODELS, ...KILO_MODELS];
export const modelById = (id: string): ModelDef | undefined =>
	ALL_MODELS.find((m) => m.id === id);
