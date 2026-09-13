import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { rejectIsolatedCliAgent } from '../src/cli-agents.js';

describe('isolated CLI Agent', () => {
  it('is a follow-on until host-rpc harness.start exists', () => {
    expect(() => rejectIsolatedCliAgent(true)).toThrow(ControlError);
    try {
      rejectIsolatedCliAgent(true);
    } catch (error) {
      expect(error).toBeInstanceOf(ControlError);
      expect((error as ControlError).code).toBe('ISOLATED_CLI_AGENT');
      expect((error as ControlError).message).toMatch(/many sessions on one desktop/);
    }
  });
});
