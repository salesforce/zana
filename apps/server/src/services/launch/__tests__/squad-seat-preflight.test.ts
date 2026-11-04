import { describe, expect, it } from 'vitest';
import type { SquadSeatCapability } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { checkSquadSeats, type SquadSeatCheckSeat } from '../squad-seat-preflight.js';

/** Acceptance tests for the whole-team seat preflight (#675, D6), written before the implementation. */

const CLAUDE: SquadSeatCapability = { instructions: true, commandDeny: 'native', executionTools: true, foldPersonaIntoGuidance: false };
const CODEX_UNPROVEN: SquadSeatCapability = { instructions: true, commandDeny: 'none', executionTools: true, foldPersonaIntoGuidance: true };
const OPENCODE: SquadSeatCapability = { instructions: true, commandDeny: 'shim', executionTools: true, foldPersonaIntoGuidance: false };
const NOTHING: SquadSeatCapability = { instructions: false, commandDeny: 'none', executionTools: false, foldPersonaIntoGuidance: false };

function seat(over: Partial<SquadSeatCheckSeat> & { slotId: string }): SquadSeatCheckSeat {
  return { label: over.slotId, harnessLabel: 'Claude Code', capability: CLAUDE, hasInstructions: false, hasShimmableDenies: false, ...over };
}
const run = (seats: SquadSeatCheckSeat[], over: Partial<Parameters<typeof checkSquadSeats>[0]> = {}) =>
  checkSquadSeats({ seats, coordinationMode: 'job-team', remoteProject: false, platform: 'darwin', ...over });

describe('checkSquadSeats', () => {
  it('accepts an all-Claude team (REQ-7)', () => {
    expect(run([seat({ slotId: 'a', hasInstructions: true, hasShimmableDenies: true }), seat({ slotId: 'b' })])).toEqual({ ok: true });
  });

  it('accepts a Codex or OpenCode seat with neither instructions nor denies (REQ-13)', () => {
    expect(run([seat({ slotId: 'a', capability: CODEX_UNPROVEN, harnessLabel: 'Codex' }), seat({ slotId: 'b', capability: OPENCODE })])).toEqual({ ok: true });
  });

  it('accepts a team with no seats', () => {
    expect(run([])).toEqual({ ok: true });
  });

  it.each(['job-team', 'structured', 'freeform'])('refuses a seat that cannot reach the execution tools on %s coordination (REQ-5)', (mode) => {
    const result = run([seat({ slotId: 'w1', label: 'Reviewer', harnessLabel: 'Cursor', capability: NOTHING })], { coordinationMode: mode });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusedSlotIds).toEqual(['w1']);
    expect(result.message).toContain('Reviewer');
    expect(result.message).toContain('Cursor');
    expect(result.message).toMatch(/execution tools/i);
  });

  it('refuses a seat with no declared capability as having nothing (REQ-5)', () => {
    const result = run([seat({ slotId: 'g', harnessLabel: 'Grok', capability: undefined })]);
    expect(result.ok).toBe(false);
  });

  it('keeps a non-durable launch on a harness without execution tools working (REQ-16)', () => {
    expect(run([seat({ slotId: 'a', harnessLabel: 'Shell', capability: NOTHING })], { coordinationMode: 'interactive-team' })).toEqual({ ok: true });
    expect(run([seat({ slotId: 'a', harnessLabel: 'Shell', capability: NOTHING })], { coordinationMode: undefined })).toEqual({ ok: true });
  });

  it('refuses persona instructions on a harness that cannot carry them, even when non-durable (REQ-6)', () => {
    const cap = { ...NOTHING, executionTools: true };
    const result = run([seat({ slotId: 'a', label: 'Lead', harnessLabel: 'Pi', capability: cap, hasInstructions: true })], { coordinationMode: 'interactive-team' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/instructions/i);
  });

  it('refuses shimmable denies when the harness denylist is unproven (REQ-6)', () => {
    const result = run([seat({ slotId: 'a', label: 'Dev', harnessLabel: 'Codex', capability: CODEX_UNPROVEN, hasShimmableDenies: true })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusedSlotIds).toEqual(['a']);
      expect(result.message).toContain('Dev');
      expect(result.message).toContain('Codex');
    }
  });

  it('accepts shimmable denies on a harness whose shim is proven (REQ-3)', () => {
    expect(run([seat({ slotId: 'a', capability: OPENCODE, hasShimmableDenies: true })])).toEqual({ ok: true });
  });

  it('refuses a shim seat on a remote project (REQ-6)', () => {
    const result = run([seat({ slotId: 'a', harnessLabel: 'OpenCode', capability: OPENCODE, hasShimmableDenies: true })], { remoteProject: true });
    expect(result.ok).toBe(false);
  });

  it('refuses a shim seat on Windows (REQ-6)', () => {
    const result = run([seat({ slotId: 'a', harnessLabel: 'OpenCode', capability: OPENCODE, hasShimmableDenies: true })], { platform: 'win32' });
    expect(result.ok).toBe(false);
  });

  it('does not refuse a remote or Windows seat that needs no shim', () => {
    expect(run([seat({ slotId: 'a', capability: OPENCODE })], { remoteProject: true, platform: 'win32' })).toEqual({ ok: true });
    expect(run([seat({ slotId: 'a', capability: CLAUDE, hasShimmableDenies: true })], { remoteProject: true, platform: 'win32' })).toEqual({ ok: true });
  });

  it('refuses instructions on a harness that delivers no guidance remotely (REQ-6)', () => {
    const codex: SquadSeatCapability = { ...CODEX_UNPROVEN };
    const result = run([seat({ slotId: 'a', harnessLabel: 'Codex', capability: codex, hasInstructions: true, remoteGuidanceUnavailable: true })], { remoteProject: true });
    expect(result.ok).toBe(false);
    expect(run([seat({ slotId: 'a', harnessLabel: 'Codex', capability: codex, hasInstructions: true, remoteGuidanceUnavailable: true })])).toEqual({ ok: true });
  });

  it('names every refused seat in one message and lists their ids (REQ-6)', () => {
    const result = run([
      seat({ slotId: 'ok', label: 'Fine' }),
      seat({ slotId: 'c', label: 'Cursor Dev', harnessLabel: 'Cursor', capability: NOTHING }),
      seat({ slotId: 'g', label: 'Grok Dev', harnessLabel: 'Grok', capability: NOTHING }),
      seat({ slotId: 'x', label: 'Codex Dev', harnessLabel: 'Codex', capability: CODEX_UNPROVEN, hasShimmableDenies: true })
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusedSlotIds).toEqual(['c', 'g', 'x']);
    for (const name of ['Cursor Dev', 'Grok Dev', 'Codex Dev']) expect(result.message).toContain(name);
    expect(result.message).not.toContain('Fine');
    expect(result.message).toContain("can't run on");
  });

  it('refuses the coordinator seat by the same rules as workers (REQ-15)', () => {
    const result = run([
      seat({ slotId: '0:w1:0' }),
      seat({ slotId: 'orchestrator:orch', label: 'Orchestrator', harnessLabel: 'Grok', capability: NOTHING })
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusedSlotIds).toEqual(['orchestrator:orch']);
  });
});
