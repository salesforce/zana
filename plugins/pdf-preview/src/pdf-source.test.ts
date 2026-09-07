import { describe, expect, it } from 'vitest';
import { bytesFromFileResponse, pdfBlobFromFileResponse, resolvePdfReadTarget } from '../pdf-source.js';

describe('pdf-preview source', () => {
  it('builds thread host and storage URLs', () => {
    expect(
      resolvePdfReadTarget('docs/spec.pdf', {
        kind: 'workspace',
        threadId: 'thr_1',
        environmentId: null,
        projectId: 'p1'
      })
    ).toBe('/api/v1/threads/thr_1/host-files/content?path=docs%2Fspec.pdf');
    expect(
      resolvePdfReadTarget('inbox.pdf', {
        kind: 'thread-storage',
        threadId: 'thr_1',
        environmentId: null,
        projectId: null
      })
    ).toBe('/api/v1/threads/thr_1/thread-storage/content?path=inbox.pdf');
  });

  it('falls back to the host preview when there is no thread', () => {
    expect(
      resolvePdfReadTarget('docs/spec.pdf', {
        kind: 'workspace',
        threadId: null,
        environmentId: null,
        projectId: 'p1'
      })
    ).toBeNull();
  });

  it('rejects non-PDF payloads', () => {
    expect(() => bytesFromFileResponse({ content: 'hello', encoding: 'utf8' })).toThrow(/not a PDF/);
    expect(() => bytesFromFileResponse(null)).toThrow(/not a PDF/);
    const pdf = `%PDF-1.4\n`;
    const utf8 = bytesFromFileResponse({ content: pdf, encoding: 'utf8' });
    expect(new TextDecoder().decode(utf8.slice(0, 4))).toBe('%PDF');
    const bytes = bytesFromFileResponse({ content: btoa(pdf), encoding: 'base64' });
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    const blob = pdfBlobFromFileResponse({ content: btoa(pdf), encoding: 'base64' });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(4);
  });
});
