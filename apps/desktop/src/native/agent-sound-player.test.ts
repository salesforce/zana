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
it.each([['done', [659.25, 880]], ['idle', [784, 1046.5]], ['needs-you', [880, 659.25, 880]]] as const)('schedules distinct %s notes and releases the graph', async (kind, notes) => {
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

it('decodes custom audio, applies volume, caps long clips and releases nodes on end', async () => {
  const Original = globalThis.AudioContext;
  let source: any, gain: any;
  vi.stubGlobal('AudioContext', class extends Original {
    decodeAudioData = vi.fn().mockResolvedValue({ duration: 40 });
    createBufferSource() { source = { buffer: undefined, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), onended: undefined }; return source; }
    createGain() { gain = super.createGain(); return gain; }
  });
  await playAgentSound('done', 75, { mime: 'audio/mpeg', base64: 'SUQz' });
  expect(source.start).toHaveBeenCalledWith(0, 0, 8); expect(gain.gain.value).toBe(0.75);
  source.onended(); expect(source.disconnect).toHaveBeenCalledOnce(); expect(gain.disconnect).toHaveBeenCalledOnce();
  expect(contexts[0].close).toHaveBeenCalledOnce(); vi.advanceTimersByTime(9_000); expect(contexts[0].close).toHaveBeenCalledOnce();
});
it('caps resources on decoder failures, invalid payloads and overlapping previews', async () => {
  const Original = globalThis.AudioContext;
  vi.stubGlobal('AudioContext', class extends Original { decodeAudioData = vi.fn().mockRejectedValue(new Error('bad audio')); });
  await expect(playAgentSound('done', 50, { mime: 'audio/wav', base64: 'SUQz' })).rejects.toThrow('bad audio');
  expect(contexts[0].close).toHaveBeenCalledOnce();
  await expect(playAgentSound('done', 50, { mime: 'wrong' as never, base64: 'SUQz' })).rejects.toThrow('Invalid');
  await expect(playAgentSound('done', 50, { mime: 'audio/wav', base64: 'a'.repeat(1_398_105) })).rejects.toThrow('Invalid');
  await playAgentSound('done', 50); await playAgentSound('needs-you', 50);
  expect(contexts[3].close).toHaveBeenCalledOnce(); vi.advanceTimersByTime(9_000); expect(contexts[4].close).toHaveBeenCalledOnce();
});

it('cancels an older preview even while resume or decode is pending and times out an unterminated clip', async () => {
  const Original = globalThis.AudioContext;
  let resume: () => void = () => {}, decode: (buffer: any) => void = () => {};
  let first = true;
  vi.stubGlobal('AudioContext', class extends Original {
    constructor() { super(); if (first) { first = false; (this as any).resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve; })); } }
    decodeAudioData = vi.fn(() => new Promise(resolve => { decode = resolve; }));
    createBufferSource() { return { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), buffer: undefined, onended: undefined }; }
  });
  const older = playAgentSound('done', 50); await playAgentSound('idle', 50); resume(); await older;
  expect(contexts[0].nodes).toHaveLength(0);
  const decoding = playAgentSound('done', 50, { mime: 'audio/wav', base64: 'SUQz' });
  await Promise.resolve(); await playAgentSound('idle', 50); decode({ duration: 1 }); await decoding;
  expect(contexts[2].close).toHaveBeenCalledOnce();
  const unterminated = playAgentSound('done', 50, { mime: 'audio/wav', base64: 'SUQz' });
  await Promise.resolve(); decode({ duration: 0.5 }); await unterminated;
  vi.advanceTimersByTime(8_100); expect(contexts[4].close).toHaveBeenCalledOnce();
});
