import { readFileSync } from 'node:fs';
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

  it('exports the desktop and every forked child before the next fork', () => {
    const source = readFileSync(new URL('./runtime-supervisor.ts', import.meta.url), 'utf8');
    expect(source).toContain('exportProtectedPid(process.pid)');
    expect(source).toContain('if (child.pid) exportProtectedPid(child.pid)');
    expect(source).toContain("TREE_KILL_AUDIT_ENV] = join(auditDir, 'logs', 'tree-kill.log')");
  });
});
