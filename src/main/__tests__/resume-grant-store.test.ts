import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResumeGrantStore, isResumeGrantTerminal } from '../execution/resume-grant-store.js';

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
});
