import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testHome = join(tmpdir(), `quick-prompt-store-test-${Date.now()}`);
// A second describe block reuses the same mocked home, so both suites' files
// land under one tree; keep them isolated by clearing it in each beforeEach.
const testHomeB2 = testHome;
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return testHome;
      throw new Error(`Unexpected getPath('${name}')`);
    }
  },
  shell: { openPath: vi.fn() }
}));

import { QuickPromptStore } from '../quick-prompt-store.js';

describe('QuickPromptStore — argument templating (WARP-B1)', () => {
  let store: QuickPromptStore;
  const userDir = join(testHome, '.zcc', 'quick-prompts');

  const write = (name: string, obj: unknown) =>
    writeFileSync(join(userDir, name), JSON.stringify(obj));

  beforeEach(() => {
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
    mkdirSync(userDir, { recursive: true });
  });

  afterEach(() => {
    store?.stop();
    if (existsSync(testHome)) rmSync(testHome, { recursive: true, force: true });
  });

  const load = () => {
    store = new QuickPromptStore();
    store.start();
    return store.list();
  };

  it('ships a parametrized built-in (run-tests-for) with a package arg', () => {
    const p = load().find((q) => q.id === 'builtin:run-tests-for');
    expect(p).toBeTruthy();
    expect(p?.prompt).toContain('{{package}}');
    expect(p?.arguments?.[0]).toMatchObject({ name: 'package', type: 'text' });
  });

  it('parses a valid user arguments array', () => {
    write('deploy.json', {
      id: 'deploy',
      label: 'Deploy',
      prompt: 'deploy {{env}}',
      arguments: [
        { name: 'env', type: 'enum', enumValues: ['dev', 'prod'], description: 'target' }
      ]
    });
    const p = load().find((q) => q.id === 'deploy');
    expect(p?.arguments).toEqual([
      { name: 'env', type: 'enum', enumValues: ['dev', 'prod'], description: 'target' }
    ]);
  });

  it('drops malformed argument entries and de-dupes by name (Rule 1)', () => {
    write('messy.json', {
      id: 'messy',
      label: 'Messy',
      prompt: 'x {{a}}',
      arguments: [
        { name: 'a', type: 'text' },
        { name: 'a', type: 'enum' }, // dup name → dropped
        { type: 'text' }, // no name → dropped
        'nope', // not an object → dropped
        { name: '  ', type: 'text' } // blank name → dropped
      ]
    });
    const p = load().find((q) => q.id === 'messy');
    expect(p?.arguments).toEqual([{ name: 'a', type: 'text' }]);
  });

  it('leaves a plain prompt with no arguments field (back-compat)', () => {
    write('flat.json', { id: 'flat', label: 'Flat', prompt: 'just text' });
    const p = load().find((q) => q.id === 'flat');
    expect(p?.arguments).toBeUndefined();
  });

  it('normalizes a non-array arguments field to undefined', () => {
    write('bad.json', { id: 'bad', label: 'Bad', prompt: 'x', arguments: 'nope' });
    const p = load().find((q) => q.id === 'bad');
    expect(p?.arguments).toBeUndefined();
  });

  it('drops enumValues on a text-typed arg', () => {
    write('t.json', {
      id: 't',
      label: 'T',
      prompt: '{{x}}',
      arguments: [{ name: 'x', type: 'text', enumValues: ['a', 'b'] }]
    });
    const p = load().find((q) => q.id === 't');
    expect(p?.arguments).toEqual([{ name: 'x', type: 'text' }]);
  });
});

describe('QuickPromptStore — editor write path (WARP-B2)', () => {
  let store: QuickPromptStore;

  beforeEach(() => {
    if (existsSync(testHomeB2)) rmSync(testHomeB2, { recursive: true, force: true });
  });

  afterEach(() => {
    store?.stop();
    if (existsSync(testHomeB2)) rmSync(testHomeB2, { recursive: true, force: true });
  });

  const fresh = () => {
    store = new QuickPromptStore();
    store.start();
    return store;
  };

  it('persists a user prompt and surfaces it in the list with source:user', () => {
    const s = fresh();
    const saved = s.saveUser({
      id: 'user:my-thing',
      label: 'My thing',
      prompt: 'do {{task}}',
      profile: 'claude',
      arguments: [{ name: 'task', type: 'text', description: 'what to do' }]
    });
    expect(saved.source).toBe('user');
    const listed = s.list().find((p) => p.id === 'user:my-thing');
    expect(listed).toMatchObject({ label: 'My thing', source: 'user', profile: 'claude' });
    expect(listed?.arguments?.[0]).toMatchObject({ name: 'task', type: 'text' });
  });

  it('shadows a builtin by id, then deleteUser resets it to the shipped default', () => {
    const s = fresh();
    s.saveUser({
      id: 'builtin:run-tests-for',
      label: 'Custom tests',
      prompt: 'run {{package}} my way'
    });
    expect(s.get('builtin:run-tests-for')).toMatchObject({
      label: 'Custom tests',
      source: 'user'
    });
    s.deleteUser('builtin:run-tests-for');
    const reset = s.get('builtin:run-tests-for');
    expect(reset).toMatchObject({ label: 'Run tests for a package', source: 'builtin' });
  });

  it('rejects an invalid save (missing label / bad profile) — main authorizes (Rule 1)', () => {
    const s = fresh();
    expect(() => s.saveUser({ id: 'x', label: '  ', prompt: 'hi' } as never)).toThrow(/label/);
    expect(() => s.saveUser({ id: 'x', label: 'X', prompt: '' } as never)).toThrow(/text/);
    expect(() =>
      s.saveUser({ id: 'x', label: 'X', prompt: 'hi', profile: 'bogus' } as never)
    ).toThrow(/profile/);
  });

  it('sanitizes arguments on save exactly as the read path does', () => {
    const s = fresh();
    const saved = s.saveUser({
      id: 'user:s',
      label: 'S',
      prompt: '{{a}}',
      arguments: [
        { name: 'a', type: 'text', enumValues: ['x'] } as never, // enumValues dropped on text
        { name: 'a', type: 'enum' } as never // dup dropped
      ]
    });
    expect(saved.arguments).toEqual([{ name: 'a', type: 'text' }]);
  });
});
