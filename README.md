# BANSOS Free Models for VS Code / Copilot Chat

Free OpenAI-compatible models (**OpenCode Zen** + **KiloCode gateway**) added **directly to the VS Code and Copilot Chat model picker** — no API key, no external plugins (Continue / Cline / Roo not required).

Аналог [pi-bansos](https://www.npmjs.com/package/pi-bansos) (пакет для pi), перенесённый на VS Code Language Model Chat Provider API.

## What it does

- Contributes a `bansos` vendor to the chat model picker via `contributes.languageModelChatProviders` — the free models appear next to Copilot's own models.
- On startup it loads the last-known model catalog from extension `globalStorage` immediately, then refreshes both upstream catalogs in the background. Unavailable upstreams retain their last-known catalog; `openrouter/free` remains listed even when absent from Kilo's `/models` response.
- On a first run with both catalogs unreachable, the static catalog remains available so the picker is not empty offline.
- Streaming responses (SSE), **tool calling** (agent mode), **vision** (image input where supported), Responses API for Muse models, Chat Completions for everything else.
- **Relay egress** (optional): route requests through your own Vercel/Cloudflare relay to dodge per-IP rate limits — toggle live, no restart.
- Local rate guards matching upstream quotas (KiloCode: 200 req/h/IP; OpenCode: daily guard).

## Models

Up to **26 free models**: 9 OpenCode Zen (incl. Muse Spark free via Responses API) + 17 KiloCode gateway (keyless). The exact list shown in the picker depends on upstream availability — run **BANSOS: Refresh free model list** to re-check.

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
code --install-extension vs-bansos-0.1.1.vsix
```

Restart VS Code, then open Chat and pick a model from the dropdown — entries are prefixed with `OpenCode ·` or `KiloCode ·`.

## Build a GitHub release

After updating the version in `package.json`, push the matching version tag, for example:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The tag workflow checks the version, typechecks and packages the extension, then creates a GitHub Release with the `.vsix` attached. It does not need Marketplace credentials.

To publish the built extension to the VS Code Marketplace, run `npx vsce publish --no-dependencies` locally from a terminal where you have authenticated as the `bansos` publisher.

## Commands

| Command | What it does |
| --- | --- |
| `BANSOS: Manage (relay / models)` | Menu: relay on/off/status, switch/remove saved relays, set URL, **deploy a fresh Vercel relay**, refresh models, hide/show status bar item |
| `BANSOS: Refresh free model list` | Re-runs the catalog health check and updates the picker |

The status bar shows `$(sparkle) bansos: free models` (direct) or `bansos: relay ON`. Hide or show it from **BANSOS: Manage**; the preference is saved across restarts.

## Relay (optional)

By default requests go **directly** to the upstreams. If your IP gets rate-limited:

- `Deploy fresh Vercel relay…` — paste a [Vercel API token](https://vercel.com/account/tokens) (used once, never stored); the relay is deployed (~10–40 s), saved, and activated.
- `Set relay URL…` / `Switch relay…` — use any HTTP relay (Vercel, Cloudflare, Deno, your own). The `x-relay-target` / `x-relay-path` pattern is used; the deployed worker only allows `opencode.ai` and `api.kilo.ai`.

Relay settings and the last-known upstream model IDs are persisted in extension `globalStorage` (`relay-state.json` and `bansos-models.json`) and survive restarts. Relay-state writes are atomic; if saving fails, the change is reverted and reported.

## Notes

- Free upstream models are best-effort: promos expire, model IDs change, rate limits apply.
- KiloCode gateway: keyless, 200 requests/hour per IP; catalog and chat requests do not send an Authorization header.
- OpenCode free tier requires the client fingerprint (UA/session/tool gates); the extension maintains it the same way pi-bansos does.
- The local rate guard counts requests per process (one VS Code window).

## Comparison with pi-bansos

| pi-bansos (pi) | vs-bansos (VS Code) |
| --- | --- |
| Local proxy on `127.0.0.1:18080` | No proxy — extension host calls upstreams directly |
| `pi.registerProvider` + `/model` picker | `lm.registerLanguageModelChatProvider` + Copilot Chat picker |
| `/bansos` slash command | `BANSOS: Manage…` command palette + status bar |
| Relay state in `~/.pi/agent/…` | Relay state in extension `globalStorage` |
| Catalog cache + background refresh | Cached models appear immediately; refresh command updates the picker |

## License

MIT
