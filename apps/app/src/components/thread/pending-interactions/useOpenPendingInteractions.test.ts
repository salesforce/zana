import { describe, expect, it } from 'vitest';
import { isOpenThreadEvent, isOpenThreadUpdate } from './useOpenPendingInteractions.js';

describe('pending interaction refresh matchers', () => {
  it('matches thread view updates and timeline events for the open thread', () => {
    expect(isOpenThreadUpdate({ id: 'thr-1' }, 'thr-1')).toBe(true);
    expect(isOpenThreadUpdate({ id: 'thr-2' }, 'thr-1')).toBe(false);
    expect(isOpenThreadUpdate({ hostId: 'host-1' }, 'thr-1')).toBe(false);
    expect(isOpenThreadUpdate(null, 'thr-1')).toBe(false);
    expect(isOpenThreadEvent({ threadId: 'thr-1', type: 'item/started' }, 'thr-1')).toBe(true);
    expect(isOpenThreadEvent({ threadId: 'thr-2' }, 'thr-1')).toBe(false);
    expect(isOpenThreadEvent('event', 'thr-1')).toBe(false);
  });
});
