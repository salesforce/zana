import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEIGHT_PX,
  hostFileContentUrl,
  parsePreviewHeight,
  requireWorkspaceHtmlFile
} from './preview.js';

describe('inline-vis preview helpers', () => {
  it('defaults and clamps height', () => {
    expect(parsePreviewHeight(undefined)).toBe(DEFAULT_HEIGHT_PX);
    expect(parsePreviewHeight('')).toBe(DEFAULT_HEIGHT_PX);
    expect(parsePreviewHeight('480')).toBe(480);
    expect(parsePreviewHeight('12')).toBeNull();
    expect(parsePreviewHeight('2000')).toBeNull();
    expect(parsePreviewHeight('tall')).toBeNull();
  });

  it('accepts confined workspace html paths only', () => {
    expect(requireWorkspaceHtmlFile('charts/out.html')).toBe('charts/out.html');
    expect(requireWorkspaceHtmlFile('demo.HTM')).toBe('demo.HTM');
    expect(requireWorkspaceHtmlFile('../out.html')).toBeNull();
    expect(requireWorkspaceHtmlFile('/tmp/out.html')).toBeNull();
    expect(requireWorkspaceHtmlFile('charts/out.md')).toBeNull();
    expect(requireWorkspaceHtmlFile('')).toBeNull();
  });

  it('builds a confined host-files content URL', () => {
    expect(hostFileContentUrl('thr_1', 'charts/out.html')).toBe(
      '/api/v1/threads/thr_1/host-files/content?path=charts%2Fout.html'
    );
  });
});
