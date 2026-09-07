import { describe, expect, it } from 'vitest';
import {
  appendPreviewTurn,
  normalizePreviewMode,
  previewEndDisabled,
  previewErrorMessage,
  previewSendDisabled,
  previewStartDisabled
} from './agentforce-preview-logic.js';

describe('agentforce preview logic', () => {
  it('defaults unknown modes to simulate', () => {
    expect(normalizePreviewMode('live')).toBe('live');
    expect(normalizePreviewMode('simulate')).toBe('simulate');
    expect(normalizePreviewMode('nope')).toBe('simulate');
  });

  it('gates start, send, and end on session and busy state', () => {
    expect(previewStartDisabled(false, true, null)).toBe(false);
    expect(previewStartDisabled(true, true, null)).toBe(true);
    expect(previewStartDisabled(false, false, null)).toBe(true);
    expect(previewStartDisabled(false, true, 'sess')).toBe(true);
    expect(previewSendDisabled(false, 'sess', 'hello')).toBe(false);
    expect(previewSendDisabled(false, null, 'hello')).toBe(true);
    expect(previewSendDisabled(false, 'sess', '  ')).toBe(true);
    expect(previewEndDisabled(false, 'sess')).toBe(false);
    expect(previewEndDisabled(true, 'sess')).toBe(true);
  });

  it('caps the transcript and formats errors', () => {
    const turns = appendPreviewTurn([], { id: '1', role: 'user', text: 'hi' });
    expect(turns).toHaveLength(1);
    const overflow = Array.from({ length: 81 }, (_, i) => ({
      id: String(i),
      role: 'user' as const,
      text: 'x'
    }));
    expect(appendPreviewTurn(overflow.slice(0, 80), overflow[80]!)).toHaveLength(80);
    expect(previewErrorMessage({ error: 'no org' })).toBe('no org');
    expect(previewErrorMessage(null)).toBe('Preview failed.');
  });
});
