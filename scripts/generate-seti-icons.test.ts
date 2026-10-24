import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSetiIcons, themePath } from './generate-seti-icons.mjs';

describe('generate-seti-icons', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('generates TypeScript icon mappings and CSS stylesheet from the real vendored theme', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-seti-test-'));
    roots.push(dir);

    const result = generateSetiIcons(themePath, dir);
    expect(result.ids.length).toBeGreaterThan(50);
    expect(result.fileNames['dockerfile']).toBeDefined();
    expect(result.fileExtensions['ts']).toBeDefined();

    const ts = readFileSync(join(dir, 'seti.generated.ts'), 'utf8');
    expect(ts).toContain('export const ICONS');
    expect(ts).toContain('export const DEFAULT_ICON');
    expect(ts).toContain('export const FILE_NAMES');
    expect(ts).toContain('export const FILE_EXTENSIONS');

    const css = readFileSync(join(dir, 'seti.generated.css'), 'utf8');
    expect(css).toContain("@font-face");
    expect(css).toContain(".seti-");
  });

  it('throws on unsafe icon id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-seti-test-'));
    roots.push(dir);
    const badTheme = join(dir, 'bad-theme.json');
    writeFileSync(badTheme, JSON.stringify({
      iconDefinitions: { 'bad id!': { fontCharacter: '\\e001', fontColor: '#fff' } },
      file: 'bad id!',
      fileNames: {},
      fileExtensions: {}
    }));

    expect(() => generateSetiIcons(badTheme, dir)).toThrow(/Unsafe icon id/);
  });

  it('throws on missing icon definition', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-seti-test-'));
    roots.push(dir);
    const missingTheme = join(dir, 'missing-theme.json');
    writeFileSync(missingTheme, JSON.stringify({
      iconDefinitions: {},
      file: 'missing',
      fileNames: {},
      fileExtensions: {}
    }));

    expect(() => generateSetiIcons(missingTheme, dir)).toThrow(/Missing icon definition/);
  });

  it('throws on ambiguous light icon mapping', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-seti-test-'));
    roots.push(dir);
    const ambiguousTheme = join(dir, 'ambiguous-theme.json');
    writeFileSync(ambiguousTheme, JSON.stringify({
      iconDefinitions: {
        dark1: { fontCharacter: '\\e001', fontColor: '#111' },
        light1: { fontCharacter: '\\e002', fontColor: '#222' },
        light2: { fontCharacter: '\\e003', fontColor: '#333' }
      },
      file: 'dark1',
      fileNames: { 'a.txt': 'dark1', 'b.txt': 'dark1' },
      fileExtensions: {},
      light: {
        file: 'light1',
        fileNames: { 'a.txt': 'light1', 'b.txt': 'light2' }
      }
    }));

    expect(() => generateSetiIcons(ambiguousTheme, dir)).toThrow(/Ambiguous light icon/);
  });
});
