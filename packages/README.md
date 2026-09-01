# ZCC Workspace Packages

Workspace packages are intentional boundaries, not a directory for arbitrary
shared code. A package is added when two apps need it, or it is a public SDK.

**Rules**

- `domain`: serializable vocabulary only — no Electron, React, fs, PTY. Zod (and
  pure parsers such as cron) only.
- `contracts`: Zod wire messages. No React or `BrowserWindow`.
- `desktop-contract`: `window.cc` / preload surface (`CcApi`, IPC channel names).
- `llm`: one-shot LLM micro-calls. Node `fetch`/`spawn` allowed; **no** Electron
  or `safeStorage`. Callers inject API-key / `claude` binary resolvers.
- `ui`: prop-driven primitives only. No queries, routing, `window.cc`, or domain
  types in the public API. Prefer per-file exports (`@zana-ai/zcc-ui/button`).
- `tsconfig`: shared compiler bases (`base.json` for Node packages, `react.json`
  for `apps/app`).
- Every library publishes a `"source"` (and `"types"`) export condition so Vite
  resolves TypeScript without a pre-build.

| Package | Takes from | May depend on |
| --- | --- | --- |
| `@zana-ai/zcc-tsconfig` | shared tsconfig JSON | nothing |
| `@zana-ai/zcc-domain` | split of `src/shared/types.ts` plus parse-cron / schedule-spec / path-encoding / project-colors / theme ids | zod (+ croner for cron helpers) |
| `@zana-ai/zcc-contracts` | IPC payload Zod schemas | domain |
| `@zana-ai/zcc-desktop-contract` | `CcApi`, preload events, IPC channel names | domain, contracts |
| `@zana-ai/zcc-llm` | `packages/llm` (moved from `src/main/llm`) | domain; Node fetch/spawn |
| `@zana-ai/zcc-ui` | `components/ui` primitives (`PopoverPicklist`, `Button`, `Kanban`) | React peer |
| `@zana-ai/zcc-path-confine` | Rule-2 `isWithin` / `resolveContained` / `resolveContainedReal` | Node `path`/`fs`; no Electron |
| `@zana-ai/zcc-spawn-plan` | pure spawn-plan helpers from `src/main/harness/spawn-plan.ts` | domain |
| `@zana-ai/zcc-process-utils` | untrusted-child env allowlist (`buildChildEnv`) | Node only |
| `@zana-ai/zcc-plugin-sdk` | public plugin surface | domain |
| `@zana-ai/zcc-extension-sdk` | deprecated compatibility re-exports | plugin-sdk |
| `@zcc/harness-sdk` | harness descriptor surface | nothing |
| `zcc-app` | curated packaged runtime composition | — |

Stay out of packages on purpose: `pty.ts` (host-daemon), `zana/mcp-pool.ts`
(server service), the old extension broker, voice `safeStorage` (desktop native).

Existing packages (`plugin-sdk`, `extension-sdk`, `harness-sdk`, `cli`,
`streamdeck`) keep their current contracts. `@zana-ai/zcc-plugin-sdk` is the
public plugin contract; `@zana-ai/zcc-extension-sdk` remains only as a
shim-window re-export.
