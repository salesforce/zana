import { describe, expect, it } from 'vitest';
import { resolveThreadSendMode } from './thread-composer-preferences.js';

describe('resolveThreadSendMode', () => {
  it('uses auto unless steer-on-enter is on and the thread is running', () => {
    expect(resolveThreadSendMode({
      steerOnEnter: false,
      threadRunning: true,
      modifierEnter: false
    })).toBe('auto');
    expect(resolveThreadSendMode({
      steerOnEnter: true,
      threadRunning: false,
      modifierEnter: false
    })).toBe('auto');
  });

  it('steers on Enter and queues on modifier+Enter when the thread is running', () => {
    expect(resolveThreadSendMode({
      steerOnEnter: true,
      threadRunning: true,
      modifierEnter: false
    })).toBe('steer');
    expect(resolveThreadSendMode({
      steerOnEnter: true,
      threadRunning: true,
      modifierEnter: true
    })).toBe('queue-if-active');
  });
});
