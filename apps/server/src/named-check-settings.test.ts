import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectSettingsStore } from './project-settings-store.js';
import { createNamedCheckDiscovery, resolveNamedCheck } from './named-check-registry.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'named-check-settings-'));
  roots.push(root);
  const file = join(root, 'project-settings.json');
  return { root, file, store: createProjectSettingsStore({ projectSettingsFile: file }) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('named-check settings', () => {
  it.each(['2bad', 'a.b', 'a'.repeat(101)])('rejects incompatible reference check:%s before lookup', (name) => {
    const { store } = fixture();
    expect(() => resolveNamedCheck(store, 'p1', `check:${name}`)).toThrow('Invalid check reference');
  });

  it.each(['_tests-2', 'lint-fast', 'A_b-2', 'a'.repeat(100)])('persists and resolves portable check name %s', async (name) => {
    const { store, file } = fixture();
    await store.setNamedChecks({ kind: 'global' }, [{ name, command: 'global-check' }]);
    await store.setNamedChecks({ kind: 'project', projectId: 'p1' }, [{ name, command: 'project-check' }]);
    expect(createNamedCheckDiscovery(store).listNames('p1')).toEqual([name]);
    expect(resolveNamedCheck(store, 'p1', `check:${name}`).command).toBe('project-check');
    const reopened = createProjectSettingsStore({ projectSettingsFile: file });
    expect(resolveNamedCheck(reopened, 'p2', `check:${name}`).command).toBe('global-check');
  });

  it.each(['2bad', 'a.b', 'a'.repeat(101), '', '-bad', 'bad/name', 'bad\0name'])('rejects incompatible name %s without registry mutation', async (name) => {
    const { store, file } = fixture();
    await store.setNamedChecks({ kind: 'global' }, [{ name: 'safe', command: 'safe-check' }]);
    const before = readFileSync(file, 'utf8');
    await expect(store.setNamedChecks({ kind: 'global' }, [{ name, command: 'bad-check' }])).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(() => resolveNamedCheck(store, 'p1', `check:${name}`)).toThrow('Invalid check reference');
  });

  it('provides dedicated registry persistence outside generic project settings', async () => {
    const { store, file, root } = fixture();
    expect(store).toHaveProperty('setNamedChecks', expect.any(Function));
    await store.setNamedChecks({ kind: 'global' }, [{ name: 'test', command: 'global-test' }]);
    await store.setNamedChecks({ kind: 'project', projectId: 'p1' }, [{ name: 'test', command: 'project-test' }]);
    expect(store.getNamedChecks({ kind: 'global' })).toEqual([{ name: 'test', command: 'global-test' }]);
    expect(store.getNamedChecks({ kind: 'project', projectId: 'p1' })).toEqual([{ name: 'test', command: 'project-test' }]);
    expect(store.get('p1')).toEqual({});
    const reopened = createProjectSettingsStore({ projectSettingsFile: file });
    expect(reopened.getNamedChecks({ kind: 'project', projectId: 'p1' })).toEqual([{ name: 'test', command: 'project-test' }]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(root)).toEqual(['project-settings.json']);
  });

  it('serializes checks and generic settings without lost updates or leaked commands', async () => {
    const { store } = fixture();
    await Promise.all([
      store.setNamedChecks({ kind: 'global' }, [{ name: 'lint', command: 'lint' }]),
      store.setNamedChecks({ kind: 'project', projectId: 'p1' }, [{ name: 'test', command: 'test' }]),
      store.set('p1', { worktreeIsolation: true }),
      store.set('p2', { launchApproval: 'review' })
    ]);
    expect(store.get('p1')).toEqual({ worktreeIsolation: true });
    expect(store.getNamedChecks({ kind: 'project', projectId: 'p1' })).toEqual([{ name: 'test', command: 'test' }]);
    await store.remove('p1');
    expect(store.getNamedChecks({ kind: 'project', projectId: 'p1' })).toEqual([]);
    expect(store.getNamedChecks({ kind: 'global' })).toHaveLength(1);
  });

  it('rejects generic command writes, invalid scopes, duplicate names and oversized commands', async () => {
    const { store, file } = fixture();
    await store.setNamedChecks({ kind: 'global' }, [{ name: 'test', command: 'safe' }]);
    const before = readFileSync(file, 'utf8');
    for (const patch of [{ checks: [{ name: 'test', command: 'bad' }] }, { namedChecks: [] }]) {
      await expect(store.set('p1', patch as never)).rejects.toThrow();
    }
    for (const scope of [{ kind: 'project', projectId: '$globalNamedChecks' }, { kind: 'global', owner: true }]) {
      await expect(store.setNamedChecks(scope as never, [])).rejects.toThrow();
    }
    for (const checks of [
      [{ name: 'test', command: '' }], [{ name: 'bad name', command: 'test' }],
      [{ name: 'test', command: 'x'.repeat(16_385) }],
      [{ name: 'test', command: 'a' }, { name: 'test', command: 'b' }],
      Array.from({ length: 65 }, (_, i) => ({ name: `test${i}`, command: 'a' }))
    ]) await expect(store.setNamedChecks({ kind: 'global' }, checks)).rejects.toThrow();
    await expect(store.set('$globalNamedChecks', {})).rejects.toThrow();
    await expect(store.remove('$globalNamedChecks')).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('does not accept corrupted persisted registry commands', () => {
    const { store, file } = fixture();
    writeFileSync(file, JSON.stringify({ p1: { namedChecks: [{ name: 'test', command: 7 }] } }));
    expect(() => store.getNamedChecks({ kind: 'project', projectId: 'p1' })).toThrow();
  });

  it('lists only names from both scopes and resolves project before global', async () => {
    const { store } = fixture();
    await store.setNamedChecks({ kind: 'global' }, [{ name: 'lint', command: 'global-lint' }, { name: 'test', command: 'global-test' }]);
    await store.setNamedChecks({ kind: 'project', projectId: 'p1' }, [{ name: 'test', command: 'project-test' }]);
    expect(createNamedCheckDiscovery(store).listNames('p1')).toEqual(['lint', 'test']);
    expect(resolveNamedCheck(store, 'p1', 'check:test').command).toBe('project-test');
    expect(resolveNamedCheck(store, 'p2', 'check:lint').command).toBe('global-lint');
    expect(() => resolveNamedCheck(store, 'p1', 'check:unknown')).toThrow('Unknown check');
    expect(() => resolveNamedCheck(store, 'p1', 'pnpm test')).toThrow('Invalid check reference');
  });
});
