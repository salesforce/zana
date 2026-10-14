import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects macOS from navigator.platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(shellPlatform()).toBe('macos');
  });

  it('detects macOS from navigator.userAgentData', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, platform: '' });
    expect(shellPlatform()).toBe('macos');
  });

  it('detects Windows from navigator.platform', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(shellPlatform()).toBe('windows');
  });

  it('detects Windows from navigator.userAgentData', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' }, platform: '' });
    expect(shellPlatform()).toBe('windows');
  });

  it('detects Linux from navigator.platform', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' });
    expect(shellPlatform()).toBe('linux');
  });

  it('detects Linux from navigator.userAgentData', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'Linux' }, platform: '' });
    expect(shellPlatform()).toBe('linux');
  });

  it('prioritizes userAgentData over legacy navigator.platform', () => {
    vi.stubGlobal('navigator', {
      userAgentData: { platform: 'Windows' },
      platform: 'Linux x86_64'
    });
    expect(shellPlatform()).toBe('windows');
  });

  it('falls back to other for unknown platforms', () => {
    vi.stubGlobal('navigator', { platform: 'FreeBSD' });
    expect(shellPlatform()).toBe('other');
  });

  it('falls back to other when navigator is undefined', () => {
    vi.stubGlobal('navigator', undefined);
    expect(shellPlatform()).toBe('other');
  });
});
