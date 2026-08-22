import { describe, expect, it } from 'vitest';
import { shouldReserveMacosTrafficLights } from '../shellChrome.js';

describe('shouldReserveMacosTrafficLights', () => {
  it('insets the trigger for Electron macOS window controls', () => {
    expect(shouldReserveMacosTrafficLights('macos', false, 'desktop')).toBe(true);
  });

  it('does not inset a browser tab, even on macOS', () => {
    expect(shouldReserveMacosTrafficLights('macos', false, 'web')).toBe(false);
  });

  it('drops the inset in fullscreen Electron', () => {
    expect(shouldReserveMacosTrafficLights('macos', true, 'desktop')).toBe(false);
  });

  it('does not inset non-macOS desktop windows', () => {
    expect(shouldReserveMacosTrafficLights('other', false, 'desktop')).toBe(false);
  });
});
