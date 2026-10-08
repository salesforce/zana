// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crc32 } from '../shared/zip.js';
import { saveBytes, siteZip } from './download.js';

/** Names and bytes of a stored archive, in order. */
function entries(archive: Uint8Array): Array<{ path: string; data: Uint8Array }> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const out = [];
  let cursor = 0;
  while (view.getUint32(cursor, true) === 0x04034b50) {
    const size = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const path = new TextDecoder().decode(archive.subarray(cursor + 30, cursor + 30 + nameLength));
    const data = archive.slice(cursor + 30 + nameLength, cursor + 30 + nameLength + size);
    expect(crc32(data)).toBe(view.getUint32(cursor + 14, true));
    out.push({ path, data });
    cursor += 30 + nameLength + size;
  }
  return out;
}

describe('download', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('zips site files under one folder named after the doc, decoding binary files', () => {
    const zip = siteZip('payments-api', [
      { path: 'index.html', content: '<h1>Pay</h1>', encoding: 'utf8' },
      { path: 'logo.png', content: btoa(String.fromCharCode(0x89, 0x50, 0, 255)), encoding: 'base64' }
    ]);
    const files = entries(zip);
    expect(files.map((file) => file.path)).toEqual(['payments-api/index.html', 'payments-api/logo.png']);
    expect(new TextDecoder().decode(files[0]!.data)).toBe('<h1>Pay</h1>');
    expect([...files[1]!.data]).toEqual([0x89, 0x50, 0, 255]);
  });

  it('saves bytes through a hidden download link, then frees the object URL', async () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const create = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:zip';
    });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let clicked: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
      expect(this.isConnected).toBe(true);
    });

    saveBytes('doc.zip', new Uint8Array([1, 2, 3]), 'application/zip');

    expect(clicked!.download).toBe('doc.zip');
    expect(clicked!.getAttribute('href')).toBe('blob:zip');
    expect(clicked!.isConnected).toBe(false);
    expect(blobs[0]!.type).toBe('application/zip');
    expect(blobs[0]!.size).toBe(3);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledWith('blob:zip');
  });
});
