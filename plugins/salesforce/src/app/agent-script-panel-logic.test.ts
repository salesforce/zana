import { describe, expect, it } from 'vitest';
import {
  filePickerValue,
  parseFilePickerValue,
  PLAYGROUND_LOAD_ERROR,
  playgroundHint,
  saveIsDisabled,
  shouldShowPlaygroundFailure
} from './agent-script-panel-logic.js';
import { readDocumentTheme } from './playground-bridge.js';

describe('agent script panel logic', () => {
  it('encodes and parses file vs example picker values', () => {
    expect(filePickerValue('force-app/Bot.agent', 'minimal')).toBe('file:force-app/Bot.agent');
    expect(filePickerValue(null, 'support-bot')).toBe('example:support-bot');
    expect(parseFilePickerValue('example:minimal')).toEqual({ kind: 'example', id: 'minimal' });
    expect(parseFilePickerValue('file:force-app/Bot.agent')).toEqual({ kind: 'file', path: 'force-app/Bot.agent' });
    expect(parseFilePickerValue('force-app/Bot.agent')).toEqual({ kind: 'file', path: 'force-app/Bot.agent' });
  });

  it('disables save until a DX file is open and idle', () => {
    expect(saveIsDisabled(false, 'a.agent', false)).toBe(true);
    expect(saveIsDisabled(true, null, false)).toBe(true);
    expect(saveIsDisabled(true, 'a.agent', true)).toBe(true);
    expect(saveIsDisabled(true, 'a.agent', false)).toBe(false);
  });

  it('hints when the DX root is missing', () => {
    expect(playgroundHint(false, undefined)).toBeNull();
    expect(playgroundHint(true, true)).toBeNull();
    expect(playgroundHint(true, false)).toMatch(/DX project root/);
  });

  it('defaults theme to dark without a light document attribute', () => {
    expect(readDocumentTheme()).toBe('dark');
  });

  it('shows a playground failure only before ready', () => {
    expect(shouldShowPlaygroundFailure({ ready: false, iframeError: false, timedOut: false })).toBe(false);
    expect(shouldShowPlaygroundFailure({ ready: false, iframeError: true, timedOut: false })).toBe(true);
    expect(shouldShowPlaygroundFailure({ ready: false, iframeError: false, timedOut: true })).toBe(true);
    expect(shouldShowPlaygroundFailure({ ready: true, iframeError: true, timedOut: true })).toBe(false);
    expect(PLAYGROUND_LOAD_ERROR).toMatch(/reinstall/i);
  });
});
