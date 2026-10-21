import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { mainClaudeBinary, mainClaudeBinaryGetter } from '../main-claude-binary.js';

const cfg = (c: unknown): AppConfig => c as AppConfig;

describe('mainClaudeBinary', () => {
  it('prefers the canonical harness binary over the flat field', () => {
    expect(mainClaudeBinary(cfg({ claudeBinary: '/flat', harnesses: { byId: { claude: { binary: '/canon' } } } }))).toBe('/canon');
  });
  it('uses the flat field when there is no canonical binary', () => {
    expect(mainClaudeBinary(cfg({ claudeBinary: '/flat', harnesses: { byId: { claude: {} } } }))).toBe('/flat');
  });
  it('trims whitespace', () => {
    expect(mainClaudeBinary(cfg({ claudeBinary: '  /flat  ' }))).toBe('/flat');
  });
  it('defaults to claude for an empty config', () => {
    expect(mainClaudeBinary(cfg({}))).toBe('claude');
  });
});

describe('mainClaudeBinaryGetter', () => {
  it('re-reads the store on every call', () => {
    let current = cfg({ claudeBinary: '/one' });
    const get = mainClaudeBinaryGetter({ getConfig: () => current });
    expect(get()).toBe('/one');
    current = cfg({ claudeBinary: '/two' });
    expect(get()).toBe('/two');
  });
});

describe('mainClaudeBinaryGetter with a config file', () => {
  it('caches until the config file changes, then re-resolves on the next call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcb-'));
    try {
      const file = join(dir, 'config.json');
      writeFileSync(file, '{"claudeBinary":"/one"}');
      let current = cfg({ claudeBinary: '/one' });
      const getConfig = vi.fn(() => current);
      const get = mainClaudeBinaryGetter({ getConfig }, file);
      expect(get()).toBe('/one');
      expect(get()).toBe('/one');
      expect(getConfig).toHaveBeenCalledTimes(1);
      // An atomic write (tmp + rename) changes the stamp.
      current = cfg({ claudeBinary: '/two-longer' });
      writeFileSync(join(dir, 'tmp'), '{"claudeBinary":"/two-longer"}');
      renameSync(join(dir, 'tmp'), file);
      expect(get()).toBe('/two-longer');
      expect(get()).toBe('/two-longer');
      expect(getConfig).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not cache while the file is missing-then-created', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcb-'));
    try {
      const file = join(dir, 'config.json');
      let current = cfg({});
      const getConfig = vi.fn(() => current);
      const get = mainClaudeBinaryGetter({ getConfig }, file);
      expect(get()).toBe('claude');
      expect(get()).toBe('claude');
      expect(getConfig).toHaveBeenCalledTimes(1);
      current = cfg({ claudeBinary: '/new' });
      writeFileSync(file, '{}');
      expect(get()).toBe('/new');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
