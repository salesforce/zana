# LLM Micro-Call Service — architecture & reuse guide

**Status:** shipped. **Providers:** ✅ `claude-cli`, ✅ `openai`, ✅ `gemini` — Anthropic SDK still to come. **Audience:** anyone adding an AI-powered feature to Zana Command Center.

This is the app's reusable layer for **one-shot LLM calls** — "prompt in, one text answer out," sub-agent style. It is *not* the terminal/`claude`-CLI agent path (that spawns interactive PTY sessions). Use this when a feature needs a quick model answer that it then processes in code: naming a tab from the first instruction, summarizing an inbox entry, classifying a notification, etc.

The first (and currently only) consumer is **tab auto-naming**. The layer was built so the next consumer is a new prompt entry + one call, not a rebuild.

---

## TL;DR for reuse

| You want to… | Do this | Effort |
|---|---|---|
| Run an existing prompt from the **main process** | `llmService.run(promptRegistry.get(id), vars)` | 1 line |
| Add a **new prompt** (summarize, classify, …) | Add a `BUILTIN` entry in `prompt-registry.ts`, or drop a JSON file in `~/.zcc/llm-prompts/` | minutes |
| Add a **new model provider** (Anthropic SDK, …) | New file implementing `LlmProvider`, register it in `rebuildProviders()` in `index.ts` | 1 file |
| Let the **renderer** run a prompt | Add an `llmPrompts.run` IPC channel (see [Renderer reuse](#renderer-reuse) — deliberately not built yet) | ~10 lines |
| Edit a prompt's model/instructions/caps | Settings → **Prompts** tab, or edit the JSON on disk | UI |

---

## Architecture

```
                          ┌─────────────────────────────────────────────┐
                          │  PromptRegistry  (prompt-registry.ts)         │
                          │  built-in entries (code) + ~/.zcc/      │
   defines WHAT to run ──▶│  llm-prompts/*.json  (user-shadowable)        │
   (model, instructions,  │  → LlmPromptEntry { systemPrompt, userTemplate,│
    caps, provider)       │      model, maxOutputChars, timeoutMs, ... }  │
                          └───────────────────────┬─────────────────────┘
                                                  │ get(id) → entry
                                                  ▼
   a feature calls ──────▶  LlmService.run(entry, vars, dedupeKey?)
   (index.ts, etc.)         (llm-service.ts)
                                    │  fills {{var}} in userTemplate,
                                    │  picks entry.provider, de-dupes by key
                                    ▼
                          ┌─────────────────────────────────────────────┐
   HOW to reach a model ─▶│  LlmProvider  (llm/provider.ts) — the seam    │
   (one impl per          │  run(req) → LlmRunResult   (NEVER throws)     │
    transport)            ├─────────────────────────────────────────────┤
                          │  ✅ ClaudeCliProvider  (llm/claude-cli-…)     │
                          │     headless `claude --print`, reuses login   │
                          │  ✅ OpenAiProvider   (llm/openai-provider…)   │
                          │     HTTP chat-completions, API key            │
                          │  ✅ GeminiProvider   (llm/gemini-provider…)   │
                          │     HTTP generateContent, API key             │
                          │  ◻ AnthropicSdkProvider   (future)            │
                          └─────────────────────────────────────────────┘
```

Three layers, three reasons:

1. **`PromptRegistry`** — *what* to run, as data. A faithful clone of `QuickPromptStore` (`src/main/quick-prompt-store.ts`): built-in entries live in code, a JSON file in `~/.zcc/llm-prompts/` with the same `id` shadows a built-in, `fs.watch` hot-reloads, edits are also driven from the Settings → Prompts tab. Exports `get`/`list`/`saveUser`/`deleteUser`.
2. **`LlmService`** — the dispatcher. `run(entry, vars, dedupeKey?)` fills `{{var}}` placeholders, selects the provider, and coalesces concurrent identical calls by `dedupeKey`. Provider-agnostic; knows nothing about any specific model.
3. **`LlmProvider`** — the transport seam (`packages/llm/src/provider.ts`). One implementation per backend. **Contract: never throw** — every failure (spawn error, timeout, non-zero exit, missing provider, no key, HTTP error, network error, abort) resolves to an `LlmRunResult { ok: false, error }`, so callers stay branch-free.

The seam carries two optional extensions:

- **`signal?: AbortSignal` on `LlmRunRequest`** — cancellation. A provider that spawns or fetches aborts its work on this signal (the HTTP providers chain it to their own timeout `AbortController`, so either the caller's signal or the `timeoutMs` deadline aborts the `fetch`); an abort resolves to `ok:false 'aborted'`.
- **`usage?: { inputTokens?, outputTokens? }` on `LlmRunResult`** — per-call token accounting. The HTTP providers populate it from the response (`usage` for OpenAI, `usageMetadata` for Gemini); `claude-cli` leaves it undefined (it has no per-call cost meter).
- **`isConfigured?(): boolean` on `LlmProvider`** — whether the provider is usable right now (its API key/binary is in place). Optional: omitting it means always-configured (the `claude-cli` default — it reuses the ambient login). Drives `LlmService.availableProviders()`.

### Files

| File | Role |
|---|---|
| `packages/domain/src/llm.ts` | `LlmProviderId`, `LlmPromptEntry`, `LlmRunResult` |
| `packages/desktop-contract/src/cc-api.ts` | `CcApi.llmPrompts` (preload surface) |
| `packages/llm/src/provider.ts` | `LlmProvider` interface, `LlmRunRequest`, `LlmProviderMap` |
| `packages/llm/src/claude-cli-provider.ts` | v1 transport — `claude --print` |
| `packages/llm/src/openai-provider.ts` | OpenAI transport — HTTP chat-completions, API key |
| `packages/llm/src/gemini-provider.ts` | Gemini transport — HTTP `generateContent`, API key |
| `packages/llm/src/model-aliases.ts` | shared tier-alias map (`resolveModelAlias`) + config-write-time validation (`isKnownModel`) |
| `packages/llm/src/model-resolve.ts` | Claude `settings.json` family-alias resolver (Electron-free; settings path injectable) |
| `packages/llm/src/llm-service.ts` | `LlmService`, `fillTemplate`, `availableProviders`, `setProvider` |
| `packages/llm/src/prompt-registry.ts` | `PromptRegistry` + the `builtin:tab-namer` entry (HOME / reveal-path injected) |
| `src/main/index.ts` | constructs `PromptRegistry` / `LlmService` from `@zana-ai/zcc-llm`, `rebuildProviders(config)`, IPC handlers, consumers |
| `src/main/voice/secrets.ts` | encrypted (`safeStorage`) OpenAI/Gemini API keys + env-var fallbacks |
| `apps/app/src/views/settings/PromptsView.tsx` | the editor UI |

Singletons are constructed in `index.ts` (`const promptRegistry`, `const llmService`) — the same module-scope pattern as `quickPrompts`/`personas`. Any other main-process feature imports nothing new; it already has them in scope. Providers are (re)registered by one helper, `rebuildProviders(config)`, called at the three lifecycle points — boot, `config:set`, and window-open — so a changed `claudeBinary` or a newly-stored API key takes effect without a restart. It replaces the previously-duplicated construction:

```ts
function rebuildProviders(config: AppConfig): void {
  llmService.setProvider(new ClaudeCliProvider(config.claudeBinary));
  llmService.setProvider(new OpenAiProvider(() => getOpenAiKey()));
  llmService.setProvider(new GeminiProvider(() => getGeminiKey()));
}
```

The HTTP providers are registered unconditionally with a **lazy** key getter (`getOpenAiKey`/`getGeminiKey` from `voice/secrets.ts`); a provider with no key resolves to `ok:false` rather than being absent. `LlmService.availableProviders()` (which consults each provider's `isConfigured?()`) then drives the Settings → Prompts picker so only usable providers are offered.

---

## The prompt definition (declarative)

A prompt is **fully declarative** — model, instructions, and caps all live in one object, exactly the "define the AI behaviour in a file" idea. Today that file is **JSON** (see [Why JSON, not YAML](#why-json-not-yaml)); the *shape* is what matters:

```jsonc
// ~/.zcc/llm-prompts/my-prompt.json  (shadows a builtin if id matches)
{
  "id": "summarize-inbox",
  "label": "Summarize inbox entry",
  "description": "One-line gist of an inbox comment.",
  "provider": "claude-cli",          // which transport (default: claude-cli)
  "model": "haiku",                  // alias (haiku/sonnet/opus) or full id; '' = provider default
  "systemPrompt": "You write a one-line summary. Output only the summary.",
  "userTemplate": "Summarize:\n\n{{text}}",   // {{var}} filled by the caller
  "maxOutputChars": 200,             // hard output clamp (cost/safety)
  "timeoutMs": 30000                 // call timeout
}
```

`{{var}}` placeholders are filled from the `vars` map the caller passes to `run()`. Unknown placeholders are left literal (visible, not silently blank). Field reference: `LlmPromptEntry` in `@zana-ai/zcc-domain/llm`.

> **On "budget max":** v1 caps are `maxOutputChars` (output length) and `timeoutMs` (wall-clock). There is **no token/USD budget** field yet — the `claude --print` transport doesn't expose a clean per-call cost meter (it reuses the user's existing Claude Code subscription, so there's no per-call billing surface to cap). A real budget cap (`maxTokens` / `maxUsdCost`) is now meaningful: the API-key providers (`openai`/`gemini`) have landed and report `usage` (input/output tokens) on every `LlmRunResult`, so the accounting exists — but the budget *field* itself is still not built. See [Forward-looking](#forward-looking-not-built).

---

## Reuse recipes

### Main-process consumer (the common case)

This is exactly how tab auto-naming works (`index.ts` `onFirstPromptHook`). To add, say, inbox summarization:

```ts
// 1. Register a prompt — add to BUILTIN in prompt-registry.ts:
{ id: 'builtin:inbox-summary', label: 'Inbox summary', model: 'haiku',
  systemPrompt: 'You write a one-line gist. Output only the gist.',
  userTemplate: 'Summarize this inbox entry:\n\n{{text}}',
  maxOutputChars: 200, timeoutMs: 30_000 }

// 2. Call it from anywhere in main:
const entry = promptRegistry.get('builtin:inbox-summary');
if (entry) {
  const r = await llmService.run(entry, { text: entry.comments ?? '' });
  if (r.ok) { /* use r.text */ }
}
```

Pass a `dedupeKey` (3rd arg) when the same logical call could fire twice concurrently (the tab-namer passes the `sessionId`) — the second await joins the first call instead of double-spawning.

**Failure handling:** `run()` never rejects; branch on `r.ok`. Remember a resolved failure (`ok:false`) is the *normal* failure path (timeout/exit), not the `.catch`. If you track a one-shot guard like `llmNamedSessions`, release it on `!r.ok` too, or a transient failure disables the feature permanently (this was a real bug — see `onFirstPromptHook` in `index.ts`).

### Add a new model provider

The seam was built for this. `OpenAiProvider` and `GeminiProvider` are the two shipped HTTP references — copy their shape (constructor takes a lazy key getter, `isConfigured()` checks the key, `run()` maps aliases + never throws). To add the next one, e.g. an Anthropic SDK provider:

```ts
// packages/llm/src/anthropic-sdk-provider.ts
import type { LlmProvider, LlmRunRequest } from './provider.js';
import { resolveModelAlias } from './model-aliases.js';
export class AnthropicSdkProvider implements LlmProvider {
  readonly id = 'anthropic-sdk' as const;
  constructor(private readonly getApiKey: () => string | null) {}
  isConfigured(): boolean { return !!this.getApiKey(); }
  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    // resolveModelAlias(this.id, req.model); map req.system/req.user → request;
    // abort on req.signal; clamp to req.maxOutputChars; enforce req.timeoutMs;
    // populate usage from token accounting; NEVER throw — wrap failures into
    // { ok: false, error, provider: this.id, ms }.
  }
}
```

Then register it in the one `rebuildProviders()` helper in `index.ts`:

```ts
llmService.setProvider(new AnthropicSdkProvider(() => getAnthropicKey()));
```

The `LlmProviderId` union in `@zana-ai/zcc-domain/llm` already enumerates `'anthropic-sdk'`, and a prompt selects a provider via `"provider": "…"`. No change to `LlmService` or any consumer. **No refactor — one file + one `setProvider` line.** See [Other models](#other-models-multi-provider) for how keys and model-id mapping already work.

### Renderer reuse

Today the **only** run path exposed to the renderer is `llmPrompts.test` (the Settings → Prompts "Test" button). It works, but it's named/scoped as a test affordance. When a real renderer-driven consumer lands (e.g. a "Summarize" button in the inbox), add a dedicated production channel rather than borrowing `test`:

1. `packages/desktop-contract/src/ipc.ts` — add `run: 'llmPrompts:run'` to the `llmPrompts` group.
2. `src/main/index.ts` — `safeHandle(IPC.llmPrompts.run, (id, vars) => llmService.run(promptRegistry.get(id)!, vars), …)` (mirror the `test` handler's error fallback).
3. `apps/desktop/src/preload.ts` — `run: (id, vars) => ipcRenderer.invoke(IPC.llmPrompts.run, id, vars)`.
4. `packages/desktop-contract/src/cc-api.ts` — add `run(id, vars): Promise<LlmRunResult>` to `CcApi.llmPrompts`.

This is intentionally **not** built speculatively — the codebase avoids surfaces with no consumer.

---

## Why JSON, not YAML

The natural question is "shouldn't the prompt definition be a YAML file (model + budget + instructions)?" The *intent* — a declarative file holding model, caps, and instructions — is exactly what `LlmPromptEntry` already is. The format is JSON, by deliberate consistency:

- **Every sibling registry in this app is JSON** — `quick-prompt-store`, `persona-store`, `template-store`, `schedule-groups-store`, `skill-bundles-store`, and the scheduler all `JSON.parse`. `PromptRegistry` is a line-for-line clone of `QuickPromptStore`; matching its format keeps the one-file-per-entry + shadow-by-id + `fs.watch` machinery identical.
- **There is no YAML parser in the dependency tree.** Adopting YAML means adding `yaml` and being the single store that diverges — net new surface for marginal ergonomic gain.
- Other external agent tooling you may have seen uses YAML, and the `.zana/scheduler/*.yml` files are YAML — but those are **separate systems** (external daemons; the Zana plugin), not this app's stores.

**If we ever do want YAML** (e.g. for nicer multi-line `systemPrompt` authoring), it's a contained change: add the `yaml` dep, and in `prompt-registry.ts` `readPromptFile`/`saveUser` accept/emit `.yml` alongside `.json` (the scheduler already demonstrates this dual-format pattern in the Zana plugin). The in-memory `LlmPromptEntry` shape doesn't change. Worth doing only if hand-authoring prompts on disk becomes a common workflow; for UI-driven editing JSON is invisible to the user anyway.

---

## Other models (multi-provider)

Multi-provider was a design goal from day one, which is why the `LlmProvider` seam exists and `LlmProviderId` enumerates `'claude-cli' | 'anthropic-sdk' | 'openai' | 'gemini'`. Three of the four now ship (`claude-cli`, `openai`, `gemini`); only the Anthropic SDK transport is still a reserved seam. How the shipped providers handle the cross-cutting concerns:

- **Credentials.** `claude-cli` needs none (it reuses the user's Claude Code login). The HTTP providers take a lazy key getter and read from `voice/secrets.ts`: the OpenAI key comes from `OPENAI_API_KEY` **or** a `safeStorage`-encrypted key in `~/.zcc/voice-secrets.enc`; the Gemini key from `GEMINI_API_KEY` / `GOOGLE_API_KEY` **or** the same encrypted store. Keys are read at call time, never written to `~/.zcc/config.json` or exposed to the renderer as plaintext (only a "key configured" boolean via `isConfigured()`). Gemini sends its key in the `x-goog-api-key` header (never the URL) so it can't leak into request-log / error text.
- **Model ids.** The `model` field is provider-scoped, but the built-in prompts speak Claude tier aliases (`haiku`/`sonnet`/`opus`) because `claude-cli` was the only transport. So — reversing an earlier decision — there **is** now a shared cross-provider alias table: `packages/llm/src/model-aliases.ts`. Each HTTP provider calls `resolveModelAlias(this.id, req.model)` inside `run()`, which maps the three Claude tiers onto that provider's own concrete id (e.g. `haiku` → `gpt-4o-mini` / `gemini-2.0-flash`); any other value — a provider-native id like `gpt-4o` — passes through untouched. This is what lets an existing built-in prompt (`model: 'haiku'`) work unchanged when re-pointed at `openai`/`gemini`. `LlmService` itself stays alias-agnostic — it passes `entry.model` straight through; resolution happens in the provider. `isKnownModel(provider, model)` is the config-**write**-time twin, wired into `packages/llm/src/prompt-registry.ts` (`readPromptFile` drops an invalid model to `undefined`; `saveUser` rejects the save) so a bad model id surfaces when a prompt is saved rather than as a silent `ok:false` at dispatch.
- **Budget caps.** The HTTP providers are metered and populate `LlmRunResult.usage` (input/output tokens) from the response, so a `maxTokens`/`maxUsdCost` budget field on `LlmPromptEntry` now has the accounting it needs (see below — still not built).
- **Caching/latency.** `claude-cli` cold calls run ~10–20s. The HTTP providers are faster; don't hard-code latency assumptions in consumers (the tab-namer already tolerates ~20s and re-checks liveness after).

---

## Forward-looking (not built)

Deliberately deferred until a consumer needs them — listed so the next person doesn't re-derive them:

- **`llmPrompts.run` IPC channel** — production renderer entry point (see [Renderer reuse](#renderer-reuse)).
- **Budget cap field** (`maxTokens` / `maxUsdCost` on `LlmPromptEntry`) — the metered providers now report `usage` in `LlmRunResult`, so the accounting exists; the cap field that would enforce it does not.
- **YAML on-disk format** — contained change if hand-authoring becomes common (see above).
- **Anthropic SDK provider** — the last reserved `LlmProviderId` seam (`openai`/`gemini` now ship).

---

## Gotchas (learned the hard way; don't regress)

- **`--system-prompt`, NOT `--append-system-prompt`.** Append *adds to* Claude Code's full agentic system prompt, so the model treats the input as a real task to start (asks questions, uses tools) instead of just answering. Replace gives a clean sub-agent call. Verified live.
- **`--` end-of-options separator** before the user positional in `claude --print`. The prompt text is user-influenced; a prompt beginning with `-` could otherwise be parsed as a `claude` flag (argv injection). The `--` guard makes any leading-dash text a positional. Verified live.
- **Resolved failure ≠ thrown error.** The provider never throws; timeouts/non-zero-exits arrive as `ok:false` on the `.then`, not in `.catch`. Handle retries/one-shot release in the `!r.ok` branch.
- **Run in `os.tmpdir()`, no MCP/hooks.** The micro-call provider must not run in a project dir or load `--mcp-config`/`--settings` — it's a pure text call and must not be able to touch a project or fire the inbox server.
- **Cold latency ~10–20s** for `claude-cli`. Default `timeoutMs` is 30s; consumers re-check liveness after the call resolves.

---

## Related

- Memory: `tab-auto-rename-osc` (the first consumer), `llm-micro-call-service` (this layer), `security-hook-exec-false-positive`.
- Sibling pattern: `src/main/quick-prompt-store.ts` (the clone source for `PromptRegistry`).
