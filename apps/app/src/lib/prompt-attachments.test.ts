import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composerImageNeedsUpload,
  conversationImageSrc,
  persistComposerImages,
  projectAttachmentContentUrl,
  uploadPromptAttachment
} from './prompt-attachments.js';

describe('prompt attachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds a confined content URL for stored attachment names', () => {
    expect(projectAttachmentContentUrl('proj-1', 'shot-1.png')).toBe(
      '/api/v1/projects/proj-1/attachments/content?path=shot-1.png'
    );
    expect(readFileSync(new URL('./prompt-attachments.ts', import.meta.url), 'utf8'))
      .toContain('/projects/${encodeURIComponent(projectId)}/attachments');
    expect(readFileSync(new URL('./prompt-attachments.ts', import.meta.url), 'utf8'))
      .toContain('XMLHttpRequest');
  });

  it('uses remote/data URLs as-is and skips absolute disk paths', () => {
    expect(conversationImageSrc('p', 'https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(conversationImageSrc('p', 'data:image/png;base64,xx')).toBe('data:image/png;base64,xx');
    expect(conversationImageSrc('p', 'blob:shot')).toBe('blob:shot');
    expect(conversationImageSrc('p', '/tmp/a.png')).toBeNull();
    expect(conversationImageSrc('p', 'file:///tmp/a.png')).toBeNull();
    expect(conversationImageSrc('p', 'C:\\tmp\\a.png')).toBeNull();
    expect(conversationImageSrc('p', 'shot-1.png')).toBe(
      '/api/v1/projects/p/attachments/content?path=shot-1.png'
    );
    expect(conversationImageSrc(null, 'shot-1.png')).toBeNull();
  });

  it('uploads Finder disk paths so the thread can render them', async () => {
    expect(composerImageNeedsUpload(null)).toBe(true);
    expect(composerImageNeedsUpload('/tmp/a.png')).toBe(true);
    expect(composerImageNeedsUpload('C:\\tmp\\a.png')).toBe(true);
    expect(composerImageNeedsUpload('shot-1.png')).toBe(true);
    expect(composerImageNeedsUpload('https://example.com/a.png')).toBe(false);
    expect(composerImageNeedsUpload('data:image/png;base64,xx')).toBe(false);

    const file = new File([new Uint8Array([1])], 'clip.png', { type: 'image/png' });
    let uploads = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      uploads += 1;
      return new Response(JSON.stringify({
        type: 'localImage',
        path: `clip-${uploads}.png`,
        name: 'clip.png',
        sizeBytes: 1
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await expect(persistComposerImages('proj-1', [
      { path: '/tmp/a.png', file },
      { path: null, file },
      { path: 'docs/shot.png', file }
    ])).resolves.toEqual(['clip-1.png', 'clip-2.png', 'clip-3.png']);
  });

  it('surfaces upload failures from the attachment API', async () => {
    const file = new File([new Uint8Array([1])], 'clip.png', { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'invalid_request',
      message: 'Attachment exceeds 10MB limit'
    }), { status: 400, headers: { 'content-type': 'application/json' } })));
    await expect(uploadPromptAttachment('proj-1', file)).rejects.toThrow(/10MB/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(uploadPromptAttachment('proj-1', file)).rejects.toThrow('500');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 418 })));
    await expect(uploadPromptAttachment('proj-1', file)).rejects.toThrow('418');
  });
});
