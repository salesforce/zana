import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResumeGrantStore, isResumeGrantTerminal, RESUME_GRANT_TTL_MS } from '../execution/resume-grant-store.js';

describe('resume grant store', () => {
  it('persists only digest and consumes a grant once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    try {
      const store = createResumeGrantStore({ filePath: join(dir, 'grants.json'), token: () => 'raw-token' });
      const minted = await store.mint({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner' });
      expect(minted.token).toBe('raw-token');
      expect(await readFile(join(dir, 'grants.json'), 'utf8')).not.toContain('raw-token');
      await expect(store.consume({ token: minted.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement' })).resolves.toMatchObject({ outcome: 'consumed', grant: { executionId: 'execution-1', callerPrincipalId: 'owner', boundOwnerPrincipalId: 'replacement', tokenDigest: expect.any(String) } });
      await expect(store.consume({ token: minted.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement' })).resolves.toMatchObject({ outcome: 'recovered' });
      await expect(store.consume({ token: minted.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'other' })).rejects.toThrow('not current');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('keeps BLOCKED bindable while terminal grants are not', () => {
    expect(isResumeGrantTerminal('BLOCKED')).toBe(false);
    expect(isResumeGrantTerminal('COMPLETED')).toBe(true);
    expect(isResumeGrantTerminal('STOPPED')).toBe(true);
    expect(isResumeGrantTerminal('FAILED')).toBe(true);
  });

  it('rotates one generation-bound grant for 30 days and revokes every old token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    let clock = 1_000;
    let sequence = 0;
    try {
      const store = createResumeGrantStore({ filePath: join(dir, 'grants.json'), now: () => clock, token: () => `token-${++sequence}` });
      const first = await store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 0 });
      expect(first).toEqual({ token: 'token-1', expiresAt: clock + RESUME_GRANT_TTL_MS, generation: 1 });
      const second = await store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 1 });
      expect(second).toEqual({ token: 'token-2', expiresAt: clock + RESUME_GRANT_TTL_MS, generation: 2 });
      await expect(store.consume({ token: first.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement', generation: 1 })).rejects.toThrow('not current');
      await expect(store.consume({ token: second.token, executionId: 'other', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement', generation: 2 })).rejects.toThrow('not current');
      await expect(store.consume({ token: second.token, executionId: 'execution-1', projectId: 'other', effectiveOwnerPrincipalId: 'replacement', generation: 2 })).rejects.toThrow('not current');
      await expect(store.consume({ token: second.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement', generation: 1 })).rejects.toThrow('not current');
      await expect(store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 0 })).rejects.toThrow('stale execution recovery generation');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('retains generation history after grant expiry and restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    const filePath = join(dir, 'grants.json');
    let clock = 1_000;
    let sequence = 0;
    try {
      let store = createResumeGrantStore({ filePath, now: () => clock, token: () => `token-${++sequence}` });
      await store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 0, expiresAt: 2_000 });
      clock = 3_000;
      store = createResumeGrantStore({ filePath, now: () => clock, token: () => `token-${++sequence}` });
      await expect(store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 1, expiresAt: 4_000 }))
        .resolves.toEqual({ token: 'token-2', expiresAt: 4_000, generation: 2 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('converges one generation ahead by replacing stranded token without re-enabling it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    let sequence = 0;
    try {
      const store = createResumeGrantStore({ filePath: join(dir, 'grants.json'), now: () => 1_000, token: () => `token-${++sequence}` });
      const stranded = await store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 0, expiresAt: 5_000 });
      const recovered = await store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 0, expiresAt: 5_000 });
      expect(recovered).toEqual({ token: 'token-2', expiresAt: 5_000, generation: 1 });
      await expect(store.consume({ token: stranded.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement', generation: 1 })).rejects.toThrow('not current');
      await expect(store.consume({ token: recovered.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement', generation: 1 })).resolves.toMatchObject({ outcome: 'consumed' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('migrates missing generation history using highest valid legacy grant generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    const filePath = join(dir, 'grants.json');
    try {
      await writeFile(filePath, JSON.stringify({ version: 1, revision: 2, grants: [
        { version: 1, executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', tokenDigest: 'old', mintedAt: 1, expiresAt: 5_000, generation: 2 },
        { version: 1, executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', tokenDigest: 'new', mintedAt: 2, expiresAt: 5_000, generation: 4 }
      ] }));
      const store = createResumeGrantStore({ filePath, now: () => 1_000, token: () => 'replacement' });
      await expect(store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 4, expiresAt: 5_000 }))
        .resolves.toMatchObject({ generation: 5 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rejects malformed generation history and missing grant arrays as corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    try {
      for (const [name, state] of [
        ['bad-generation', { version: 1, revision: 0, grants: [], generations: [{ executionId: 'execution-1', projectId: 'project-1', generation: -1 }] }],
        ['missing-grants', { version: 1, revision: 0, generations: [] }]
      ] as const) {
        const filePath = join(dir, `${name}.json`);
        await writeFile(filePath, JSON.stringify(state));
        const store = createResumeGrantStore({ filePath, now: () => 1_000, token: () => 'token' });
        await expect(store.mint({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner' }))
          .rejects.toThrow('corrupt execution resume grant store');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('enforces exact expiry boundary and rejects stale or ahead recovery generations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    let clock = 1_000;
    let sequence = 0;
    try {
      const store = createResumeGrantStore({ filePath: join(dir, 'grants.json'), now: () => clock, token: () => `token-${++sequence}` });
      await expect(store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: -1 }))
        .rejects.toThrow('invalid execution recovery generation');
      await expect(store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 0, expiresAt: clock }))
        .rejects.toThrow('invalid execution resume grant expiry');
      const minted = await store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 0, expiresAt: clock + RESUME_GRANT_TTL_MS });
      clock += RESUME_GRANT_TTL_MS;
      await expect(store.consume({ token: minted.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement', generation: 1 }))
        .rejects.toThrow('not current');
      await expect(store.rotate({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner', expectedGeneration: 5, expiresAt: clock + 1 }))
        .rejects.toThrow('stale execution recovery generation');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('revokes only pending matching grants and preserves consumed bindings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    let sequence = 0;
    try {
      const store = createResumeGrantStore({ filePath: join(dir, 'grants.json'), now: () => 1_000, token: () => `token-${++sequence}` });
      const consumed = await store.mint({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner' });
      await store.consume({ token: consumed.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement' });
      const pending = await store.mint({ executionId: 'execution-2', projectId: 'project-1', callerPrincipalId: 'owner' });
      await store.revoke('execution-2', 'project-1');
      await expect(store.consume({ token: pending.token, executionId: 'execution-2', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement' })).rejects.toThrow('not current');
      await expect(store.consume({ token: consumed.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'replacement' })).resolves.toMatchObject({ outcome: 'recovered' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('revokes a consumed grant bound to an abandoned replacement owner', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    try {
      const store = createResumeGrantStore({ filePath: join(dir, 'grants.json'), now: () => 1_000, token: () => 'raw-token' });
      const grant = await store.mint({ executionId: 'execution-1', projectId: 'project-1', callerPrincipalId: 'owner' });
      await store.consume({ token: grant.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'abandoned-monitor' });
      await store.revokeBound('execution-1', 'project-1', 'abandoned-monitor');
      await expect(store.consume({ token: grant.token, executionId: 'execution-1', projectId: 'project-1', effectiveOwnerPrincipalId: 'abandoned-monitor' }))
        .rejects.toThrow('execution resume grant is not current');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('caps persisted grants at newest 2,000 records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-resume-grant-'));
    const filePath = join(dir, 'grants.json');
    try {
      const grants = Array.from({ length: 2_001 }, (_, index) => ({
        version: 1, executionId: `execution-${index}`, projectId: 'project-1', callerPrincipalId: 'owner',
        tokenDigest: `digest-${index}`, mintedAt: index, expiresAt: 5_000, generation: 0
      }));
      const generations = grants.map(({ executionId, projectId }) => ({ executionId, projectId, generation: 0 }));
      await writeFile(filePath, JSON.stringify({ version: 1, revision: 0, grants, generations }));
      const store = createResumeGrantStore({ filePath, now: () => 1_000, token: () => 'new-token' });
      await store.mint({ executionId: 'execution-new', projectId: 'project-1', callerPrincipalId: 'owner', expiresAt: 5_000 });
      const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { grants: Array<{ executionId: string }> };
      expect(persisted.grants).toHaveLength(2_000);
      expect(persisted.grants[0].executionId).toBe('execution-2');
      expect(persisted.grants.at(-1)?.executionId).toBe('execution-new');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
