import { describe, expect, it } from 'vitest';
import { evaluateTeamAdmission, type SlotRoute } from '../preflight.js';

const plan = (mcpServers?: string[]) => [{
  id: 'a', title: 'A', task: 'do', dependencies: [], files: ['a.ts'], verification: ['t'],
  ...(mcpServers ? { requires: { mcpServers } } : {})
}];
const slot = (slotId: string, mcpServers?: readonly string[]): SlotRoute => ({ slotId, personaId: slotId, ...(mcpServers ? { mcpServers } : {}) });
const admit = (slotRoutes: SlotRoute[], required: string[] = ['github']) => evaluateTeamAdmission({
  workUnits: plan(required), requireCompletePlan: true, slotCount: slotRoutes.length, maxSlots: 8, initialTasks: ['x'], slotRoutes, now: 1,
  inventory: { version: 1, observedAt: 1, maxAgeMs: 10, skills: [], mcpServers: ['github', 'a', 'b'].map((name) => ({ name, available: true })), models: [], providers: [] }
});
const mcpChecks = (r: ReturnType<typeof admit>) => r.checks.filter((c) => c.code === 'MCP_AVAILABLE' && c.subject === 'a' && c.message.includes('worker'));

describe('persona MCP allowlist reach in admission (D10 twin)', () => {
  it('unrestricted slots add no reach check', () => {
    expect(mcpChecks(admit([slot('w1'), slot('w2')]))).toHaveLength(0);
  });

  it('FAILs naming the gap when no worker slot allows a required server', () => {
    const r = admit([slot('w1', ['zcc-inbox']), slot('w2', ['other']), slot('orchestrator:0')]);
    expect(r.ready).toBe(false);
    expect(mcpChecks(r).find((c) => c.status === 'FAIL')).toMatchObject({ required: true, unavailable: ['github'] });
  });

  it('an orchestrator-only allowance does not count', () => {
    expect(admit([slot('w1', ['zcc-inbox']), slot('orchestrator:0', ['zcc-inbox', 'github'])]).ready).toBe(false);
  });

  it('warns non-required when only some worker slots reach the server', () => {
    const r = admit([slot('w1', ['github']), slot('w2', ['zcc-inbox'])]);
    expect(r.ready).toBe(true);
    expect(mcpChecks(r).find((c) => c.status === 'UNKNOWN')).toMatchObject({ required: false, message: expect.stringContaining('1 of 2') });
  });

  it('plugin:/ext: scoped entries reach by trailing name', () => {
    expect(mcpChecks(admit([slot('w1', ['plugin:acme:github'])])).filter((c) => c.status === 'FAIL')).toHaveLength(0);
    expect(mcpChecks(admit([slot('w1', ['ext:acme:github'])])).filter((c) => c.status === 'FAIL')).toHaveLength(0);
  });

  it('FAILs when each server is reachable but no single slot covers them all', () => {
    const r = admit([slot('w1', ['a']), slot('w2', ['b'])], ['a', 'b']);
    expect(r.ready).toBe(false);
    expect(mcpChecks(r).find((c) => c.status === 'FAIL')).toMatchObject({ unavailable: ['a', 'b'], message: expect.stringContaining('no single worker slot') });
  });

  it('one slot covering all required servers passes', () => {
    expect(mcpChecks(admit([slot('w1', ['a', 'b']), slot('w2', ['a', 'b'])], ['a', 'b'])).filter((c) => c.status === 'FAIL')).toHaveLength(0);
  });

  it('units without requires.mcpServers are untouched', () => {
    expect(mcpChecks(admit([slot('w1', ['zcc-inbox'])], []))).toHaveLength(0);
  });

  it('mcpServers is bound into the digest, order-insensitive', () => {
    const a = admit([slot('w1', ['b', 'a'])], []);
    expect(admit([slot('w1', ['a', 'b'])], []).digest).toBe(a.digest);
    expect(admit([slot('w1', ['a'])], []).digest).not.toBe(a.digest);
    expect(admit([slot('w1')], []).digest).not.toBe(a.digest);
  });
});
