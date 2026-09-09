import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionConsentStore } from '../execution-consent-store.js';
import { ExecutionConsentService } from '../execution-consent.js';
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
  it('auto-grants project scope for interactive launches without a dialog', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath, id: () => 'grant-1' });
    const service = new ExecutionConsentService({ store });
    expect(await service.request({
      adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed',
      projectId: 'p1', launchScope: 'local', mode: 'interactive'
    })).toMatchObject({ decision: 'granted', grant: { id: 'grant-1', scope: 'project', projectId: 'p1' } });
    expect((await store.list()).grants).toEqual([expect.objectContaining({ id: 'grant-1', scope: 'project' })]);
  }));

  it('cannot mint grants in headless or unattended modes', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath });
    const service = new ExecutionConsentService({ store });
    for (const mode of ['headless', 'unattended'] as const) {
      expect((await service.request({
        adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed',
        projectId: 'p1', launchScope: 'local', mode
      })).decision).toBe('denied');
    }
    expect((await store.list()).grants).toEqual([]);
  }));

  it('does not upgrade unattended access from a stored interactive snapshot', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath });
    const service = new ExecutionConsentService({ store });
    await service.request({
      adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed',
      projectId: 'p1', launchScope: 'local', mode: 'interactive'
    });
    expect(await service.findGrant({
      adapterId: 'codex', target, targetDigest: 'td', evidenceDigest: 'ed',
      projectId: 'p1', launchScope: 'local', scope: 'project', mode: 'unattended'
    })).toEqual({ decision: 'denied', reason: 'target disallows unattended execution' });
  }));
});
