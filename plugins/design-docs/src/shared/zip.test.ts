import { describe, expect, it } from 'vitest';
import { crc32, zipFiles } from './zip.js';

const text = (value: string) => new TextEncoder().encode(value);

/** Reads a stored (uncompressed) archive back through its central directory. */
function unzip(archive: Uint8Array) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = archive.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  expect(cursor + centralSize).toBe(end);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const time = view.getUint16(cursor + 12, true);
    const date = view.getUint16(cursor + 14, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const local = view.getUint32(cursor + 42, true);
    const path = new TextDecoder().decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint16(local + 26, true)).toBe(nameLength);
    const start = local + 30 + nameLength;
    const data = archive.slice(start, start + size);
    expect(crc32(data)).toBe(crc);
    entries.push({ path, data, flags, method, time, date });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('stores every file, UTF-8 names and binary data included, readable from the central directory', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    const at = new Date(2026, 9, 8, 14, 30, 41);
    const entries = unzip(
      zipFiles(
        [
          { path: 'doc/index.html', data: text('<p>héllo</p>') },
          { path: 'doc/images/schéma.png', data: png },
          { path: 'doc/.nojekyll', data: new Uint8Array() }
        ],
        at
      )
    );
    expect(entries.map((entry) => entry.path)).toEqual(['doc/index.html', 'doc/images/schéma.png', 'doc/.nojekyll']);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('<p>héllo</p>');
    expect([...entries[1]!.data]).toEqual([...png]);
    expect(entries[2]!.data.length).toBe(0);
    for (const entry of entries) {
      expect(entry.flags).toBe(0x0800);
      expect(entry.method).toBe(0);
      expect(entry.time).toBe((14 << 11) | (30 << 5) | 20);
      expect(entry.date).toBe((46 << 9) | (10 << 5) | 8);
    }
  });

  it('writes an empty archive, and dates before 1980 as 1980', () => {
    expect(unzip(zipFiles([]))).toEqual([]);
    const [entry] = unzip(zipFiles([{ path: 'a.txt', data: text('a') }], new Date(1970, 0, 1)));
    expect(entry!.date >> 9).toBe(0);
  });
});
