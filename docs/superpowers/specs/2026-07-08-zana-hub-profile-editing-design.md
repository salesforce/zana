# Zana Hub — Profile Editing + Display-Name Fix

**Date:** 2026-07-08
**Extension:** `extensions/zana-hub`
**Status:** Approved (design), pending implementation plan

## Problem

The Zana hub panel ("Zana — global") has a **Profiles** tab that lists reusable
launch profiles read from `~/.zana/profiles/*.json`. Two issues:

1. **Profiles show their UUID instead of their name.** The list renders
   `Core Architect`'s file as its raw id (`82edebf5-…`) rather than
   "Core Architect".
2. **Profiles can't be edited from the UI.** Teams have a full create/edit
   flow (`+ New team`, per-row `Edit`, a `TeamEditorView`), but profiles are
   read-only rows.

### Root cause of #1

`toProfile()` (`src/main/index.ts`) reads the label as `asString(o.name) ?? id`.
Zana profile files store the label under **`displayName`**, not `name` — so
`name` is always `undefined` and the code falls back to the UUID. Note
`listProfiles()` (same file) already does it correctly:
`displayName ?? name ?? id` — which is why the team editor's profile dropdown
shows real names while the Profiles tab does not.

## Goals

- Profiles list shows the human name (from `displayName`).
- A **full** profile editor: display name, icon, description, category, model,
  effort level, permission mode, system prompt, allowed tools, disallowed tools.
- **Edit + Create** (New + Edit per row). **No delete** — matches the Teams tab
  and avoids dangling team→profile slot references.

## Non-goals (YAGNI)

- No delete flow.
- No `builtIn`-profile protection logic (none of the user's profiles are
  built-in; the `builtIn` field is simply preserved on round-trip).
- No new permissions — the manifest already grants `fs:write` for `~/.zana`.

## On-disk profile shape (observed)

Keys present across `~/.zana/profiles/*.json`:
`id`, `displayName`, `description`, `icon`, `category`, `model`, `effortLevel`,
`permissionMode`, `systemPrompt`, `allowedTools[]`, `disallowedTools[]`
(sometimes absent), `createdAt`, `updatedAt`, `builtIn`.

Filenames are UUIDs (`<uuid>.json`), independent of `id` (which equals the
UUID). This mirrors Zana's own convention.

## Design

Mirror the team-editor architecture piece-for-piece — it is a clean,
self-contained, unit-tested pattern.

### Shared types (`src/shared/types.ts`)

```ts
/** The FULL editable profile template. `id` absent ⇒ create (a UUID is minted). */
export interface ZanaProfileTemplate {
  id?: string;
  displayName: string;
  icon?: string;
  description?: string;
  category?: string;
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  systemPrompt?: string;
  allowedTools: string[];
  disallowedTools: string[];
}

export interface GetProfileResult {
  template: ZanaProfileTemplate;
  raw: Record<string, unknown>; // preserved for round-trip merge
}

export type SaveProfileResult = { ok: true; id: string } | { ok: false; error: string };
```

### Pure normalizer (new `src/main/normalize-profile.ts`)

Fully unit-testable, no filesystem dependency (mirrors `normalize-team.ts`).

- `validateProfile(input): string | null` — require a non-empty `displayName`.
  Return an error string or `null`.
- `normalizeProfile(input, base, id, nowIso): Record<string, unknown>` —
  spread `base` first (preserve unknown/unedited keys), then set edited fields,
  set `id`, keep `createdAt` from base (default `nowIso`), keep `builtIn` from
  base, stamp `updatedAt = nowIso`. `allowedTools`/`disallowedTools` written as
  arrays.

### Main handlers (`src/main/index.ts`)

Structurally identical to `getTeam` / `saveTeam`:

- `getProfile(id)`: `isSafeId` guard → read `profiles/<id>.json` → project to
  `ZanaProfileTemplate` (defensive `asString`, arrays coerced) + return `raw`.
  Returns `null` for unsafe id / missing / malformed.
- `saveProfile(input)`: `validateProfile` gate → resolve id (preserve on edit;
  **mint a UUID on create** via `crypto.randomUUID()`, with a timestamped-random
  fallback if unavailable in the sandbox) → merge onto existing raw via
  `normalizeProfile` → `ctx.fs.writeFile`. Never throws — failure is returned
  as `{ ok: false, error }`.

Single write seam: `saveProfile` (same discipline as `saveTeam`).

### Display-name fix (`toProfile`)

```ts
name: asString(o.displayName) ?? asString(o.name) ?? id
```

### Renderer (`src/renderer/panel.tsx`)

- `ProfileEditorView` (mirrors `TeamEditorView`): text inputs for
  displayName/icon/description/category; `<select>` for model / effortLevel /
  permissionMode; textarea for systemPrompt; two textareas for allowed /
  disallowed tools edited **one tool per line** (split/trim/filter on save,
  join with `\n` on load). Line-based editing preserves entries like
  `mcp__plugin_codesearch_codesearch__*`.
- `ProfilesView` gains a `+ New profile` button and a per-row `Edit` button.
- The Profiles tab gains the same list-vs-editor mode toggle Teams has
  (a `editingProfile` state alongside the existing `editing` team state;
  cleared on tab switch; `onSaved` reloads the overview).

### Model / effort / permission-mode option sets

Provide sensible fixed `<option>` lists, but keep the current value selectable
even if it isn't in the list (same "keep unknown selectable" pattern the team
editor uses for profile ids), so an unusual stored value round-trips.

## Build & deploy

1. `npm run build` (renderer + main).
2. `npm run package` — copies into `examples/extensions/zana-hub/` (committed
   artifact) and `~/.zcc/extensions/zana-hub/` (live dev install).
3. Reload the extension in-app.

## Testing

- New `src/__tests__/normalize-profile.test.ts` — validate + normalize
  (round-trip preservation of unknown keys, createdAt/builtIn retention,
  updatedAt stamped, tools as arrays).
- Extend `src/__tests__/main-team-edit.test.ts` (or a new
  `main-profile-edit.test.ts`) — `getProfile` (real / missing / unsafe id) and
  `saveProfile` (create mints id, edit preserves id + merges raw, validation
  failure returns `{ ok:false }`).
- `npm run typecheck`.

## Risks / notes

- **UUID minting in the sandbox:** `crypto.randomUUID()` is expected to be
  available (Node global). Fallback to a timestamped random stem keeps create
  working if not. Either way the filename passes `isSafeId`.
- **No delete** means an edited-then-abandoned profile can't be removed from the
  UI; acceptable for this iteration (and safe re: team references).
- The team editor's profile dropdowns automatically pick up newly created /
  renamed profiles via `listProfiles` (already `displayName`-aware).
