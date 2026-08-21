import { describe, expect, it } from 'vitest';
import { IPC } from './ipc.js';

function collectChannels(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectChannels(child, out);
    }
  }
}

describe('IPC channel names', () => {
  it('are unique across the preload surface', () => {
    const channels: string[] = [];
    collectChannels(IPC, channels);
    expect(channels.length).toBeGreaterThan(20);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('has a dedicated main-owned folder adoption route', () => {
    expect(IPC.extensions.adoptLocal).toBe('extensions:adoptLocal');
  });
});
