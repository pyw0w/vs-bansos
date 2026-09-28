---
name: model-catalog-diff
description: 'Diff the vs-bansos model catalog (src/models.ts) against the upstream pi-bansos model tables (pi.dev / npm). Use when: checking which free models changed, syncing model IDs/limits/flags, or verifying the current 26-model list (9 OpenCode Zen + 17 KiloCode gateway).'
argument-hint: 'Optional: model id or upstream version to focus on'
---

# Model Catalog Diff (vs-bansos ↔ pi-bansos)

Compare the local model catalog with the upstream `pi-bansos` package and
produce a porting-ready change list.

## When to Use

- Before porting any upstream release (`pi-bansos` version bump).
- When a free model stops working or its ID/limits changed.
- To verify vision / reasoning / API-type flags (Muse → Responses API).

## Procedure

1. **Read the local catalog**: `src/models.ts` — collect for each model:
   id, display name, provider (`opencode` | `kilo`), context limit, output
   limit, `vision` flag, `reasoning` flag, API type (`responses` | `chat`).
2. **Fetch upstream sources**:
   - https://pi.dev/packages/pi-bansos (README model tables, current version)
   - `npm view pi-bansos version` and, if needed, `npm pack pi-bansos --dry-run`
     or download the tarball to read the real catalog source.
3. **Build a diff table** with columns:
   `Model ID | Change (added/removed/modified) | Field | Local → Upstream`.
   Check each field: id, name, context, output, vision, reasoning, apiType.
4. **Classify each difference**:
   - *Portable* → edit `src/models.ts`.
   - *pi-only* (proxy paths, `/model` wiring, slash commands) → ignore, note it.
   - *Uncertain* → ask the user before changing.
5. **Cross-check health logic**: if an upstream model was removed because it
   died (not renamed), prefer leaving it in the catalog — `src/health.ts`
   skips dead models at startup anyway.
6. **Sync docs**: update the model counts and tables in `README.md`
   (currently "26 models: 9 OpenCode + 17 KiloCode"). Preserve pinned
   `openrouter/free`, even if it is missing from the Kilo `/models` catalog.

## Output Format

- One-line summary: `local N models vs upstream M · X added, Y removed, Z changed`.
- Diff table (only rows with differences).
- Files edited + `npm run compile` result if run.

## References

- Local catalog: `src/models.ts`
- Health check: `src/health.ts`
- Upstream: https://pi.dev/packages/pi-bansos
