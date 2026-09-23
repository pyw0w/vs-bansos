# vs-bansos — project instructions

VS Code extension that ports the [`pi-bansos`](https://pi.dev/packages/pi-bansos)
package (free OpenAI-compatible models: OpenCode Zen + KiloCode gateway) to the
Language Model Chat Provider API.

## Build & verify

- `npm run build` — esbuild bundle → `out/extension.js`
- `npm run compile` — typecheck (`tsc --noEmit`); **run after every code edit**
- `npm run package` — build `.vsix`
- Manual test: F5 ("Run BANSOS Extension"), then check the Copilot Chat model picker

## Codebase map

| File | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, provider registration, commands, status bar |
| `src/provider.ts` | `LanguageModelChatProvider` — streaming (SSE), tool calls, vision |
| `src/models.ts` | Model catalog (8 OpenCode + 19 KiloCode) |
| `src/opencode.ts` | OpenCode Zen client + client fingerprint |
| `src/health.ts` | Startup health check + rate guards |
| `src/relay.ts` | Relay egress (Vercel/Cloudflare), state in `globalStorage` |

## Conventions

- Upstream `pi-bansos` is **read-only reference** — never copy pi-only
  machinery (local proxy on `127.0.0.1:18080`, `/bansos` slash command,
  `pi.registerProvider`); map concepts to VS Code equivalents instead.
- Muse models use the OpenAI Responses API (`/v1/responses`) and must suppress
  `reasoning.effort: "none"`; all other models use Chat Completions.
- Rate guards: KiloCode 200 req/h/IP (rolling hour), OpenCode UTC-day guard.
- Health check registers only live models; dead models stay in `models.ts` and
  are skipped silently — do not delete catalog entries just because they failed.
- Relay state lives in extension `globalStorage` (`relay-state.json`), not in
  files next to the source.
- Keep `README.md` (model counts, comparison table) in sync when models or
  behavior change.
- No new runtime dependencies or proxy layers without asking first.
