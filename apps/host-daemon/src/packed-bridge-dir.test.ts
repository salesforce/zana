import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

  it('returns undefined when the packed worker and checkout bundle are absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-packed-bridge-missing-'));
    const previous = process.cwd();
    process.chdir(dir);
    try {
      expect(packedBridgeBundleDir(pathToFileURL(join(dir, 'join.mjs')).href)).toBeUndefined();
    } finally {
      process.chdir(previous);
    }
  });

  it('uses the checkout host-daemon bundle in an unpackaged built app', () => {
    const checkout = mkdtempSync(join(tmpdir(), 'zcc-packed-bridge-checkout-'));
    const dist = join(checkout, 'apps', 'host-daemon', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, PACKED_BRIDGE_WORKER_FILE), '');
    const previous = process.cwd();
    process.chdir(checkout);
    try {
      const caller = mkdtempSync(join(tmpdir(), 'zcc-packed-bridge-caller-'));
      expect(packedBridgeBundleDir(pathToFileURL(join(caller, 'main.js')).href)).toBe(join(process.cwd(), 'apps', 'host-daemon', 'dist'));
    } finally {
      process.chdir(previous);
    }
  });

  it('falls back to process.resourcesPath/host-bridge for the packaged app', () => {
    const resources = mkdtempSync(join(tmpdir(), 'zcc-packed-bridge-resources-'));
    const bundled = join(resources, 'host-bridge');
    mkdirSync(bundled);
    writeFileSync(join(bundled, PACKED_BRIDGE_WORKER_FILE), '');
    const previous = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resources });
    try {
      const missing = mkdtempSync(join(tmpdir(), 'zcc-packed-bridge-caller-'));
      expect(packedBridgeBundleDir(pathToFileURL(join(missing, 'join.mjs')).href)).toBe(bundled);
    } finally {
      if (previous) Object.defineProperty(process, 'resourcesPath', previous);
      else delete (process as { resourcesPath?: string }).resourcesPath;
    }
  });
});
