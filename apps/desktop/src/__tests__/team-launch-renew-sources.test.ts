import { describe, expect, it, vi } from 'vitest';
import type { TeamJobLaunchResponse, TeamJobRenewedSources } from '@zana-ai/zcc-domain/product';
import { scopedSourceRenewal, withRenewedSources } from '../team-launch-support.js';

const sources: TeamJobRenewedSources = {
  renewed: [{ previousId: 'a', source: { id: 'b', name: 'n.md', byteSize: 1, expiresAt: 5 }, changed: false }],
  dropped: []
};
const setup = (reissue = vi.fn().mockResolvedValue(sources)) => ({ reissue, logError: vi.fn() });
const run = (launch: () => Promise<TeamJobLaunchResponse>, ids: string[], s = setup()) =>
  withRenewedSources(launch, ids, s.reissue, s.logError);

describe('scopedSourceRenewal', () => {
  it('binds re-issue and discard to one window and Project', async () => {
    const registry = { reissue: vi.fn().mockResolvedValue(sources), discardRetired: vi.fn() };
    const scoped = scopedSourceRenewal(registry, 7, 'p1');
    expect(await scoped.reissue(['a'])).toBe(sources);
    expect(registry.reissue).toHaveBeenCalledExactlyOnceWith({ windowId: 7, projectId: 'p1', capabilityIds: ['a'] });
    scoped.discardRetired(['a']);
    expect(registry.discardRetired).toHaveBeenCalledExactlyOnceWith({ windowId: 7, projectId: 'p1', capabilityIds: ['a'] });
  });
});

describe('withRenewedSources', () => {
  it('passes a success through without re-issuing', async () => {
    const s = setup();
    const ok: TeamJobLaunchResponse = { ok: true, value: { executionId: 'e', state: 'RUNNING' } };
    expect(await run(async () => ok, ['a'], s)).toBe(ok);
    expect(s.reissue).not.toHaveBeenCalled();
  });

  it('discards the retired records after a successful launch, only when ids were attached', async () => {
    const s = setup(); const discard = vi.fn();
    const ok: TeamJobLaunchResponse = { ok: true, value: { executionId: 'e', state: 'RUNNING' } };
    await withRenewedSources(async () => ok, ['a'], s.reissue, s.logError, discard);
    expect(discard).toHaveBeenCalledExactlyOnceWith(['a']);
    await withRenewedSources(async () => ok, [], s.reissue, s.logError, discard);
    await withRenewedSources(async () => ({ ok: false, code: 'X', message: 'm' }), ['a'], s.reissue, s.logError, discard);
    expect(discard).toHaveBeenCalledOnce();
  });

  it('passes a failure through when no ids were given', async () => {
    const s = setup();
    const fail: TeamJobLaunchResponse = { ok: false, code: 'X', message: 'm' };
    expect(await run(async () => fail, [], s)).toBe(fail);
    expect(s.reissue).not.toHaveBeenCalled();
  });

  it('adds sources to a plain failure', async () => {
    expect(await run(async () => ({ ok: false, code: 'X', message: 'm' }), ['a'])).toEqual({ ok: false, code: 'X', message: 'm', sources });
  });

  it('keeps requirementFailure and adds sources', async () => {
    const requirementFailure = { workUnits: [] };
    expect(await run(async () => ({ ok: false, code: 'REQUIREMENT_UNAVAILABLE', message: 'm', requirementFailure }), ['a']))
      .toMatchObject({ code: 'REQUIREMENT_UNAVAILABLE', requirementFailure, sources });
  });

  it('keeps availabilityUnknown and adds sources', async () => {
    const availabilityUnknown = { failedSources: ['skills' as const] };
    expect(await run(async () => ({ ok: false, code: 'CAPABILITY_AVAILABILITY_UNKNOWN', message: 'm', availabilityUnknown }), ['a']))
      .toMatchObject({ code: 'CAPABILITY_AVAILABILITY_UNKNOWN', availabilityUnknown, sources });
  });

  it('turns a throwing launch with ids into LAUNCH_FAILED with sources and logs once', async () => {
    const s = setup(); const error = new Error('boom');
    expect(await run(async () => { throw error; }, ['a'], s)).toEqual({ ok: false, code: 'LAUNCH_FAILED', message: 'boom', sources });
    expect(s.logError).toHaveBeenCalledOnce();
    expect(s.logError).toHaveBeenCalledWith('team-job-launch', error);
  });

  it('stringifies a non-Error throw', async () => {
    expect(await run(async () => { throw 'plain'; }, ['a'])).toMatchObject({ code: 'LAUNCH_FAILED', message: 'plain' });
  });

  it('rethrows a throwing launch when no ids were given', async () => {
    const s = setup();
    await expect(run(async () => { throw new Error('boom'); }, [], s)).rejects.toThrow('boom');
    expect(s.reissue).not.toHaveBeenCalled();
    expect(s.logError).not.toHaveBeenCalled();
  });

  it('returns the failure without sources when reissue throws, logging once', async () => {
    const error = new Error('nope');
    const s = setup(vi.fn().mockRejectedValue(error));
    const result = await run(async () => ({ ok: false, code: 'X', message: 'm' }), ['a'], s);
    expect(result).toEqual({ ok: false, code: 'X', message: 'm' });
    expect(s.logError).toHaveBeenCalledOnce();
    expect(s.logError).toHaveBeenCalledWith('team-job-renew-sources', error);
  });

  it('gives reissue a copy of the ids', async () => {
    const s = setup(); const ids = ['a', 'b'];
    await run(async () => ({ ok: false, code: 'X', message: 'm' }), ids, s);
    const passed = s.reissue.mock.calls[0][0];
    expect(passed).toEqual(ids);
    expect(passed).not.toBe(ids);
  });

  it('does not re-issue ids while another launch with the same ids is still running', async () => {
    const s = setup(); let finish!: (r: TeamJobLaunchResponse) => void;
    const first = run(() => new Promise<TeamJobLaunchResponse>((resolve) => { finish = resolve; }), ['x'], s);
    const second = await run(async () => ({ ok: false, code: 'REPLAYED_CAPABILITY', message: 'used' }), ['x'], s);
    expect(second).toEqual({ ok: false, code: 'REPLAYED_CAPABILITY', message: 'used' });
    expect(s.reissue).not.toHaveBeenCalled();
    finish({ ok: false, code: 'X', message: 'm' });
    // contested: the second launch may have consumed them, so the first renews nothing either
    expect(await first).toEqual({ ok: false, code: 'X', message: 'm' });
    expect(s.reissue).not.toHaveBeenCalled();
    // released: the same ids may be renewed again afterwards
    expect(await run(async () => ({ ok: false, code: 'X', message: 'm' }), ['x'], s)).toMatchObject({ sources });
  });

  it('renews a launch that was never overlapped, even after an unrelated overlap ended', async () => {
    const s = setup(); let finish!: (r: TeamJobLaunchResponse) => void;
    const first = run(() => new Promise<TeamJobLaunchResponse>((resolve) => { finish = resolve; }), ['p'], s);
    await run(async () => ({ ok: false, code: 'X', message: 'm' }), ['q'], s);
    finish({ ok: false, code: 'X', message: 'm' });
    expect(await first).toMatchObject({ sources });
  });

  it('discards the retired records when an overlapping launch succeeds', async () => {
    const s = setup(); const discard = vi.fn(); let finish!: (r: TeamJobLaunchResponse) => void;
    const ok: TeamJobLaunchResponse = { ok: true, value: { executionId: 'e', state: 'RUNNING' } };
    const first = withRenewedSources(() => new Promise<TeamJobLaunchResponse>((resolve) => { finish = resolve; }), ['w'], s.reissue, s.logError, discard);
    expect(await withRenewedSources(async () => ok, ['w'], s.reissue, s.logError, discard)).toBe(ok);
    expect(discard).toHaveBeenCalledExactlyOnceWith(['w']);
    finish({ ok: false, code: 'REPLAYED_CAPABILITY', message: 'used' });
    expect(await first).toEqual({ ok: false, code: 'REPLAYED_CAPABILITY', message: 'used' });
    expect(s.reissue).not.toHaveBeenCalled();
  });

  it('releases the in-flight ids when the launch throws', async () => {
    const s = setup();
    await run(async () => { throw new Error('boom'); }, ['y'], s);
    expect(await run(async () => ({ ok: false, code: 'X', message: 'm' }), ['y'], s)).toMatchObject({ sources });
  });

  it('keeps a successful launch successful when discarding throws', async () => {
    const s = setup(); const ok: TeamJobLaunchResponse = { ok: true, value: { executionId: 'e', state: 'RUNNING' } };
    const error = new Error('disk');
    expect(await withRenewedSources(async () => ok, ['z'], s.reissue, s.logError, () => { throw error; })).toBe(ok);
    expect(s.logError).toHaveBeenCalledWith('team-job-discard-sources', error);
  });
});
