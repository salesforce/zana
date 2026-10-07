import { afterEach, describe, expect, it } from 'vitest';
import { useWhatsNew } from './live.js';
import type { ReleaseNote } from '@zana-ai/zcc-domain/product';

afterEach(() => useWhatsNew.setState({ open: false, notes: [], toVersion: null, preview: false }));
describe('release notes preview state', () => {
  const notes = [{ version: '2.3.4', markdown: 'Release details' }] as ReleaseNote[];
  it('opens offered release notes as a preview, resets the preview for installed notes, and ignores an empty batch', () => {
    useWhatsNew.getState().openWith(notes, '2.3.4', { preview: true });
    expect(useWhatsNew.getState()).toMatchObject({ open: true, notes, toVersion: '2.3.4', preview: true });
    useWhatsNew.getState().openWith([], null);
    expect(useWhatsNew.getState()).toMatchObject({ notes, toVersion: '2.3.4', preview: true });
    useWhatsNew.getState().close();
    expect(useWhatsNew.getState().open).toBe(false);
    useWhatsNew.getState().openWith(notes, '2.3.4');
    expect(useWhatsNew.getState()).toMatchObject({ open: true, preview: false });
  });
});
