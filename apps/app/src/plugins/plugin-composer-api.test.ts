import { afterEach, describe, expect, it } from 'vitest';
import { sanitizeExtraArgs } from '@zana-ai/zcc-domain/launch-sanitize';
import {
  clearLaunchPatches,
  getMergedLaunchPatch,
  mergeExtraArgs,
  mergeLaunchPatches,
  setPluginLaunchPatch
} from './plugin-composer-api.js';

afterEach(() => {
  clearLaunchPatches();
});

describe('plugin composer launch patches', () => {
  it('concatenates extra args; host sanitization then strips denied flags', () => {
    const merged = mergeExtraArgs(['--verbose'], ['--dangerously-skip-permissions', '--plugin-dir', '/tmp']);
    expect(merged).toEqual(['--verbose', '--dangerously-skip-permissions', '--plugin-dir', '/tmp']);
    expect(sanitizeExtraArgs(merged).args).toEqual(['--verbose', '--plugin-dir', '/tmp']);
  });

  it('lets a later plugin profileId win', () => {
    expect(mergeLaunchPatches([
      { extraArgs: ['--verbose'] },
      { profileId: 'codex-yolo' }
    ])).toEqual({
      extraArgs: ['--verbose'],
      profileId: 'codex-yolo'
    });
  });

  it('keeps getMergedLaunchPatch referentially stable until a patch changes', () => {
    const first = getMergedLaunchPatch();
    expect(getMergedLaunchPatch()).toBe(first);
    setPluginLaunchPatch('harness-claude', { extraArgs: ['--verbose'] });
    const next = getMergedLaunchPatch();
    expect(next).not.toBe(first);
    expect(next.extraArgs).toEqual(['--verbose']);
    expect(getMergedLaunchPatch()).toBe(next);
  });
});
