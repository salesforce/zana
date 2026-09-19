import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputActivityMonitor } from '@zana-ai/zcc-host-daemon/output-activity';
import { AgentStatusTracker, PENDING_INPUT_CAP } from './agent-status.js';

describe('native pending input and terminal activity', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const tracker = new AgentStatusTracker();
    const activity = new OutputActivityMonitor({ sink: tracker, setTimer: setTimeout, clearTimer: clearTimeout });
    tracker.turnStarted('s');
    activity.observe('s', 'Thinking');
    vi.advanceTimersByTime(1800);
    expect(tracker.get('s')).toBe('working');
    return { tracker, activity };
  }

  it.each([0, 300])('retains the wait when the prompt repaints after %i ms', (delay) => {
    const { tracker, activity } = setup();
    tracker.inputRequested('s', 'approval:1');
    vi.advanceTimersByTime(delay);
    activity.observe('s', 'Would you like to run this command?');
    vi.advanceTimersByTime(1800);
    expect(tracker.get('s')).toBe('blocked');
    activity.observe('s', '1. Yes  2. No');
    tracker.report('s', 'waiting');
    vi.advanceTimersByTime(1800);
    expect(tracker.get('s')).toBe('blocked');
    tracker.inputResolved('s', ['approval:1']);
    vi.advanceTimersByTime(250);
    expect(tracker.get('s')).toBe('working');
    tracker.turnFinished('s');
    vi.advanceTimersByTime(250);
    expect(tracker.get('s')).toBe('idle');
  });

  it('does not let another tool or another session resolve a pending question', () => {
    const { tracker } = setup();
    tracker.inputRequested('s', 'question:1');
    tracker.inputRequested('s', 'approval:2');
    tracker.inputRequested('s', 'question:1');
    tracker.inputResolved('missing', ['question:1']);
    tracker.inputResolved('s', ['unrelated']);
    tracker.inputResolved('s', ['approval:2']);
    vi.advanceTimersByTime(250);
    expect(tracker.get('s')).toBe('blocked');
    tracker.inputResolved('s', ['question:1']);
    vi.advanceTimersByTime(250);
    expect(tracker.get('s')).toBe('working');
  });

  it.each(['turnStarted', 'turnFinished', 'clearBlocked', 'remove'] as const)('%s cleans up native requests', (method) => {
    const { tracker } = setup();
    tracker.inputRequested('s', 'question');
    tracker[method]('s');
    vi.advanceTimersByTime(250);
    expect(tracker.get('s')).not.toBe('blocked');
    tracker.clearBlocked('s');
  });

  it('bounds pending identities without losing attention on overflow', () => {
    const { tracker } = setup();
    const keys = Array.from({ length: PENDING_INPUT_CAP }, (_, i) => `q:${i}`);
    for (const key of keys) tracker.inputRequested('s', key);
    tracker.inputRequested('s', keys[0]);
    tracker.inputRequested('s', 'overflowed-question');
    tracker.inputResolved('s', keys);
    vi.advanceTimersByTime(250);
    expect(tracker.get('s')).toBe('blocked');
    tracker.turnFinished('s');
    vi.advanceTimersByTime(250);
    expect(tracker.get('s')).toBe('idle');
  });
});
