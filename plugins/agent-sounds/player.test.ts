import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SoundPlayer } from './player.js';
let contexts: any[];
beforeEach(() => {
  vi.useFakeTimers(); contexts = [];
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 0; destination = {};
    close = vi.fn(async () => { this.state = 'closed'; }); resume = vi.fn(async () => {});
    decodeAudioData = vi.fn(async () => ({ duration: 30 }));
    source = { connect: vi.fn(), start: vi.fn() };
    createBufferSource = () => this.source;
    createGain = () => { const g: any = { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(() => g) }; return g; };
    createOscillator = () => ({ frequency: { value: 0 }, connect: (node: unknown) => node, start: vi.fn(), stop: vi.fn() });
    constructor() { contexts.push(this); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('plays both synthesized cues, releases graphs and respects zero volume', async () => {
  const player = new SoundPlayer(); await player.play('idle', 0); expect(contexts).toHaveLength(0);
  await player.play('idle', 50); vi.advanceTimersByTime(1000); expect(contexts[0].close).toHaveBeenCalledTimes(1);
  await player.play('needs-you', 35); player.stop(); expect(contexts[1].close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('decodes local audio, caps playback at 8 seconds, and interrupts previous cues', async () => {
  const player = new SoundPlayer(); await player.play('idle', 50);
  await player.play('needs-you', 50, { name: 'x', mime: 'audio/wav', base64: 'YQ==' });
  expect(contexts[0].close).toHaveBeenCalled(); expect(contexts[1].source.start).toHaveBeenCalledWith(0, 0, 8);
  vi.advanceTimersByTime(8100); expect(contexts[1].close).toHaveBeenCalled();
});
it('reports decode failures and closes the context', async () => {
  const player = new SoundPlayer(), pending = player.play('idle', 35, { name: 'x', mime: 'audio/wav', base64: 'YQ==' });
  contexts[0].decodeAudioData.mockRejectedValue(new Error('bad audio'));
  await expect(pending).rejects.toThrow('bad audio'); expect(contexts[0].close).toHaveBeenCalled();
});
it('does not start audio after disposal while resume or decoding is pending', async () => {
  const player = new SoundPlayer(), pending = player.play('idle', 35); player.stop(); await pending; expect(contexts[0].close).toHaveBeenCalledTimes(1);
  const decoding = player.play('idle', 35, { name: 'x', mime: 'audio/wav', base64: 'YQ==' });
  await Promise.resolve(); player.stop(); await decoding; expect(contexts[1].source.start).not.toHaveBeenCalled();
});
it('never lets a lower-priority idle cue cut off a request for input', async () => {
  const player = new SoundPlayer(); await player.play('needs-you', 35);
  await player.play('idle', 35); expect(contexts).toHaveLength(1); expect(contexts[0].close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000); await player.play('idle', 35); expect(contexts).toHaveLength(2); player.stop();
});
it('treats decoding cancelled by disposal as cancellation, not a playback error', async () => {
  const player = new SoundPlayer(), playback = player.play('idle', 35, { name: 'x', mime: 'audio/wav', base64: 'YQ==' });
  let fail!: (error: Error) => void;
  contexts[0].decodeAudioData.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
  await Promise.resolve(); player.stop(); fail(new Error('context closed')); await expect(playback).resolves.toBeUndefined();
});
