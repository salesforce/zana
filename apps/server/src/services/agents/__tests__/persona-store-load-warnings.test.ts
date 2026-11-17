import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testHome = join(tmpdir(), `persona-load-warnings-${process.pid}-${Date.now()}`);
vi.mock('electron', () => ({
  app: { getPath: (name: string) => { if (name === 'home') return testHome; throw new Error(`Unexpected getPath('${name}')`); } },
  shell: { openPath: vi.fn() }
}));

import { PersonaStore } from '../persona-store.js';

// REQ-16: PersonaStore.loadWarnings reports every dropped persona file by basename, source and a fixed reason.
const userDir = join(testHome, '.zcc', 'personas');
const projectRoot = join(testHome, 'proj');

function put(dir: string, file: string, body: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), typeof body === 'string' ? body : JSON.stringify(body));
}

function load(projects: Array<{ id: string; name: string; path: string }> = []): PersonaStore {
  const store = new PersonaStore(() => projects as never);
  store.refresh();
  return store;
}

beforeEach(() => { rmSync(testHome, { recursive: true, force: true }); });
afterEach(() => { rmSync(testHome, { recursive: true, force: true }); });

const ok = { id: 'good', name: 'Good' };

describe('PersonaStore.loadWarnings (REQ-16)', () => {
  it.each([
    ['bad baseProfile', { ...ok, id: 'a', baseProfile: 'nope' }, 'bad-base-profile'],
    ['bad permissionMode', { ...ok, id: 'a', permissionMode: 'wild' }, 'bad-permission-mode'],
    ['bad modelLevel', { ...ok, id: 'a', modelLevel: 'huge' }, 'bad-model-level'],
    ['bad skills', { ...ok, id: 'a', skills: ['*'] }, 'bad-skills'],
    ['non-string model', { ...ok, id: 'a', model: 7 }, 'non-string-model'],
    ['empty id', { id: '  ', name: 'X' }, 'empty-id'],
    ['empty name', { id: 'a', name: '' }, 'empty-name'],
    ['malformed JSON', '{ not json', 'malformed-json']
  ] as const)('reports a dropped file: %s', (_label, body, reason) => {
    put(userDir, 'a.json', body);
    const warnings = load().loadWarnings();
    expect(warnings).toEqual([{ file: 'a.json', source: 'user', reason }]);
  });

  it('reports a dropped project persona with source project', () => {
    put(join(projectRoot, '.zcc', 'personas'), 'p.json', { id: 'p', name: 'P', permissionMode: 'wild' });
    const warnings = load([{ id: 'p1', name: 'P1', path: projectRoot }]).loadWarnings();
    expect(warnings).toEqual([{ file: 'p.json', source: 'project', reason: 'bad-permission-mode' }]);
  });

  it('never includes file content or a directory in the warning', () => {
    put(userDir, 'leaky.json', '{"id":"s3cr3t-token-abc", "name": "x", ');
    const [warning] = load().loadWarnings();
    expect(warning.file).toBe('leaky.json');
    const text = JSON.stringify(warning);
    expect(text).not.toContain('s3cr3t');
    expect(text).not.toContain(testHome);
  });

  it('returns no warnings for valid personas and keeps them loaded (existing-user path)', () => {
    put(userDir, 'good.json', ok);
    const store = load();
    expect(store.loadWarnings()).toEqual([]);
    expect(store.list().some((p) => p.id === 'good')).toBe(true);
  });

  it('caps the list at 100 warnings', () => {
    for (let i = 0; i < 130; i += 1) put(userDir, `bad-${i}.json`, '{ nope');
    expect(load().loadWarnings()).toHaveLength(100);
  });

  it('clears a warning once the file is fixed and the store refreshes', () => {
    put(userDir, 'a.json', '{ nope');
    const store = load();
    expect(store.loadWarnings()).toHaveLength(1);
    put(userDir, 'a.json', { id: 'a', name: 'A' });
    store.refresh();
    expect(store.loadWarnings()).toEqual([]);
  });
});
