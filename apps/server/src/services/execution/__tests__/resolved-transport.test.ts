import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore } from '../store.js';

const CONTEXT = {
  version: 1 as const, principalId: 'o', authorizedAt: 1, expiresAt: 2,
  slots: [{ slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'o' }]
};

async function withStore(run: (store: ReturnType<typeof createExecutionStore>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-resolved-transport-'));
  try { await run(createExecutionStore({ filePath: join(dir, 'executions.json') })); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function started(store: ReturnType<typeof createExecutionStore>, launchRequestId: string) {
  let record = (await store.claim({
    callerPrincipalId: 's', projectId: 'p', teamId: 't', jobTitle: 'j', requestDigest: 'd', launchRequestId, resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'x' }], resolvedModels: [] }
  })).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  return store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
}

describe('execution record resolvedTransport', () => {
  it('stores a valid pin with the authorization context', async () => {
    await withStore(async (store) => {
      const record = await started(store, 'r1');
      const next = await store.setAuthorizationContext(record.id, record.stateVersion, CONTEXT, 'digest', { transport: 'MODERN', source: 'caller' });
      expect(next.resolvedTransport).toEqual({ transport: 'MODERN', source: 'caller' });
      expect((await store.get(record.id))?.resolvedTransport?.transport).toBe('MODERN');
    });
  });

  it('keeps the fallback reason', async () => {
    await withStore(async (store) => {
      const record = await started(store, 'r2');
      const next = await store.setAuthorizationContext(record.id, record.stateVersion, CONTEXT, 'digest',
        { transport: 'CLI', source: 'fallback-squad-mode', fallbackReason: 'Modern Squads need a local Project' });
      expect(next.resolvedTransport?.fallbackReason).toContain('local Project');
    });
  });

  it('drops an invalid pin instead of persisting it', async () => {
    await withStore(async (store) => {
      const record = await started(store, 'r3');
      const next = await store.setAuthorizationContext(record.id, record.stateVersion, CONTEXT, 'digest', { transport: 'BOGUS', source: 'nope' } as never);
      expect(next.resolvedTransport).toBeUndefined();
    });
  });

  it('leaves legacy records without a pin', async () => {
    await withStore(async (store) => {
      const record = await started(store, 'r4');
      const next = await store.setAuthorizationContext(record.id, record.stateVersion, CONTEXT, 'digest');
      expect(next.resolvedTransport).toBeUndefined();
    });
  });
});
