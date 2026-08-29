import { describe, expect, it } from 'vitest';
import {
  getBrowserAutomationHost,
  setBrowserAutomationHost,
  type BrowserAutomationHost
} from './browser-automation.js';

describe('browser automation host registry', () => {
  it('starts empty and round-trips a host', () => {
    setBrowserAutomationHost(null);
    expect(getBrowserAutomationHost()).toBeNull();
    const stub = { open: async () => ({ targetId: 't', tabId: 'b' }) } as BrowserAutomationHost;
    setBrowserAutomationHost(stub);
    expect(getBrowserAutomationHost()).toBe(stub);
    setBrowserAutomationHost(null);
    expect(getBrowserAutomationHost()).toBeNull();
  });
});
