# Edit & Create Zana Team Templates from the zana-hub Teams Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user edit an existing Zana team template and create a new one directly from the zana-hub extension's **Teams** tab, writing `~/.zana/teams/<id>.json` through the brokered `ctx.fs.writeFile` capability.

**Architecture:** The zana-hub disk extension is out-of-process and capability-gated. Three new main-module handlers (`getTeam`, `listProfiles`, `saveTeam`) are added; `saveTeam` is the single write seam that normalizes derived fields and calls `ctx.fs.writeFile`. All normalization logic lives in a pure, unit-tested `normalizeTeam` + `slugify` module. The renderer Teams tab gains an inline editor form (built with injected `React.createElement`, NOT JSX). The manifest gains the `fs:write` permission (re-triggers consent, scoped to `~/.zana`).

**Tech Stack:** TypeScript, React 18 (injected via `activate({ React })`), Vite library-mode build, Vitest, the `@zana-ai/zcc-extension-sdk`.

## Global Constraints

- **Sandbox fs only.** All filesystem access goes through `ctx.fs` (`readFile` / `readdir` / `writeFile`). Raw `node:fs` is denylisted in the extension child — never import it.
- **Renderer uses `h = React.createElement`, never JSX.** JSX compiles to an unresolvable `react/jsx-runtime` import in the blob-imported bundle. Match the existing `panel.tsx` style exactly.
- **Path confinement is host-side (Rules 1 & 2).** The broker realpath-confines every `writeFile` to `fsRoots: ["~/.zana"]`. The extension additionally basename-guards any `id` before building a path (reject `/`, `..`, empty) as defense in depth. Filenames are derived host-side, never taken as a renderer-supplied path.
- **`slots` is the source of truth.** On every write, derive `workerProfileIds` = distinct slot `profileId`s (first-seen order) and `maxTotalWorkers` = Σ slot `quantity`. `rules.maxConcurrentWorkers` is INDEPENDENT and user-editable. Preserve unknown/unedited keys round-trip (`autoRestart`, `requireApproval`, `dynamicSpawning`, and any others). Stamp `updatedAt` = current ISO time.
- **Test import convention:** extension tests import the source with a `.js` extension (e.g. `import ... from '../main/index.js'`) even though the file is `.ts` — this matches `main-overview.test.ts` and the `Bundler` moduleResolution.
- **Commands run from the repo root** unless stated. Tests: `npm test -- <path>`. Typecheck the extension: `npm --prefix extensions/zana-hub run typecheck`. Build+package: `npm --prefix extensions/zana-hub run build && npm --prefix extensions/zana-hub run package`.

---

### Task 1: Shared types for the full team template

**Files:**
- Modify: `extensions/zana-hub/src/shared/types.ts` (append; do not change existing `ZanaTeamSummary`)

**Interfaces:**
- Consumes: nothing.
- Produces: `ZanaTeamSlot`, `ZanaTeamTemplate`, `ZanaProfileOption`, `SaveTeamResult`, `GetTeamResult` — consumed by Tasks 2, 3, 5.

- [ ] **Step 1: Append the new types**

Add to the end of `extensions/zana-hub/src/shared/types.ts`:

```ts
/** One roster slot in a team template. */
export interface ZanaTeamSlot {
  profileId: string;
  quantity: number;
}

/**
 * The FULL editable team template — the shape the editor form binds to and
 * `saveTeam` accepts. `id` absent ⇒ create (a slug is minted from `name`).
 * `slots` is the source of truth; `workerProfileIds` / `maxTotalWorkers` are
 * derived on save and are NOT part of this input shape.
 */
export interface ZanaTeamTemplate {
  id?: string;
  name: string;
  icon?: string;
  description?: string;
  orchestratorProfileId?: string;
  slots: ZanaTeamSlot[];
  initialPrompt?: string;
  /** → rules.maxConcurrentWorkers (independent of slot totals). */
  maxConcurrentWorkers?: number;
  autoStart?: boolean;
}

/** A profile option for the slot / orchestrator dropdowns. */
export interface ZanaProfileOption {
  id: string;
  displayName: string;
  icon?: string;
}

/** `getTeam` result: the editable projection PLUS the raw parsed object so
 * `saveTeam` can merge onto it and preserve unknown keys round-trip. */
export interface GetTeamResult {
  template: ZanaTeamTemplate;
  raw: Record<string, unknown>;
}

/** `saveTeam` result — never throws; failure is data. */
export type SaveTeamResult = { ok: true; id: string } | { ok: false; error: string };
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix extensions/zana-hub run typecheck`
Expected: PASS (no errors — pure type additions).

- [ ] **Step 3: Commit**

```bash
git add extensions/zana-hub/src/shared/types.ts
git commit -m "feat(zana-hub): shared types for full team template editing"
```

---

### Task 2: Pure `normalizeTeam` + `slugify` module (TDD core)

This is the heart of the feature: all derived-field logic and id minting, with zero fs dependency so it is fully unit-testable.

**Files:**
- Create: `extensions/zana-hub/src/main/normalize-team.ts`
- Test: `extensions/zana-hub/src/__tests__/normalize-team.test.ts`

**Interfaces:**
- Consumes: `ZanaTeamTemplate`, `ZanaTeamSlot` from `../shared/types.js` (Task 1).
- Produces:
  - `slugify(name: string): string` — lowercase, non-alphanumerics → `-`, trimmed, empty → `'team'`.
  - `uniqueSlug(name: string, existingStems: string[]): string` — `slugify` then suffix `-2`, `-3`, … until not in `existingStems`.
  - `validateTeam(input: ZanaTeamTemplate): string | null` — returns an error message, or `null` if valid.
  - `normalizeTeam(input: ZanaTeamTemplate, base: Record<string, unknown>, id: string, nowIso: string): Record<string, unknown>` — merges `input` onto `base`, sets derived fields, returns the object to serialize.

- [ ] **Step 1: Write the failing tests**

Create `extensions/zana-hub/src/__tests__/normalize-team.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug, validateTeam, normalizeTeam } from '../main/normalize-team.js';
import type { ZanaTeamTemplate } from '../shared/types.js';

const NOW = '2026-07-07T12:00:00.000Z';

function tmpl(over: Partial<ZanaTeamTemplate> = {}): ZanaTeamTemplate {
  return {
    name: 'Backend Squad',
    slots: [
      { profileId: 'architect', quantity: 1 },
      { profileId: 'backend-dev', quantity: 2 }
    ],
    ...over
  };
}

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Backend Squad')).toBe('backend-squad');
  });
  it('strips punctuation and collapses separators', () => {
    expect(slugify('Core Dev / Squad!!')).toBe('core-dev-squad');
  });
  it('falls back to "team" for an empty/degenerate name', () => {
    expect(slugify('   ')).toBe('team');
    expect(slugify('!!!')).toBe('team');
  });
});

describe('uniqueSlug', () => {
  it('returns the plain slug when free', () => {
    expect(uniqueSlug('Backend Squad', ['other'])).toBe('backend-squad');
  });
  it('suffixes -2, -3 on collision', () => {
    expect(uniqueSlug('Backend Squad', ['backend-squad'])).toBe('backend-squad-2');
    expect(uniqueSlug('Backend Squad', ['backend-squad', 'backend-squad-2'])).toBe('backend-squad-3');
  });
});

describe('validateTeam', () => {
  it('accepts a valid template', () => {
    expect(validateTeam(tmpl())).toBeNull();
  });
  it('rejects empty name', () => {
    expect(validateTeam(tmpl({ name: '  ' }))).toMatch(/name/i);
  });
  it('rejects empty slots', () => {
    expect(validateTeam(tmpl({ slots: [] }))).toMatch(/slot/i);
  });
  it('rejects a slot with blank profileId', () => {
    expect(validateTeam(tmpl({ slots: [{ profileId: '', quantity: 1 }] }))).toMatch(/profile/i);
  });
  it('rejects quantity < 1 or non-integer', () => {
    expect(validateTeam(tmpl({ slots: [{ profileId: 'a', quantity: 0 }] }))).toMatch(/quantity/i);
    expect(validateTeam(tmpl({ slots: [{ profileId: 'a', quantity: 1.5 }] }))).toMatch(/quantity/i);
  });
  it('rejects maxConcurrentWorkers < 1 when provided', () => {
    expect(validateTeam(tmpl({ maxConcurrentWorkers: 0 }))).toMatch(/concurrent/i);
  });
});

describe('normalizeTeam', () => {
  it('derives workerProfileIds as distinct first-seen ids', () => {
    const out = normalizeTeam(
      tmpl({ slots: [
        { profileId: 'architect', quantity: 1 },
        { profileId: 'backend-dev', quantity: 2 },
        { profileId: 'architect', quantity: 1 }
      ] }),
      {},
      'backend-squad',
      NOW
    );
    expect(out.workerProfileIds).toEqual(['architect', 'backend-dev']);
  });
  it('derives maxTotalWorkers as the sum of quantities', () => {
    const out = normalizeTeam(tmpl(), {}, 'backend-squad', NOW);
    expect(out.maxTotalWorkers).toBe(3); // 1 + 2
  });
  it('sets rules.maxConcurrentWorkers independently from the input', () => {
    const out = normalizeTeam(tmpl({ maxConcurrentWorkers: 4 }), {}, 'x', NOW);
    expect((out.rules as Record<string, unknown>).maxConcurrentWorkers).toBe(4);
    expect(out.maxTotalWorkers).toBe(3); // unchanged by concurrency
  });
  it('falls back concurrency to existing rules, then to total', () => {
    const withBase = normalizeTeam(tmpl(), { rules: { maxConcurrentWorkers: 9, autoRestart: true } }, 'x', NOW);
    expect((withBase.rules as Record<string, unknown>).maxConcurrentWorkers).toBe(9);
    const noBase = normalizeTeam(tmpl(), {}, 'x', NOW);
    expect((noBase.rules as Record<string, unknown>).maxConcurrentWorkers).toBe(3); // = total
  });
  it('preserves unknown/unedited keys round-trip', () => {
    const base = {
      rules: { maxConcurrentWorkers: 4, autoRestart: true, requireApproval: false },
      dynamicSpawning: true,
      someFutureKey: 'keep-me'
    };
    const out = normalizeTeam(tmpl(), base, 'backend-squad', NOW);
    expect((out.rules as Record<string, unknown>).autoRestart).toBe(true);
    expect((out.rules as Record<string, unknown>).requireApproval).toBe(false);
    expect(out.dynamicSpawning).toBe(true);
    expect(out.someFutureKey).toBe('keep-me');
  });
  it('stamps id and updatedAt', () => {
    const out = normalizeTeam(tmpl(), {}, 'backend-squad', NOW);
    expect(out.id).toBe('backend-squad');
    expect(out.updatedAt).toBe(NOW);
  });
  it('writes the editable scalar fields', () => {
    const out = normalizeTeam(
      tmpl({ icon: '⚙️', description: 'desc', orchestratorProfileId: 'orchestrator', initialPrompt: 'go', autoStart: true }),
      {},
      'x',
      NOW
    );
    expect(out.name).toBe('Backend Squad');
    expect(out.icon).toBe('⚙️');
    expect(out.description).toBe('desc');
    expect(out.orchestratorProfileId).toBe('orchestrator');
    expect(out.initialPrompt).toBe('go');
    expect(out.autoStart).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- extensions/zana-hub/src/__tests__/normalize-team.test.ts`
Expected: FAIL — cannot resolve `../main/normalize-team.js` (module not found).

- [ ] **Step 3: Write the implementation**

Create `extensions/zana-hub/src/main/normalize-team.ts`:

```ts
/**
 * Pure team-template normalization for zana-hub's editor — NO filesystem
 * dependency, so it is fully unit-testable. `slots` is the source of truth;
 * `workerProfileIds` and `maxTotalWorkers` are DERIVED on every write, and
 * unknown/unedited keys on the base object are preserved round-trip.
 */
import type { ZanaTeamTemplate } from '../shared/types.js';

/** Lowercase, non-alphanumerics → single '-', trimmed; empty → 'team'. */
export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'team';
}

/** `slugify`, then suffix -2, -3, … until it is not in `existingStems`. */
export function uniqueSlug(name: string, existingStems: string[]): string {
  const taken = new Set(existingStems);
  const base = slugify(name);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Returns an error message, or null if the template is valid. */
export function validateTeam(input: ZanaTeamTemplate): string | null {
  if (!input || typeof input.name !== 'string' || !input.name.trim()) {
    return 'Team name is required.';
  }
  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    return 'At least one roster slot is required.';
  }
  for (const s of input.slots) {
    if (!s || typeof s.profileId !== 'string' || !s.profileId.trim()) {
      return 'Every slot needs a profile.';
    }
    if (typeof s.quantity !== 'number' || !Number.isInteger(s.quantity) || s.quantity < 1) {
      return 'Slot quantity must be a whole number ≥ 1.';
    }
  }
  if (
    input.maxConcurrentWorkers != null &&
    (!Number.isInteger(input.maxConcurrentWorkers) || input.maxConcurrentWorkers < 1)
  ) {
    return 'Max concurrent workers must be a whole number ≥ 1.';
  }
  return null;
}

/**
 * Merge `input` onto `base` (the raw parsed existing file, or `{}` for a new
 * team), set all derived fields, and return the object to serialize. Callers
 * pass the resolved `id` and an ISO timestamp (kept as params so this stays
 * pure and deterministic under test).
 */
export function normalizeTeam(
  input: ZanaTeamTemplate,
  base: Record<string, unknown>,
  id: string,
  nowIso: string
): Record<string, unknown> {
  const slots = input.slots.map((s) => ({ profileId: s.profileId, quantity: s.quantity }));

  // Distinct profileIds, first-seen order.
  const workerProfileIds: string[] = [];
  for (const s of slots) if (!workerProfileIds.includes(s.profileId)) workerProfileIds.push(s.profileId);

  const maxTotalWorkers = slots.reduce((n, s) => n + s.quantity, 0);

  const baseRules = (base.rules && typeof base.rules === 'object' ? base.rules : {}) as Record<string, unknown>;
  const existingConcurrency =
    typeof baseRules.maxConcurrentWorkers === 'number' ? baseRules.maxConcurrentWorkers : undefined;
  const maxConcurrentWorkers = input.maxConcurrentWorkers ?? existingConcurrency ?? maxTotalWorkers;

  return {
    ...base, // preserve unknown/unedited top-level keys (dynamicSpawning, …)
    id,
    name: input.name.trim(),
    icon: input.icon,
    description: input.description,
    orchestratorProfileId: input.orchestratorProfileId,
    slots,
    initialPrompt: input.initialPrompt,
    rules: { ...baseRules, maxConcurrentWorkers },
    autoStart: input.autoStart === true,
    workerProfileIds,
    maxTotalWorkers,
    updatedAt: nowIso
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- extensions/zana-hub/src/__tests__/normalize-team.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck**

Run: `npm --prefix extensions/zana-hub run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extensions/zana-hub/src/main/normalize-team.ts extensions/zana-hub/src/__tests__/normalize-team.test.ts
git commit -m "feat(zana-hub): pure normalizeTeam + slugify with tests"
```

---

### Task 3: Main-module handlers — `getTeam`, `listProfiles`, `saveTeam`

**Files:**
- Modify: `extensions/zana-hub/src/main/index.ts`
- Test: `extensions/zana-hub/src/__tests__/main-team-edit.test.ts` (new)

**Interfaces:**
- Consumes: `normalizeTeam`, `uniqueSlug`, `validateTeam` from `./normalize-team.js` (Task 2); `ZanaTeamTemplate`, `GetTeamResult`, `SaveTeamResult`, `ZanaProfileOption` from `../shared/types.js` (Task 1).
- Produces (on the object returned by `setup`, callable via `host.call`):
  - `getTeam(id: string): Promise<GetTeamResult | null>`
  - `listProfiles(): Promise<ZanaProfileOption[]>`
  - `saveTeam(input: ZanaTeamTemplate): Promise<SaveTeamResult>`

- [ ] **Step 1: Extend the `FsCap` type with `writeFile`**

In `extensions/zana-hub/src/main/index.ts`, change the `FsCap` type (currently ~lines 48-51):

```ts
type FsCap = {
  readFile(path: string, encoding?: 'utf-8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  writeFile(path: string, data: string): Promise<void>;
};
```

- [ ] **Step 2: Add imports and a basename guard near the top of the file**

Add to the imports block (after the existing `../shared/types.js` import):

```ts
import type { GetTeamResult, SaveTeamResult, ZanaProfileOption, ZanaTeamTemplate } from '../shared/types.js';
import { normalizeTeam, uniqueSlug, validateTeam } from './normalize-team.js';
```

Add a helper alongside `asString` (near line 62):

```ts
/** True only for a bare, safe filename stem (no separators, no traversal). */
function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}
```

- [ ] **Step 3: Write the failing tests**

Create `extensions/zana-hub/src/__tests__/main-team-edit.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

type FsCap = {
  readFile(path: string, encoding?: 'utf-8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  writeFile(path: string, data: string): Promise<void>;
};

async function makeMainModule(fs: Partial<FsCap>) {
  const { default: defineMain } = await import('../main/index.js');
  const full: FsCap = {
    readFile: vi.fn(async () => { throw new Error('not found'); }),
    readdir: vi.fn(async () => []),
    writeFile: vi.fn(async () => {}),
    ...fs
  };
  const ctx = { fs: full, log: vi.fn(), host: {} as never };
  return { mod: defineMain.setup(ctx) as any, fs: full };
}

describe('getTeam', () => {
  it('returns the editable projection plus raw for a real file', async () => {
    const raw = {
      id: 'backend-squad', name: 'Backend Squad', icon: '⚙️',
      orchestratorProfileId: 'orchestrator',
      slots: [{ profileId: 'architect', quantity: 1 }],
      rules: { maxConcurrentWorkers: 4, autoRestart: true },
      autoStart: false, dynamicSpawning: true
    };
    const { mod } = await makeMainModule({
      readFile: vi.fn(async (p: string) => {
        if (p.endsWith('teams/backend-squad.json')) return JSON.stringify(raw);
        throw new Error('not found');
      })
    });
    const res = await mod.getTeam('backend-squad');
    expect(res.template.name).toBe('Backend Squad');
    expect(res.template.maxConcurrentWorkers).toBe(4);
    expect(res.template.slots).toEqual([{ profileId: 'architect', quantity: 1 }]);
    expect(res.raw.dynamicSpawning).toBe(true); // raw preserved for round-trip
  });

  it('returns null for a missing/malformed file', async () => {
    const { mod } = await makeMainModule({});
    expect(await mod.getTeam('nope')).toBeNull();
  });

  it('returns null and never reads for an unsafe id', async () => {
    const { mod, fs } = await makeMainModule({});
    expect(await mod.getTeam('../secrets')).toBeNull();
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});

describe('listProfiles', () => {
  it('maps profile files to {id, displayName, icon}', async () => {
    const { mod } = await makeMainModule({
      readdir: vi.fn(async (p: string) => (p.endsWith('profiles') ? ['a.json', 'b.json'] : [])),
      readFile: vi.fn(async (p: string) => {
        if (p.endsWith('a.json')) return JSON.stringify({ id: 'architect', displayName: 'Architect', icon: '🏛️' });
        if (p.endsWith('b.json')) return JSON.stringify({ id: 'backend-dev', name: 'Backend Dev' });
        throw new Error('not found');
      })
    });
    const res = await mod.listProfiles();
    const byId = Object.fromEntries(res.map((p: any) => [p.id, p]));
    expect(byId['architect'].displayName).toBe('Architect');
    expect(byId['architect'].icon).toBe('🏛️');
    expect(byId['backend-dev'].displayName).toBe('Backend Dev'); // falls back to name
  });
});

describe('saveTeam', () => {
  it('creates a new team: slug filename, derived fields, ok:true', async () => {
    const writeFile = vi.fn(async () => {});
    const { mod } = await makeMainModule({
      readdir: vi.fn(async (p: string) => (p.endsWith('teams') ? ['existing.json'] : [])),
      writeFile
    });
    const res = await mod.saveTeam({
      name: 'Backend Squad',
      slots: [{ profileId: 'architect', quantity: 1 }, { profileId: 'backend-dev', quantity: 2 }],
      maxConcurrentWorkers: 4
    });
    expect(res).toEqual({ ok: true, id: 'backend-squad' });
    const [path, data] = writeFile.mock.calls[0];
    expect(path).toMatch(/teams\/backend-squad\.json$/);
    const written = JSON.parse(data);
    expect(written.workerProfileIds).toEqual(['architect', 'backend-dev']);
    expect(written.maxTotalWorkers).toBe(3);
    expect(written.rules.maxConcurrentWorkers).toBe(4);
    expect(typeof written.updatedAt).toBe('string');
  });

  it('suffixes the slug on collision', async () => {
    const writeFile = vi.fn(async () => {});
    const { mod } = await makeMainModule({
      readdir: vi.fn(async (p: string) => (p.endsWith('teams') ? ['backend-squad.json'] : [])),
      writeFile
    });
    const res = await mod.saveTeam({ name: 'Backend Squad', slots: [{ profileId: 'a', quantity: 1 }] });
    expect(res).toEqual({ ok: true, id: 'backend-squad-2' });
  });

  it('edits an existing team in place, preserving id and unknown keys', async () => {
    const writeFile = vi.fn(async () => {});
    const raw = {
      id: 'backend-squad', name: 'Old', slots: [{ profileId: 'a', quantity: 1 }],
      rules: { maxConcurrentWorkers: 4, autoRestart: true }, dynamicSpawning: true
    };
    const { mod } = await makeMainModule({
      readFile: vi.fn(async (p: string) =>
        p.endsWith('teams/backend-squad.json') ? JSON.stringify(raw) : (() => { throw new Error('x'); })()
      ),
      readdir: vi.fn(async (p: string) => (p.endsWith('teams') ? ['backend-squad.json'] : [])),
      writeFile
    });
    const res = await mod.saveTeam({
      id: 'backend-squad', name: 'New Name', slots: [{ profileId: 'a', quantity: 3 }]
    });
    expect(res).toEqual({ ok: true, id: 'backend-squad' });
    const written = JSON.parse(writeFile.mock.calls[0][1]);
    expect(written.name).toBe('New Name');
    expect(written.dynamicSpawning).toBe(true); // preserved
    expect(written.rules.autoRestart).toBe(true); // preserved
    expect(written.maxTotalWorkers).toBe(3);
  });

  it('returns ok:false on validation failure and never writes', async () => {
    const writeFile = vi.fn(async () => {});
    const { mod } = await makeMainModule({ writeFile });
    const res = await mod.saveTeam({ name: '', slots: [] });
    expect(res.ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('returns ok:false (not a throw) when writeFile is denied', async () => {
    const { mod } = await makeMainModule({
      readdir: vi.fn(async () => []),
      writeFile: vi.fn(async () => { throw new Error('PermissionDenied: fs:write'); })
    });
    const res = await mod.saveTeam({ name: 'X', slots: [{ profileId: 'a', quantity: 1 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/permission|write/i);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- extensions/zana-hub/src/__tests__/main-team-edit.test.ts`
Expected: FAIL — `mod.getTeam` / `mod.listProfiles` / `mod.saveTeam` are not functions.

- [ ] **Step 5: Implement the three handlers**

In `extensions/zana-hub/src/main/index.ts`, inside the object returned by `setup(ctx)` (the same object that currently has `overview()`), add these three methods. Place them after `overview`:

```ts
      /**
       * Read one team template into the full editable projection PLUS the raw
       * parsed object (so saveTeam can merge onto it and preserve unknown keys).
       * Returns null for an unsafe id, a missing file, or malformed JSON.
       */
      async getTeam(id: string): Promise<GetTeamResult | null> {
        if (!fs || typeof id !== 'string' || !isSafeId(id)) return null;
        let raw: string;
        try {
          raw = await fs.readFile(join(ZANA_ROOT, 'teams', `${id}.json`), 'utf-8');
        } catch {
          return null;
        }
        const val = safeParse(raw);
        if (!val || typeof val !== 'object') return null;
        const o = val as Record<string, unknown>;
        const slots = Array.isArray(o.slots)
          ? o.slots
              .map((s) => {
                const so = (s ?? {}) as Record<string, unknown>;
                const profileId = asString(so.profileId);
                const quantity = typeof so.quantity === 'number' ? so.quantity : 1;
                return profileId ? { profileId, quantity } : null;
              })
              .filter((s): s is { profileId: string; quantity: number } => s !== null)
          : [];
        const rules = (o.rules && typeof o.rules === 'object' ? o.rules : {}) as Record<string, unknown>;
        const template: ZanaTeamTemplate = {
          id: asString(o.id) ?? id,
          name: asString(o.name) ?? id,
          icon: asString(o.icon),
          description: asString(o.description),
          orchestratorProfileId: asString(o.orchestratorProfileId),
          slots,
          initialPrompt: asString(o.initialPrompt),
          maxConcurrentWorkers:
            typeof rules.maxConcurrentWorkers === 'number' ? rules.maxConcurrentWorkers : undefined,
          autoStart: o.autoStart === true
        };
        return { template, raw: o };
      },

      /** List `~/.zana/profiles` as dropdown options. Never throws. */
      async listProfiles(): Promise<ZanaProfileOption[]> {
        if (!fs) return [];
        const raws = await readJsonDir(fs, 'profiles', () => {});
        const out: ZanaProfileOption[] = [];
        for (const v of raws) {
          if (!v || typeof v !== 'object') continue;
          const o = v as Record<string, unknown>;
          const id = asString(o.id);
          if (!id) continue;
          out.push({
            id,
            displayName: asString(o.displayName) ?? asString(o.name) ?? id,
            icon: asString(o.icon)
          });
        }
        out.sort((a, b) => a.displayName.localeCompare(b.displayName));
        return out;
      },

      /**
       * The SINGLE write seam. Validates, resolves the id/filename (slug for a
       * new team, preserved for an edit), merges onto the existing raw object,
       * normalizes derived fields, and writes. Never throws — failure is data.
       */
      async saveTeam(input: ZanaTeamTemplate): Promise<SaveTeamResult> {
        if (!fs) return { ok: false, error: 'Filesystem write capability unavailable — grant fs:write for ~/.zana.' };
        const invalid = validateTeam(input);
        if (invalid) return { ok: false, error: invalid };

        // List existing stems for collision-suffixing / id resolution.
        let stems: string[] = [];
        try {
          stems = (await fs.readdir(join(ZANA_ROOT, 'teams')))
            .filter((n) => n.endsWith('.json') && n !== '_index.json')
            .map((n) => n.slice(0, -'.json'.length));
        } catch {
          stems = [];
        }

        let id: string;
        let base: Record<string, unknown> = {};
        if (input.id && isSafeId(input.id)) {
          // Edit: preserve id, merge onto the existing raw object if readable.
          id = input.id;
          const existing = await this.getTeam(id);
          if (existing) base = existing.raw;
        } else {
          // Create: mint a unique slug from the name.
          id = uniqueSlug(input.name, stems);
        }

        const merged = normalizeTeam(input, base, id, new Date().toISOString());
        try {
          await fs.writeFile(join(ZANA_ROOT, 'teams', `${id}.json`), JSON.stringify(merged, null, 2));
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        ctx.log(`saveTeam: wrote teams/${id}.json`);
        return { ok: true, id };
      },
```

Note: `saveTeam` calls `this.getTeam(...)`. The object returned from `setup` is a plain object literal, so `this` resolves to it when invoked via `host.call` (dispatched as `fn(...args)` — but `fn` is the property, so `this` binding is lost). **To be safe, do NOT rely on `this`** — instead extract a local `getTeamImpl(id)` function inside `setup` and have both the `getTeam` handler and `saveTeam` call it. Refactor: define `const getTeamImpl = async (id: string): Promise<GetTeamResult | null> => { … }` (the body from the `getTeam` handler) above the `return {}`, then `getTeam: getTeamImpl` and inside `saveTeam` call `await getTeamImpl(id)`.

- [ ] **Step 6: Apply the `this`-safety refactor**

Move the `getTeam` body into a `const getTeamImpl` arrow function declared inside `setup(ctx)` before the `return {`:

```ts
    const getTeamImpl = async (id: string): Promise<GetTeamResult | null> => {
      // ... exact body shown in Step 5's getTeam ...
    };
```

Then in the returned object: `getTeam: getTeamImpl,` and in `saveTeam` replace `await this.getTeam(id)` with `await getTeamImpl(id)`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- extensions/zana-hub/src/__tests__/main-team-edit.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 8: Run the full extension test suite (no regressions)**

Run: `npm test -- extensions/zana-hub`
Expected: PASS — `main-overview.test.ts`, `normalize-team.test.ts`, `main-team-edit.test.ts` all green.

- [ ] **Step 9: Typecheck**

Run: `npm --prefix extensions/zana-hub run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add extensions/zana-hub/src/main/index.ts extensions/zana-hub/src/__tests__/main-team-edit.test.ts
git commit -m "feat(zana-hub): getTeam / listProfiles / saveTeam handlers"
```

---

### Task 4: Manifest — grant `fs:write`

**Files:**
- Modify: `extensions/zana-hub/extension.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the `fs:write` capability at runtime for `ctx.fs.writeFile` (Task 3's `saveTeam`).

- [ ] **Step 1: Add `fs:write` to permissions**

In `extensions/zana-hub/extension.json`, change the `permissions` line from:

```json
  "permissions": ["fs:read", "external:open"],
```

to:

```json
  "permissions": ["fs:read", "fs:write", "external:open"],
```

Leave `permissionScopes.fsRoots: ["~/.zana"]` unchanged — write stays scoped to `~/.zana`.

- [ ] **Step 2: Commit**

```bash
git add extensions/zana-hub/extension.json
git commit -m "feat(zana-hub): request fs:write (scoped to ~/.zana) for team editing"
```

---

### Task 5: Renderer — inline team editor in the Teams tab

**Files:**
- Modify: `extensions/zana-hub/src/renderer/panel.tsx`

**Interfaces:**
- Consumes: `getTeam`, `listProfiles`, `saveTeam` via `host.call` (Task 3); `ZanaTeamTemplate`, `ZanaTeamSlot`, `ZanaProfileOption`, `SaveTeamResult`, `GetTeamResult` (Task 1).
- Produces: an editable Teams tab (list mode + editor mode). No new exports.

- [ ] **Step 1: Import the new types**

At the top of `extensions/zana-hub/src/renderer/panel.tsx`, extend the `../shared/types.js` import to include the new shapes:

```ts
import type {
  GetTeamResult,
  SaveTeamResult,
  ZanaHubOverview,
  ZanaProfileOption,
  ZanaProfileSummary,
  ZanaRunSummary,
  ZanaSkillSummary,
  ZanaTeamSlot,
  ZanaTeamSummary,
  ZanaTeamTemplate
} from '../shared/types.js';
```

- [ ] **Step 2: Add the `TeamEditorView` component**

Inside `activate({ React, host })`, after the existing `TeamsView` function (~line 175), add the editor. It is built with `h` (never JSX):

```tsx
    /** Empty template for a brand-new team. */
    function emptyTemplate(): ZanaTeamTemplate {
      return { name: '', slots: [{ profileId: '', quantity: 1 }] };
    }

    /**
     * Full-template editor. Binds to a local ZanaTeamTemplate; on Save calls
     * saveTeam and, on success, invokes onSaved() (parent re-reads overview and
     * returns to list mode). Profiles feed the slot/orchestrator dropdowns; any
     * referenced-but-unknown profileId gets a synthetic option so it round-trips.
     */
    function TeamEditorView(props: {
      initial: ZanaTeamTemplate;
      profiles: ZanaProfileOption[];
      onSaved: () => void;
      onCancel: () => void;
    }) {
      const [t, setT] = useState<ZanaTeamTemplate>(props.initial);
      const [saving, setSaving] = useState(false);
      const [err, setErr] = useState<string | null>(null);

      const set = (patch: Partial<ZanaTeamTemplate>) => setT((prev) => ({ ...prev, ...patch }));
      const setSlot = (i: number, patch: Partial<ZanaTeamSlot>) =>
        setT((prev) => ({ ...prev, slots: prev.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
      const addSlot = () => setT((prev) => ({ ...prev, slots: [...prev.slots, { profileId: '', quantity: 1 }] }));
      const removeSlot = (i: number) =>
        setT((prev) => ({ ...prev, slots: prev.slots.filter((_, j) => j !== i) }));

      // Build the profile option set, injecting a synthetic entry for any
      // referenced profileId that isn't a known profile file (e.g. UUIDs).
      const known = new Set(props.profiles.map((p) => p.id));
      const referenced = [t.orchestratorProfileId, ...t.slots.map((s) => s.profileId)].filter(
        (id): id is string => !!id && !known.has(id)
      );
      const options: ZanaProfileOption[] = [
        ...props.profiles,
        ...referenced.map((id) => ({ id, displayName: `⚠ unknown: ${id}` }))
      ];

      const save = () => {
        setSaving(true);
        setErr(null);
        host
          .call<SaveTeamResult>('saveTeam', t)
          .then((res) => {
            if (res.ok) props.onSaved();
            else setErr(res.error);
          })
          .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
          .finally(() => setSaving(false));
      };

      const labelStyle = { fontSize: 11, fontWeight: 600, color: 'var(--muted, #8b949e)', marginBottom: 4 };
      const inputStyle = {
        width: '100%',
        boxSizing: 'border-box' as const,
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid var(--border, #30363d)',
        background: 'var(--surface-2, #161b22)',
        color: 'var(--text, #c9d1d9)',
        fontSize: 13
      };
      const field = (label: string, control: unknown) =>
        h('div', { style: { marginBottom: 12 } }, h('div', { style: labelStyle }, label), control as never);

      const profileSelect = (value: string | undefined, onChange: (v: string) => void, allowEmpty: boolean) =>
        h(
          'select',
          {
            value: value ?? '',
            onChange: (e: { target: { value: string } }) => onChange(e.target.value),
            style: inputStyle
          },
          allowEmpty ? h('option', { key: '', value: '' }, '— select profile —') : null,
          ...options.map((p) => h('option', { key: p.id, value: p.id }, p.displayName))
        );

      return h(
        'div',
        { style: { padding: 16, maxWidth: 720 } },
        err ? h('div', { style: { color: '#f85149', fontSize: 12, marginBottom: 12 } }, err) : null,
        field(
          'Name',
          h('input', {
            type: 'text',
            value: t.name,
            placeholder: 'Backend Squad',
            onChange: (e: { target: { value: string } }) => set({ name: e.target.value }),
            style: inputStyle
          })
        ),
        field(
          'Icon (emoji)',
          h('input', {
            type: 'text',
            value: t.icon ?? '',
            placeholder: '⚙️',
            onChange: (e: { target: { value: string } }) => set({ icon: e.target.value }),
            style: { ...inputStyle, width: 80 }
          })
        ),
        field(
          'Description',
          h('textarea', {
            value: t.description ?? '',
            rows: 2,
            onChange: (e: { target: { value: string } }) => set({ description: e.target.value }),
            style: inputStyle
          })
        ),
        field('Orchestrator', profileSelect(t.orchestratorProfileId, (v) => set({ orchestratorProfileId: v }), true)),
        // Slots
        h('div', { style: labelStyle }, 'Roster slots'),
        ...t.slots.map((s, i) =>
          h(
            'div',
            { key: String(i), style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
            h('div', { style: { flex: 1 } }, profileSelect(s.profileId, (v) => setSlot(i, { profileId: v }), true)),
            h('input', {
              type: 'number',
              min: 1,
              value: s.quantity,
              onChange: (e: { target: { value: string } }) =>
                setSlot(i, { quantity: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }),
              style: { ...inputStyle, width: 72 }
            }),
            h(
              'button',
              {
                type: 'button',
                onClick: () => removeSlot(i),
                disabled: t.slots.length <= 1,
                style: {
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #30363d)',
                  background: 'transparent',
                  color: 'var(--muted, #8b949e)',
                  cursor: t.slots.length <= 1 ? 'default' : 'pointer'
                }
              },
              'Remove'
            )
          )
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: addSlot,
            style: {
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px dashed var(--border, #30363d)',
              background: 'transparent',
              color: 'var(--text, #c9d1d9)',
              cursor: 'pointer',
              marginBottom: 12
            }
          },
          '+ Add slot'
        ),
        field(
          'Initial prompt',
          h('textarea', {
            value: t.initialPrompt ?? '',
            rows: 6,
            onChange: (e: { target: { value: string } }) => set({ initialPrompt: e.target.value }),
            style: inputStyle
          })
        ),
        field(
          'Max concurrent workers',
          h('input', {
            type: 'number',
            min: 1,
            value: t.maxConcurrentWorkers ?? '',
            placeholder: 'default: total slots',
            onChange: (e: { target: { value: string } }) => {
              const v = parseInt(e.target.value, 10);
              set({ maxConcurrentWorkers: Number.isInteger(v) && v >= 1 ? v : undefined });
            },
            style: { ...inputStyle, width: 120 }
          })
        ),
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16 } },
          h('input', {
            type: 'checkbox',
            checked: t.autoStart === true,
            onChange: (e: { target: { checked: boolean } }) => set({ autoStart: e.target.checked })
          }),
          'Auto-start'
        ),
        // Actions
        h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(
            'button',
            {
              type: 'button',
              onClick: save,
              disabled: saving,
              style: {
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 16px',
                borderRadius: 6,
                border: 'none',
                background: '#238636',
                color: '#fff',
                cursor: saving ? 'default' : 'pointer'
              }
            },
            saving ? 'Saving…' : 'Save'
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: props.onCancel,
              disabled: saving,
              style: {
                fontSize: 13,
                padding: '6px 16px',
                borderRadius: 6,
                border: '1px solid var(--border, #30363d)',
                background: 'transparent',
                color: 'var(--text, #c9d1d9)',
                cursor: 'pointer'
              }
            },
            'Cancel'
          )
        )
      );
    }
```

- [ ] **Step 3: Rewrite `TeamsView` to add New + per-row Edit**

Replace the existing `TeamsView` function with a version that takes an `onEdit` and `onNew` callback and renders the buttons:

```tsx
    function TeamsView(props: {
      teams: ZanaTeamSummary[];
      onNew: () => void;
      onEdit: (id: string) => void;
    }) {
      const newBtn = h(
        'div',
        { style: { padding: '10px 14px', borderBottom: '1px solid var(--border, #21262d)' } },
        h(
          'button',
          {
            type: 'button',
            onClick: props.onNew,
            style: {
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#238636',
              color: '#fff',
              cursor: 'pointer'
            }
          },
          '+ New team'
        )
      );
      if (props.teams.length === 0) {
        return h('div', null, newBtn, h(SectionEmpty, { text: 'No team templates in ~/.zana/teams.' }));
      }
      const editBtn = (id: string) =>
        h(
          'button',
          {
            type: 'button',
            onClick: () => props.onEdit(id),
            style: {
              fontSize: 12,
              padding: '3px 10px',
              borderRadius: 6,
              border: '1px solid var(--border, #30363d)',
              background: 'transparent',
              color: 'var(--text, #c9d1d9)',
              cursor: 'pointer'
            }
          },
          'Edit'
        );
      return h(
        'div',
        null,
        newBtn,
        ...props.teams.map((t) =>
          h(Row, {
            key: t.id,
            left: `${t.icon ? t.icon + ' ' : ''}${t.name}`,
            sub: `${t.slots} slot${t.slots === 1 ? '' : 's'}${t.maxWorkers != null ? ` · max ${t.maxWorkers} workers` : ''}`,
            right: h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              t.autoStart ? h(Chip, { text: 'auto-start', color: '#3fb950', subtle: true }) : null,
              editBtn(t.id)
            )
          })
        )
      );
    }
```

- [ ] **Step 4: Wire editor state into `Panel`**

Inside `Panel`, add state after the existing `const [tab, setTab] = useState<Tab>('overview');`:

```tsx
      // Team editor: null = list mode; otherwise the template being edited
      // ('new' seeds an empty one). Profiles are loaded lazily when it opens.
      const [editing, setEditing] = useState<ZanaTeamTemplate | null>(null);
      const [profiles, setProfiles] = useState<ZanaProfileOption[]>([]);
      const [editLoading, setEditLoading] = useState(false);

      const openNew = useCallback(() => {
        setEditLoading(true);
        host
          .call<ZanaProfileOption[]>('listProfiles')
          .then((ps) => setProfiles(ps))
          .catch(() => setProfiles([]))
          .finally(() => {
            setEditing({ name: '', slots: [{ profileId: '', quantity: 1 }] });
            setEditLoading(false);
          });
      }, []);

      const openEdit = useCallback((id: string) => {
        setEditLoading(true);
        Promise.all([
          host.call<ZanaProfileOption[]>('listProfiles').catch(() => [] as ZanaProfileOption[]),
          host.call<GetTeamResult | null>('getTeam', id)
        ])
          .then(([ps, res]) => {
            setProfiles(ps);
            if (res) setEditing(res.template);
            else setError('That team template is no longer readable.');
          })
          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setEditLoading(false));
      }, []);
```

- [ ] **Step 5: Route the Teams body to list-or-editor**

In `Panel`'s body selection, replace the `else if (tab === 'teams')` branch:

```tsx
      } else if (tab === 'teams') {
        body = editing
          ? h(TeamEditorView, {
              initial: editing,
              profiles,
              onSaved: () => {
                setEditing(null);
                load(); // refresh the list + nav badge
              },
              onCancel: () => setEditing(null)
            })
          : h(TeamsView, {
              teams: data.teams,
              onNew: openNew,
              onEdit: openEdit
            });
```

(If `editLoading` should show a spinner, the existing `loading`/`SectionEmpty` header already communicates activity; keeping it simple is fine.)

- [ ] **Step 6: Reset the editor when leaving the Teams tab**

So the editor doesn't linger when switching tabs, update the tab buttons' `onClick` in the `tabBar` to clear editing:

Change `onClick: () => setTab(t.id),` to:

```tsx
              onClick: () => {
                setEditing(null);
                setTab(t.id);
              },
```

- [ ] **Step 7: Typecheck**

Run: `npm --prefix extensions/zana-hub run typecheck`
Expected: PASS. (If TS complains about event `target` inline types, they are declared inline in the handlers above — matching the existing panel's untyped-DOM style.)

- [ ] **Step 8: Commit**

```bash
git add extensions/zana-hub/src/renderer/panel.tsx
git commit -m "feat(zana-hub): inline team-template editor in the Teams tab"
```

---

### Task 6: Build, package, and manual verification in the dev app

**Files:**
- No source changes (build artifacts + a manual smoke test).

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a working, re-consented, editable Teams tab in the running app.

- [ ] **Step 1: Build the extension**

Run: `npm --prefix extensions/zana-hub run build`
Expected: writes `extensions/zana-hub/dist/renderer.js` and `dist/main.mjs` with no errors.

- [ ] **Step 2: Package it (seed into examples + ~/.zcc)**

Run: `npm --prefix extensions/zana-hub run package`
Expected: copies the built bundle into `examples/extensions/zana-hub` and seeds `~/.zcc/extensions/zana-hub`.

- [ ] **Step 3: Run the full repo test + typecheck gate**

Run: `npm test -- extensions/zana-hub && npm --prefix extensions/zana-hub run typecheck`
Expected: all extension tests PASS, typecheck clean.

- [ ] **Step 4: Launch the dev app and re-consent**

Run (background): `npm run dev`
Then in the app:
1. Open the **Zana** sidebar entry (under "Extensions").
2. Because `fs:write` was added, the **consent screen** should appear on load — verify it lists write access scoped to `~/.zana`, and approve it.

Expected: the Zana panel loads; the consent prompt shows the new `fs:write` scope.

- [ ] **Step 5: Manually verify edit + create**

In the **Teams** tab:
1. Click **Edit** on an existing team (e.g. "Backend Squad"). Confirm the form pre-fills name, icon, orchestrator, slots, initial prompt, concurrency, auto-start.
2. Change the initial prompt and a slot quantity; click **Save**. Confirm the list refreshes and no error appears.
3. In a terminal, inspect the file: `cat ~/.zana/teams/backend-squad.json` — verify `slots` changed, `workerProfileIds` matches the distinct slot ids, `maxTotalWorkers` = Σ quantities, `updatedAt` bumped, and `autoRestart`/`dynamicSpawning` were preserved.
4. Click **+ New team**, fill name "Smoke Test Squad" + one slot, Save. Confirm `~/.zana/teams/smoke-test-squad.json` exists with the derived fields.
5. Open the UUID-referencing team ("Core Development Squad") in the editor and confirm each slot dropdown shows a `⚠ unknown: <uuid>` option (since those profileIds aren't named profile files) rather than a blank/dropped slot. Cancel without saving.

Expected: all five checks pass. (Clean up the smoke-test file afterward: `rm ~/.zana/teams/smoke-test-squad.json`.)

- [ ] **Step 6: Final commit (if package produced tracked artifacts)**

```bash
git add examples/extensions/zana-hub
git commit -m "chore(zana-hub): rebuild + repackage with team editor"
```

(If `examples/extensions/zana-hub` is gitignored or unchanged, skip this commit.)

---

## Self-Review

**Spec coverage:**
- Manifest `fs:write` → Task 4. ✓
- `getTeam` / `listProfiles` / `saveTeam` handlers → Task 3. ✓
- Derived-field normalization (`workerProfileIds`, `maxTotalWorkers`, independent `rules.maxConcurrentWorkers`, round-trip preservation, `updatedAt`) → Task 2 (pure) + verified in Task 3. ✓
- Slug-from-name + collision suffix, id immutable on edit → Task 2 (`uniqueSlug`) + Task 3 (`saveTeam` id resolution). ✓
- Dropdown-only profile pickers + synthetic unknown-profile option → Task 5 (`TeamEditorView` `options`). ✓
- Basename/traversal guard on id (defense in depth) → Task 3 (`isSafeId`). ✓
- Renderer editor (list mode + form, injected `h`) → Task 5. ✓
- `saveTeam` never throws; failure is `{ok:false,error}` → Task 3 tests. ✓
- Known limitation (plain writeFile, no lock) → documented in spec; no task needed (deliberate non-goal). ✓
- Non-goals (no delete, no profile/skill editing, no launch) → nothing implements them. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. The one "if gitignored, skip" note in Task 6 Step 6 is a conditional real instruction, not a placeholder.

**Type consistency:** `ZanaTeamTemplate`, `ZanaTeamSlot`, `ZanaProfileOption`, `GetTeamResult`, `SaveTeamResult` are defined in Task 1 and consumed with matching names/shapes in Tasks 3 and 5. `normalizeTeam(input, base, id, nowIso)`, `uniqueSlug(name, existingStems)`, `validateTeam(input)`, `slugify(name)` signatures in Task 2 match their call sites in Task 3. The `getTeamImpl` refactor (Task 3 Steps 5-6) resolves the `this`-binding hazard so `saveTeam` reliably reuses the read logic.
