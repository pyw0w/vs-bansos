# BANSOS Free Models for VS Code / Copilot Chat

Free OpenAI-compatible models (**OpenCode Zen** + **KiloCode gateway**) added **directly to the VS Code and Copilot Chat model picker** — no API key, no external plugins (Continue / Cline / Roo not required).

Аналог [pi-bansos](https://www.npmjs.com/package/pi-bansos) (пакет для pi), перенесённый на VS Code Language Model Chat Provider API.

## What it does

- Contributes a `bansos` vendor to the chat model picker via `contributes.languageModelChatProviders` — the free models appear next to Copilot's own models.
- On startup it health-checks both upstream catalogs and registers **only currently listed models** (dead/promo-expired ones are skipped silently).
- Streaming responses (SSE), **tool calling** (agent mode), **vision** (image input where supported), Responses API for Muse models, Chat Completions for everything else.
- **Relay egress** (optional): route requests through your own Vercel/Cloudflare relay to dodge per-IP rate limits — toggle live, no restart.
- Local rate guards matching upstream quotas (KiloCode: 200 req/h/IP; OpenCode: daily guard).

## Models

Up to 27 free models: 8 OpenCode Zen (incl. Muse Spark free via Responses API) + 19 KiloCode gateway (keyless). The exact list shown in the picker depends on which models are alive at startup — run **BANSOS: Refresh free model list** to re-check.

## Install

### From source (development)

```bash
npm install
npm run build
# then press F5 in VS Code ("Run BANSOS Extension" launch config)
```

### As a .vsix

```bash
npm install
npm run package
code --install-extension vs-bansos-0.1.0.vsix
```

Restart VS Code, then open Chat and pick a model from the dropdown — entries are prefixed with `OpenCode ·` or `KiloCode ·`.

## Commands

| Command | What it does |
| --- | --- |
| `BANSOS: Manage (relay / models)` | Menu: relay on/off/status, switch/remove saved relays, set URL, **deploy a fresh Vercel relay**, refresh models |
| `BANSOS: Refresh free model list` | Re-runs the catalog health check and updates the picker |

The status bar shows `$(sparkle) bansos: free models` (direct) or `bansos: relay ON`.

## Relay (optional)

By default requests go **directly** to the upstreams. If your IP gets rate-limited:

- `Deploy fresh Vercel relay…` — paste a [Vercel API token](https://vercel.com/account/tokens) (used once, never stored); the relay is deployed (~10–40 s), saved, and activated.
- `Set relay URL…` / `Switch relay…` — use any HTTP relay (Vercel, Cloudflare, Deno, your own). The `x-relay-target` / `x-relay-path` pattern is used; the deployed worker only allows `opencode.ai` and `api.kilo.ai`.

State is persisted in the extension's `globalStorage` (`relay-state.json`) and survives restarts.

## Notes

- Free upstream models are best-effort: promos expire, model IDs change, rate limits apply.
- KiloCode gateway: keyless, 200 requests/hour per IP.
- OpenCode free tier requires the client fingerprint (UA/session/tool gates); the extension maintains it the same way pi-bansos does.
- The local rate guard counts requests per process (one VS Code window).

## Comparison with pi-bansos

| pi-bansos (pi) | vs-bansos (VS Code) |
| --- | --- |
| Local proxy on `127.0.0.1:18080` | No proxy — extension host calls upstreams directly |
| `pi.registerProvider` + `/model` picker | `lm.registerLanguageModelChatProvider` + Copilot Chat picker |
| `/bansos` slash command | `BANSOS: Manage…` command palette + status bar |
| Relay state in `~/.pi/agent/…` | Relay state in extension `globalStorage` |
| Health check at startup | Same, plus refresh command |

## License

MIT
