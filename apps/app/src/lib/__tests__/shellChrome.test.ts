import { describe, expect, it } from 'vitest';
import {
  shellPlatform,
  shouldReserveMacosTrafficLights,
  shouldReserveWindowsCaptionButtons
} from '../shellChrome.js';

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
    expect(shouldReserveMacosTrafficLights('windows', false, 'desktop')).toBe(false);
  });
});

describe('shouldReserveWindowsCaptionButtons', () => {
  it('reserves space for Electron Windows window caption buttons', () => {
    expect(shouldReserveWindowsCaptionButtons('windows', false, 'desktop')).toBe(true);
  });

  it('does not reserve space in a browser tab, even on Windows', () => {
    expect(shouldReserveWindowsCaptionButtons('windows', false, 'web')).toBe(false);
  });

  it('drops the caption reserve in fullscreen Electron on Windows', () => {
    expect(shouldReserveWindowsCaptionButtons('windows', true, 'desktop')).toBe(false);
  });

  it('does not reserve space for non-Windows desktop windows', () => {
    expect(shouldReserveWindowsCaptionButtons('macos', false, 'desktop')).toBe(false);
    expect(shouldReserveWindowsCaptionButtons('other', false, 'desktop')).toBe(false);
  });
});

describe('shellPlatform', () => {
  it('detects platform correctly', () => {
    const current = shellPlatform();
    expect(['macos', 'windows', 'linux', 'other']).toContain(current);
  });
});
