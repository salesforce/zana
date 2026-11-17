import { describe, expect, it, vi } from 'vitest';
import { createTeamProductOps } from '../team-product-ops.js';
import { SquadPreviewAdmissionError } from '../squad-proposals/service.js';

// REQ-4, REQ-5: a CLI launch preview returns the specific plan error and keeps every other failure generic.
const baseDeps = { startTeamJobFromUi: vi.fn(), getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn() };
const input = { teamId: 't', projectId: 'p', goal: 'go', mode: 'structured' as const };
const GENERIC = 'Launch preview could not validate the plan or target.';

describe('team preview admission errors (REQ-4)', () => {
  it('returns INVALID with the plan error text from a SquadPreviewAdmissionError', async () => {
    const ops = createTeamProductOps({ ...baseDeps, resolvePreview: async () => { throw new SquadPreviewAdmissionError('no portable plan steps found'); } });
    expect(await ops.preview!(input)).toEqual({ ok: false, code: 'INVALID', message: 'no portable plan steps found' });
  });

  it('does not log the admission error as an unexpected failure with its text', async () => {
    const logError = vi.fn();
    const ops = createTeamProductOps({ ...baseDeps, logError, resolvePreview: async () => { throw new SquadPreviewAdmissionError('plan step 2 depends on a missing step'); } });
    const result = await ops.preview!(input);
    expect(result).toMatchObject({ ok: false, message: 'plan step 2 depends on a missing step' });
    expect(logError).not.toHaveBeenCalled();
  });

  it('A12: bounds and cleans an admission message before it leaves main', async () => {
    const long = `${'x'.repeat(5000)}\u0000 at /Users/alice/private/plan.md`;
    const ops = createTeamProductOps({ ...baseDeps, resolvePreview: async () => { throw new SquadPreviewAdmissionError(long); } });
    const result = await ops.preview!(input);
    expect(result.ok ? '' : result.message.length).toBeLessThanOrEqual(2048);
    expect(result.ok ? '' : result.message).not.toMatch(/\u0000/);
  });
});

describe('other preview failures stay generic (REQ-5)', () => {
  it.each([
    ['a filesystem error with a path', Object.assign(new Error("ENOENT: no such file or directory, open '/Users/alice/secret/plan.md'"), { code: 'ENOENT' })],
    ['an internal path', new Error('/private/internal')],
    ['a declarations reason', new Error('launch section: unknown key')],
    ['a plain string', 'boom']
  ])('hides %s', async (_label, thrown) => {
    const logError = vi.fn();
    const ops = createTeamProductOps({ ...baseDeps, logError, resolvePreview: async () => { throw thrown; } });
    const result = await ops.preview!(input);
    expect(result).toEqual({ ok: false, code: 'INVALID', message: GENERIC });
    expect(logError).toHaveBeenCalledWith('team preview project=p team=t', thrown);
  });

  it('still reports UNAVAILABLE with no resolver and passes a good preview through (existing-user path)', async () => {
    expect(await createTeamProductOps(baseDeps).preview!(input)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    const ok = await createTeamProductOps({ ...baseDeps, resolvePreview: async () => ({ previewToken: 'tok' } as never) }).preview!(input);
    expect(ok).toMatchObject({ ok: true, value: { previewToken: 'tok' } });
  });
});

// REQ-2: the Inbox squad report shows the failure reason, also for a run with no units.
import { buildSquadReport } from '../squad-proposals/report.js';

describe('squad report shows the failure reason (REQ-2)', () => {
  const failedRecord = (over: Record<string, unknown> = {}) => ({
    id: 'ex-1', state: 'FAILED', jobTitle: 'Ship', createdAt: 0, updatedAt: 60_000, workUnits: [], request: { slots: [] },
    ...over
  }) as never;

  it('uses the failure reason instead of "Summary: none" for a 0-unit failed run', () => {
    const text = buildSquadReport(failedRecord({ failureReason: 'worker w2 could not start: unknown persona' }));
    expect(text).toContain('worker w2 could not start: unknown persona');
    expect(text).not.toContain('Summary: none');
  });

  it('keeps the summary when there is no failure reason (existing-user path)', () => {
    const text = buildSquadReport(failedRecord({ finalSummary: 'all good' }));
    expect(text).toContain('Summary: all good');
  });
});
