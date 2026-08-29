import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACKED_BRIDGE_WORKER_FILE, packedBridgeBundleDir } from './packed-bridge-dir.js';

describe('packedBridgeBundleDir', () => {
  it('returns the directory when the worker file sits beside the caller', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-packed-bridge-'));
    writeFileSync(join(dir, PACKED_BRIDGE_WORKER_FILE), '');
    expect(packedBridgeBundleDir(pathToFileURL(join(dir, 'join.mjs')).href)).toBe(dir);
  });

  it('returns undefined when the packed worker is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-packed-bridge-missing-'));
    expect(packedBridgeBundleDir(pathToFileURL(join(dir, 'join.mjs')).href)).toBeUndefined();
  });
});
