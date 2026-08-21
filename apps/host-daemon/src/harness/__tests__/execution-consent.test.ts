import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionConsentStore } from '../execution-consent-store.js';
import { ExecutionConsentService, type ExecutionConsentDialogRequest } from '../execution-consent.js';
import type { HarnessExecutionTarget } from '@zana-ai/zcc-domain/harness-adapter';

const target: HarnessExecutionTarget = {
  id: 'codex.execution.accept-edits', state: 'accept-edits', equivalence: 'closest',
  effect: 'Edits workspace files after model approval.',
  materialDifference: 'Native policy may approve broader operations.', risk: 'high',
  evidence: { id: 'codex.execution.accept-edits', version: 1 }, evidenceStatus: 'candidate',
  scopes: ['local'], profilePostures: ['default'], unattendedAllowed: false, consent: 'required'
};

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-ceremony-'));
  try { await run(join(dir, 'consent.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

describe('execution consent ceremony', () => {
  it('creates a grant only from trusted dialog approval and cancellation creates none', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath, id: () => 'grant-1' });
    const cancel = new ExecutionConsentService({ store, showDialog: async () => ({ decision: 'cancel' }) });
    expect(await cancel.request({ adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed', projectId: 'p1', launchScope: 'local', mode: 'interactive' })).toEqual({ decision: 'denied', reason: 'user cancelled' });
    expect(await store.list()).toEqual({ grants: [], reservations: [] });
    const approve = new ExecutionConsentService({ store, showDialog: async () => ({ decision: 'approve', scope: 'project' }) });
    expect(await approve.request({ adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed', projectId: 'p1', launchScope: 'local', mode: 'interactive' })).toMatchObject({ decision: 'granted', grant: { scope: 'project' } });
  }));

  it('cannot mint grants in headless or unattended modes', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath });
    const showDialog = vi.fn(async () => ({ decision: 'approve' as const, scope: 'project' as const }));
    const service = new ExecutionConsentService({ store, showDialog });
    for (const mode of ['headless', 'unattended'] as const) {
      expect((await service.request({ adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed', projectId: 'p1', launchScope: 'local', mode })).decision).toBe('denied');
    }
    expect(showDialog).not.toHaveBeenCalled();
    expect((await store.list()).grants).toEqual([]);
  }));

  it('does not upgrade unattended access from a stored interactive snapshot', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath });
    const service = new ExecutionConsentService({ store, showDialog: async () => ({ decision: 'approve', scope: 'project' }) });
    await service.request({ adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed', projectId: 'p1', launchScope: 'local', mode: 'interactive' });
    expect(await service.findGrant({ adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed', projectId: 'p1', launchScope: 'local', scope: 'project', mode: 'unattended' })).toEqual({ decision: 'denied', reason: 'target disallows unattended execution' });
  }));

  it('shows effect, difference, risk, evidence, and scope in dialog text', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath });
    const showDialog = vi.fn(async (_request: ExecutionConsentDialogRequest) => ({ decision: 'cancel' as const }));
    const service = new ExecutionConsentService({ store, showDialog });
    await service.request({ adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'evidence-digest', projectId: 'p1', launchScope: 'local', mode: 'interactive' });
    const call = showDialog.mock.calls[0];
    expect(call).toBeDefined();
    const text = call![0].text;
    expect(text).toContain(target.effect);
    expect(text).toContain('codex');
    expect(text).toContain(target.id);
    expect(text).toContain('p1');
    expect(text).toContain(target.materialDifference);
    expect(text).toContain(target.risk);
    expect(text).toContain('evidence-digest');
    expect(text).toContain('one launch');
    expect(text).toContain('project');
    expect(text).not.toContain('global');
  }));

  it('rejects unsupported scope returned by a malformed dialog implementation', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath });
    const service = new ExecutionConsentService({
      store,
      showDialog: async () => ({ decision: 'approve', scope: 'global' } as never)
    });
    await expect(service.request({
      adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed', projectId: 'p1', launchScope: 'local', mode: 'interactive'
    })).resolves.toEqual({ decision: 'denied', reason: 'unsupported consent scope' });
    expect((await store.list()).grants).toEqual([]);
  }));
});
