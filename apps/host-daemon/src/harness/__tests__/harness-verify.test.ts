import { describe, expect, it } from 'vitest';
import { harnessEnabledFromProbe } from '../harness-verify.js';

describe('harnessEnabledFromProbe', () => {
  it('keeps always-on families available regardless of install or config', () => {
    expect(harnessEnabledFromProbe({ alwaysEnabled: true, installed: false })).toBe(true);
    expect(harnessEnabledFromProbe({ alwaysEnabled: true, configEnabled: false, installed: true })).toBe(true);
  });

  it('auto-activates an installed CLI when the enable flag is unset', () => {
    expect(harnessEnabledFromProbe({ installed: true })).toBe(true);
    expect(harnessEnabledFromProbe({ configEnabled: undefined, installed: true })).toBe(true);
  });

  it('does not advertise a missing CLI until the operator opts in', () => {
    expect(harnessEnabledFromProbe({ installed: false })).toBe(false);
    expect(harnessEnabledFromProbe({ configEnabled: true, installed: false })).toBe(true);
  });

  it('respects an explicit hide even when the CLI is present', () => {
    expect(harnessEnabledFromProbe({ configEnabled: false, installed: true })).toBe(false);
  });
});
