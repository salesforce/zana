import { describe, expect, it } from 'vitest';
import { isScheduledWaiting, trayStatesFor } from '../AgentTray.js';

describe('trayStatesFor', () => {
  it('keeps the global tray to blocked and working', () => {
    expect(trayStatesFor(undefined)).toEqual(['blocked', 'working']);
  });

  it('includes idle agents in the workspace (project-scoped) tray', () => {
    expect(trayStatesFor('proj-1')).toEqual(['blocked', 'working', 'idle', 'unknown']);
  });
});

describe('isScheduledWaiting', () => {
  it('hides a scheduled agent that is only waiting', () => {
    expect(isScheduledWaiting({ scheduled: true }, 'idle')).toBe(true);
    expect(isScheduledWaiting({ scheduled: true }, 'unknown')).toBe(true);
  });

  it('still surfaces a scheduled agent that is working or needs you', () => {
    expect(isScheduledWaiting({ scheduled: true }, 'working')).toBe(false);
    expect(isScheduledWaiting({ scheduled: true }, 'blocked')).toBe(false);
  });

  it('does not hide an ordinary idle agent', () => {
    expect(isScheduledWaiting({}, 'idle')).toBe(false);
    expect(isScheduledWaiting({ scheduled: false }, 'idle')).toBe(false);
  });
});
