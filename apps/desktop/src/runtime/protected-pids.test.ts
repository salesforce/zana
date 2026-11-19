import { describe, expect, it } from 'vitest';
import { exportProtectedPid } from './runtime-supervisor.js';

describe('desktop protected PIDs', () => {
  it('accumulates PIDs in the env list children inherit, without duplicates', () => {
    const env: NodeJS.ProcessEnv = {};
    exportProtectedPid(10, env);
    exportProtectedPid(20, env);
    exportProtectedPid(10, env);
    expect(env.ZANA_PROTECTED_PIDS).toBe('10,20');
  });
});
