import { describe, expect, it } from 'vitest';
import { timeSquadLaunchPhase } from './squad-launch-timing.js';

function clock(...values: number[]) {
  const queue = [...values];
  return () => queue.shift() ?? 0;
}

describe('timeSquadLaunchPhase', () => {
  it('logs the phase name and elapsed milliseconds and returns the result', async () => {
    const lines: string[] = [];
    const result = await timeSquadLaunchPhase('preflight-host-provider-status', async () => 'ok', {
      now: clock(1_000, 13_550), log: (line) => lines.push(line)
    });
    expect(result).toBe('ok');
    expect(lines).toEqual(['[squad-launch] preflight-host-provider-status took 12550ms']);
  });

  it('logs when the phase throws and rethrows the same error', async () => {
    const lines: string[] = [];
    const failure = new Error('secret prompt text');
    await expect(timeSquadLaunchPhase('member-create-admit', async () => { throw failure; }, {
      now: clock(0, 40), log: (line) => lines.push(line)
    })).rejects.toBe(failure);
    expect(lines).toEqual(['[squad-launch] member-create-admit took 40ms']);
  });

  it('never logs a phase label that is not a plain name, and never a negative duration', async () => {
    const lines: string[] = [];
    await timeSquadLaunchPhase('Write a prompt here', async () => 1, { now: clock(500, 400), log: (line) => lines.push(line) });
    expect(lines).toEqual(['[squad-launch] invalid-phase took 0ms']);
  });

  it('defaults to console.warn so the line reaches server.log', async () => {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => { lines.push(message); };
    try { await timeSquadLaunchPhase('member-activate-start', async () => 1); } finally { console.warn = original; }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[squad-launch\] member-activate-start took \d+ms$/);
  });
});
