import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundPolicy } from './policy.js';
import { DEFAULTS } from './model.js';
import type { PluginAgentActivity } from '@zana-ai/zcc-plugin-sdk/app';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup() {
  const config = { ...DEFAULTS, enabled: true, idle: true }, play = vi.fn();
  const policy = new SoundPolicy(() => config, play);
  const observe = (...states: PluginAgentActivity['state'][]) => policy.observe({ ready: true, agents: states.map((state, i) => ({ id: String(i), kind: 'thread', state })) });
  return { config, play, policy, observe };
}
describe('sound policy', () => {
  it('seeds silently and announces only a stable working to idle transition', () => {
    const s = setup(); s.observe('idle', 'needs-you'); vi.advanceTimersByTime(6000); expect(s.play).not.toHaveBeenCalled();
    s.observe('working'); s.observe('idle'); vi.advanceTimersByTime(4999); expect(s.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(s.play).toHaveBeenCalledExactlyOnceWith('idle');
    s.observe('idle'); vi.advanceTimersByTime(30000); expect(s.play).toHaveBeenCalledTimes(1);
  });
  it.each(['working', 'unknown', 'needs-you'] as const)('cancels pending idle on %s', state => {
    const s = setup(); s.observe('working'); s.observe('idle'); s.observe(state); vi.advanceTimersByTime(6000);
    expect(s.play.mock.calls.filter(([cue]) => cue === 'idle')).toEqual([]);
  });
  it('coalesces ten idle agents, prioritizes requests, and spaces future idle alerts', () => {
    const s = setup(); s.observe(...Array(10).fill('working')); s.observe(...Array(10).fill('idle')); vi.advanceTimersByTime(5000);
    expect(s.play.mock.calls).toEqual([['idle']]);
    s.observe('needs-you'); expect(s.play.mock.calls).toEqual([['idle'], ['needs-you']]);
    s.observe('working'); s.observe('needs-you'); expect(s.play).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3000); s.observe('working'); s.observe('needs-you'); expect(s.play).toHaveBeenCalledTimes(3);
    s.observe('working'); s.observe('idle'); vi.advanceTimersByTime(5000); expect(s.play).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15000); s.observe('working'); s.observe('idle'); vi.advanceTimersByTime(5000); expect(s.play).toHaveBeenLastCalledWith('idle'); expect(s.play).toHaveBeenCalledTimes(4);
  });
  it.each(['enabled', 'idle', 'needsYou', 'volume'] as const)('honors %s even after scheduling', field => {
    const s = setup(); s.observe('working'); s.observe('idle'); Object.assign(s.config, { [field]: field === 'volume' ? 0 : false });
    vi.advanceTimersByTime(5000); s.observe('needs-you');
    expect(s.play.mock.calls).toEqual(field === 'idle' ? [['needs-you']] : field === 'needsYou' ? [['idle']] : []);
  });
  it('removal, unavailable snapshots, configuration refresh and disposal release timers', () => {
    const s = setup(); s.observe('working'); s.observe('idle'); s.observe(); vi.advanceTimersByTime(6000);
    s.observe('working'); s.observe('idle'); s.policy.refresh(); vi.advanceTimersByTime(6000);
    s.observe('working'); s.observe('idle'); s.policy.observe({ ready: false, agents: [] }); vi.advanceTimersByTime(6000);
    s.observe('working'); s.observe('idle'); s.policy.dispose(); vi.advanceTimersByTime(6000); expect(s.play).not.toHaveBeenCalled();
  });
  it('bounds state and timers to 1000 agents', () => {
    const s = setup(); s.observe(...Array(1100).fill('working')); s.observe(...Array(1100).fill('idle'));
    expect(vi.getTimerCount()).toBe(1000); s.policy.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});
