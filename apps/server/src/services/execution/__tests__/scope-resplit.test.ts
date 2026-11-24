import { describe, expect, it } from 'vitest';
import { assessScopeWidening, buildSplitChild, confirmSplitPrompt, extractNamedPaths, pathInScope, splitChildId, splitDeliveryNote } from '../scope-resplit.js';
import { splitChildRouting } from '../routing-policy.js';
import type { ExecutionWorkUnit } from '../store.js';

const unit = (over: Partial<ExecutionWorkUnit> = {}) => ({
  id: 'ui', title: 'Conflict UI', task: 't', dependencies: ['base'], files: ['apps/app/src/ConflictReview.tsx', 'apps/app/src/styles'], verification: ['pnpm test'],
  state: 'BLOCKED', attempt: 0, history: [], ...over
}) as ExecutionWorkUnit;

describe('pathInScope', () => {
  it('matches exact files, directories and globs, and rejects siblings', () => {
    expect(pathInScope('a/b.ts', ['a/b.ts'])).toBe(true);
    expect(pathInScope('a/b/c.ts', ['a/b'])).toBe(true);
    expect(pathInScope('a/bc/c.ts', ['a/b'])).toBe(false);
    expect(pathInScope('src/x/y.ts', ['src/**'])).toBe(true);
    expect(pathInScope('src/x.ts', ['src/*.ts'])).toBe(true);
    expect(pathInScope('src/x/y.ts', ['src/*.ts'])).toBe(false);
    expect(pathInScope('src/a1.ts', ['src/a?.ts'])).toBe(true);
    expect(pathInScope('x.ts', ['./'])).toBe(false);
  });
});

describe('extractNamedPaths', () => {
  it('finds relative paths and bare files, drops traversal, absolute, urls-ish and versions', () => {
    const paths = extractNamedPaths('Edit `apps/server/src/api.ts`, also ./packages/x/y.json. See ../secret/a.ts, /etc/passwd and v1.2.3 e.g. foo. package.json');
    expect(paths).toEqual(['apps/server/src/api.ts', 'packages/x/y.json', 'package.json']);
  });
  it('ignores overlong tokens and plain prose', () => {
    expect(extractNamedPaths(`${'a/'.repeat(200)}b.ts and nothing else`)).toEqual([]);
  });
});

describe('assessScopeWidening', () => {
  it('widens when a path is outside the declared scope (E5: server contract)', () => {
    const a = assessScopeWidening(unit(), 'Also change apps/server/src/conflicts.ts to return the new contract; edit apps/app/src/ConflictReview.tsx.');
    expect(a).toMatchObject({ verdict: 'widens', addedFiles: ['apps/server/src/conflicts.ts'], contract: true });
  });
  it('does not widen inside scope, without paths, read-only, or scope-less units', () => {
    expect(assessScopeWidening(unit(), 'use apps/app/src/styles/x.css').verdict).toBe('none');
    expect(assessScopeWidening(unit(), 'go with option B').verdict).toBe('none');
    expect(assessScopeWidening(unit({ readOnly: true }), 'edit other/file.ts').verdict).toBe('none');
    expect(assessScopeWidening(unit({ files: [] }), 'edit other/file.ts').verdict).toBe('none');
    expect(assessScopeWidening(unit({ files: undefined }), 'edit other/file.ts').verdict).toBe('none');
  });
  it('is undecidable for a contract mention without a path, and caps the added files', () => {
    const u = assessScopeWidening(unit(), 'the API contract needs a new field');
    expect(u.verdict).toBe('undecidable');
    expect(confirmSplitPrompt('ui', u)).toContain('scopeSplit "keep"');
    const many = assessScopeWidening(unit(), Array.from({ length: 30 }, (_, i) => `other/f${i}.ts`).join(' '));
    expect(many.addedFiles).toHaveLength(20);
  });
});

describe('split child', () => {
  it('picks a unique id, keeps upstream deps, owns only the added files, and drops the parent pin', () => {
    expect(splitChildId([{ id: 'ui' }, { id: 'ui-split-1' }], 'ui')).toBe('ui-split-2');
    const parent = unit({ preferredRole: 'frontend', routing: { version: 1, hardSlotId: 'w:1', minimumLevel: 'low', excludeSameWorkerAs: ['x'], requiredRole: 'eng' } });
    const child = buildSplitChild(parent, 'ui-split-1', { verdict: 'widens', addedFiles: ['s/a.ts'], contract: true, reason: '' }, 'do s/a.ts');
    expect(child).toMatchObject({ id: 'ui-split-1', dependencies: ['base'], files: ['s/a.ts'], verification: ['pnpm test'], preferredRole: 'frontend' });
    expect(child.routing).toEqual({ version: 1, requiredRole: 'eng', minimumLevel: 'medium' });
    expect(child.task).toContain('do s/a.ts');
    expect(splitDeliveryNote('ui', 'ui-split-1', ['s/a.ts'])).toContain('unit ui-split-1');
  });
  it('builds a child without routing or verification when the parent has none', () => {
    const child = buildSplitChild(unit({ verification: undefined, preferredRole: undefined }), 'c', { verdict: 'widens', addedFiles: ['s/a.ts'], contract: false, reason: '' }, 'r');
    expect(child.routing).toBeUndefined();
    expect(child.verification).toBeUndefined();
  });
});

describe('splitChildRouting', () => {
  it('keeps a higher tier, raises low for contracts, and leaves non-contract routing alone', () => {
    expect(splitChildRouting({ version: 1, minimumLevel: 'high' }, true)?.minimumLevel).toBe('high');
    expect(splitChildRouting({ version: 1, minimumLevel: 'low' }, true)?.minimumLevel).toBe('medium');
    expect(splitChildRouting({ version: 1, minimumLevel: 'low' }, false)?.minimumLevel).toBe('low');
    expect(splitChildRouting(undefined, true)).toEqual({ version: 1, minimumLevel: 'medium' });
    expect(splitChildRouting(undefined, false)).toBeUndefined();
  });
});
