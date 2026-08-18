import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionHandoffStore, EXECUTION_HANDOFF_OPERATION, EXECUTION_RESUME_MONITOR_OPERATION } from '../execution/handoff-store.js';

describe('execution handoff store', () => {
  it('durably mints a target-bound opaque capability and consumes it once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-'));
    try {
      let now = 10;
      const filePath = join(dir, 'handoffs.json');
      const store = createExecutionHandoffStore({ filePath, now: () => now, id: () => 'grant-1', token: () => 'opaque-token' });
      const minted = await store.mint({ sourceOwnerSessionId: 'source', targetSessionId: 'target', projectId: 'project', executionId: 'execution', operations: [EXECUTION_HANDOFF_OPERATION], expiresAt: 20 });
      expect(minted).toEqual({ token: 'opaque-token', expiresAt: 20 });
      expect(await store.consume({ token: minted.token, targetSessionId: 'target', projectId: 'project', executionId: 'execution', operation: EXECUTION_HANDOFF_OPERATION })).toMatchObject({ id: 'grant-1', sourceOwnerSessionId: 'source', usedAt: 10 });
      await expect(store.consume({ token: minted.token, targetSessionId: 'target', projectId: 'project', executionId: 'execution', operation: EXECUTION_HANDOFF_OPERATION })).rejects.toThrow('not current');
      expect(await readFile(filePath, 'utf8')).not.toContain('opaque-token');
      now = 21;
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rejects wrong target and expired capabilities without consuming them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-'));
    try {
      let now = 10;
      const store = createExecutionHandoffStore({ filePath: join(dir, 'handoffs.json'), now: () => now, token: () => 'token' });
      await store.mint({ sourceOwnerSessionId: 'source', targetSessionId: 'target', projectId: 'project', executionId: 'execution', operations: [EXECUTION_HANDOFF_OPERATION], expiresAt: 20 });
      await expect(store.consume({ token: 'token', targetSessionId: 'other', projectId: 'project', executionId: 'execution', operation: EXECUTION_HANDOFF_OPERATION })).rejects.toThrow('not current');
      now = 20;
      await expect(store.consume({ token: 'token', targetSessionId: 'target', projectId: 'project', executionId: 'execution', operation: EXECUTION_HANDOFF_OPERATION })).rejects.toThrow('not current');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('keeps a grant usable after restart only for its exact project and execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-'));
    try {
      const filePath = join(dir, 'handoffs.json');
      const input = {
        sourceOwnerSessionId: 'source', targetSessionId: 'target', projectId: 'project', executionId: 'execution',
        operations: [EXECUTION_HANDOFF_OPERATION], expiresAt: 20
      };
      const original = createExecutionHandoffStore({ filePath, now: () => 10, token: () => 'token' });
      await original.mint(input);
      const restarted = createExecutionHandoffStore({ filePath, now: () => 10 });
      await expect(restarted.consume({ token: 'token', targetSessionId: 'target', projectId: 'other-project', executionId: 'execution', operation: EXECUTION_HANDOFF_OPERATION })).rejects.toThrow('not current');
      await expect(restarted.consume({ token: 'token', targetSessionId: 'target', projectId: 'project', executionId: 'other-execution', operation: EXECUTION_HANDOFF_OPERATION })).rejects.toThrow('not current');
      await expect(restarted.consume({ token: 'token', targetSessionId: 'target', projectId: 'project', executionId: 'execution', operation: EXECUTION_HANDOFF_OPERATION })).resolves.toMatchObject({ sourceOwnerSessionId: 'source' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('allows target-bound monitor reads until expiry without consuming the capability', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-handoff-'));
    try {
      let now = 10;
      const store = createExecutionHandoffStore({ filePath: join(dir, 'handoffs.json'), now: () => now, token: () => 'monitor' });
      await store.mint({ sourceOwnerSessionId: 'source', targetSessionId: 'target', projectId: 'project', executionId: 'execution', operations: [EXECUTION_RESUME_MONITOR_OPERATION], kind: 'monitor', expiresAt: 20 });
      await expect(store.inspect({ token: 'monitor', targetSessionId: 'target', projectId: 'project', executionId: 'execution', operation: EXECUTION_RESUME_MONITOR_OPERATION })).resolves.toMatchObject({ sourceOwnerSessionId: 'source' });
      await expect(store.inspect({ token: 'monitor', targetSessionId: 'target', projectId: 'project', executionId: 'execution', operation: EXECUTION_RESUME_MONITOR_OPERATION })).resolves.toMatchObject({ sourceOwnerSessionId: 'source' });
      now = 20;
      await expect(store.inspect({ token: 'monitor', targetSessionId: 'target', projectId: 'project', executionId: 'execution', operation: EXECUTION_RESUME_MONITOR_OPERATION })).rejects.toThrow('not current');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
