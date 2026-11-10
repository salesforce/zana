import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSounds, AGENT_SOUND_IDLE_DELAY_MS } from './agent-sounds.js';
import { normalizeAgentSoundVolume, type AppConfig } from '@zana-ai/zcc-domain/product';

let config: Partial<AppConfig>;
let play: ReturnType<typeof vi.fn>;
let sounds: AgentSounds;
beforeEach(() => {
  vi.useFakeTimers();
  config = { agentSoundIdle: true, agentSoundNeedsYou: true, agentSoundVolume: 50 };
  play = vi.fn();
  sounds = new AgentSounds({ config: () => config, play });
});
afterEach(() => { sounds.shutdown(); vi.useRealTimers(); });
const settle = () => vi.advanceTimersByTime(AGENT_SOUND_IDLE_DELAY_MS);

it('baselines restored idle and blocked agents without a sound', () => {
  sounds.observe('a', 'idle'); sounds.observe('b', 'blocked'); settle();
  expect(play).not.toHaveBeenCalled();
});
it('waits five seconds after work and plays once for repeated idle/done events', () => {
  sounds.observe('a', 'working'); sounds.observe('a', 'idle');
  vi.advanceTimersByTime(4_999); expect(play).not.toHaveBeenCalled();
  sounds.observe('a', 'idle'); sounds.observe('a', 'done');
  vi.advanceTimersByTime(1); expect(play).toHaveBeenCalledExactlyOnceWith('idle', 50);
  settle(); sounds.observe('a', 'idle'); settle(); expect(play).toHaveBeenCalledOnce();
});
it('cancels short idle gaps and starts a fresh timer after work resumes', () => {
  sounds.observe('a', 'working'); sounds.observe('a', 'idle');
  vi.advanceTimersByTime(1_000); sounds.observe('a', 'working'); settle();
  expect(play).not.toHaveBeenCalled();
  sounds.observe('a', 'done'); settle(); expect(play).toHaveBeenCalledOnce();
});
it('gives a real input request precedence over a pending idle chime', () => {
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); sounds.observe('a', 'blocked');
  sounds.observe('a', 'blocked'); settle();
  expect(play).toHaveBeenCalledExactlyOnceWith('needs-you', 50);
});
it('does not play idle when a question is answered or on unknown/waiting states', () => {
  sounds.observe('a', 'blocked'); sounds.observe('a', 'idle'); settle();
  sounds.observe('a', 'unknown'); sounds.observe('a', 'waiting'); settle();
  expect(play).not.toHaveBeenCalled();
});
it('keeps the two toggles independent, with both absent meaning off', () => {
  config = {};
  sounds.observe('a', 'working'); sounds.observe('a', 'blocked');
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); settle();
  expect(play).not.toHaveBeenCalled();
  config.agentSoundIdle = true;
  sounds.observe('a', 'working'); sounds.observe('a', 'blocked');
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); settle();
  expect(play).toHaveBeenCalledExactlyOnceWith('idle', 50);
});
it('cancels pending idle audio when disabled, and enabling does not replay it', () => {
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); sounds.refresh();
  config.agentSoundIdle = false; sounds.refresh();
  config.agentSoundIdle = true; sounds.refresh(); settle();
  expect(play).not.toHaveBeenCalled();
});
it('rechecks configuration and volume at fire time', () => {
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); config.agentSoundIdle = false; settle();
  config.agentSoundIdle = true;
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); config.agentSoundVolume = 0; settle();
  sounds.observe('a', 'working'); sounds.observe('a', 'blocked'); expect(play).not.toHaveBeenCalled();
  config.agentSoundVolume = 110;
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); settle();
  expect(play).toHaveBeenCalledExactlyOnceWith('idle', 100);
});
it('coalesces fleet bursts but prioritizes input requests over idle chimes', () => {
  for (const id of ['a', 'b']) { sounds.observe(id, 'working'); sounds.observe(id, 'blocked'); }
  expect(play).toHaveBeenCalledOnce();
  sounds.observe('c', 'working'); sounds.observe('c', 'idle'); settle();
  expect(play).toHaveBeenCalledTimes(2);
  sounds.observe('a', 'working'); sounds.observe('a', 'blocked'); expect(play).toHaveBeenCalledTimes(3);
});
it('forgets exited/archived agents and clears pending timers on shutdown', () => {
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); sounds.remove('a'); sounds.remove('missing');
  sounds.observe('a', 'idle'); settle(); expect(play).not.toHaveBeenCalled();
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); sounds.shutdown(); settle();
  sounds.observe('late', 'working'); sounds.observe('late', 'idle'); settle();
  expect(play).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('resets threads on disconnect while preserving CLI timers', () => {
  for (const id of ['cli:a', 'thread:a']) { sounds.observe(id, 'working'); sounds.observe(id, 'idle'); }
  sounds.resetThreads(); settle(); expect(play).toHaveBeenCalledOnce();
  sounds.observe('thread:a', 'idle'); settle(); expect(play).toHaveBeenCalledOnce();
});
it('bounds tracked agents and cancels evicted timers', () => {
  sounds.observe('a', 'working'); sounds.observe('a', 'idle');
  for (let i = 0; i < 1_000; i++) sounds.observe(String(i), 'working');
  settle(); expect(play).not.toHaveBeenCalled();
});
it('isolates audio failures from agent state tracking', () => {
  play.mockImplementation(() => { throw new Error('audio unavailable'); });
  sounds.observe('a', 'working'); expect(() => sounds.observe('a', 'blocked')).not.toThrow();
});
describe('volume normalization', () => {
  it.each([[undefined, 50], [null, 50], ['80', 50], [NaN, 50], [Infinity, 50], [-1, 0], [101, 100], [43.6, 44]])('%j becomes %s', (input, expected) => {
    expect(normalizeAgentSoundVolume(input)).toBe(expected);
  });
});

it('cancels built-in idle sounds when a plugin owns audio and honors the explicit master', () => {
  sounds.observe('a', 'working'); sounds.observe('a', 'idle');
  Object.assign(config, { notificationSoundProvider: 'other/voice' }); sounds.refresh(); settle(); expect(play).not.toHaveBeenCalled();
  sounds.observe('a', 'blocked'); expect(play).not.toHaveBeenCalled();
  Object.assign(config, { notificationSoundProvider: 'builtin', notificationSoundsEnabled: false });
  sounds.observe('a', 'working'); sounds.observe('a', 'blocked'); expect(play).not.toHaveBeenCalled();
  Object.assign(config, { notificationSoundsEnabled: true });
  sounds.observe('a', 'working'); sounds.observe('a', 'blocked'); expect(play).toHaveBeenCalledWith('needs-you', 50);
});

it('keeps explicit completion separate from idle, coalesces a confirmed completion with pending idle, and never replays baselines', () => {
  config.agentSoundDone = true;
  sounds.observe('restored', 'done'); expect(play).not.toHaveBeenCalled();
  sounds.observe('a', 'working'); sounds.observe('a', 'idle'); sounds.observe('a', 'done'); settle();
  expect(play).toHaveBeenCalledExactlyOnceWith('done', 50);
  sounds.observe('a', 'idle'); settle(); expect(play).toHaveBeenCalledOnce();
  sounds.observe('a', 'working'); sounds.observe('a', 'done'); expect(play).toHaveBeenCalledTimes(2);
});
it('uses fleet-wide quiet spacing across different events and rechecks it for future cues', () => {
  config.agentSoundDone = true; config.agentSoundSpacingSeconds = 10;
  sounds.observe('a', 'working'); sounds.observe('a', 'done');
  sounds.observe('b', 'working'); sounds.observe('b', 'blocked'); expect(play).toHaveBeenCalledTimes(2);
  sounds.observe('b', 'working'); sounds.observe('b', 'blocked'); expect(play).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(10_000); sounds.observe('b', 'working'); sounds.observe('b', 'blocked'); expect(play).toHaveBeenCalledTimes(3);
  config.agentSoundSpacingSeconds = NaN; vi.advanceTimersByTime(2_000);
  sounds.observe('a', 'working'); sounds.observe('a', 'done'); expect(play).toHaveBeenCalledTimes(4);
});
