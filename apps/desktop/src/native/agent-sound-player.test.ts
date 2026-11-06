import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { playAgentSound } from './agent-sound-player.js';
let contexts: any[];
beforeEach(() => {
  vi.useFakeTimers(); contexts = [];
  vi.stubGlobal('AudioContext', class {
    currentTime = 10; destination = {}; nodes: any[] = [];
    resume = vi.fn().mockResolvedValue(undefined); close = vi.fn().mockResolvedValue(undefined);
    constructor() { contexts.push(this); }
    createOscillator() {
      const node = { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: undefined as any, type: '' };
      this.nodes.push(node); return node;
    }
    createGain() { return { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }; }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([['idle', [784, 1046.5]], ['needs-you', [880, 659.25, 880]]] as const)('schedules distinct %s notes and releases the graph', async (kind, notes) => {
  await playAgentSound(kind, 50);
  const ctx = contexts[0];
  expect(ctx.resume).toHaveBeenCalledOnce();
  expect(ctx.nodes.map((n: any) => n.frequency.value)).toEqual(notes);
  expect(ctx.nodes[0].start).toHaveBeenCalledWith(10);
  for (const node of ctx.nodes) { node.onended(); expect(node.disconnect).toHaveBeenCalledOnce(); }
  vi.advanceTimersByTime(1_000); expect(ctx.close).toHaveBeenCalledOnce();
});
it('mutes without allocating an audio context', async () => {
  await playAgentSound('idle', 0); expect(contexts).toHaveLength(0);
});
it('releases audio resources and propagates failures for preview feedback', async () => {
  const Original = globalThis.AudioContext;
  vi.stubGlobal('AudioContext', class extends Original {
    constructor() { super(); (this as any).resume.mockRejectedValue(new Error('no device')); }
  });
  await expect(playAgentSound('idle', 50)).rejects.toThrow('no device');
  expect(contexts[0].close).toHaveBeenCalledOnce();
});
