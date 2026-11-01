import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCatalogIcon } from './catalog-icon.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'catalog-icon-'));
  roots.push(root);
  mkdirSync(join(root, 'icons'));
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('readCatalogIcon', () => {
  it.each([['svg', 'image/svg+xml'], ['PNG', 'image/png'], ['webp', 'image/webp'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif']])('embeds a declared %s image without needing an installed plugin', (extension, mime) => {
    const root = fixture();
    writeFileSync(join(root, `icons/logo.${extension}`), 'brand bytes');
    expect(readCatalogIcon(root, `./icons/logo.${extension}`)).toBe(`data:${mime};base64,${Buffer.from('brand bytes').toString('base64')}`);
  });

  it.each([undefined, 'Puzzle', 'https://example.com/logo.png', '/logo.png', './icons/logo.txt', './icons/missing.svg'])('falls back for %s', (icon) => {
    expect(readCatalogIcon(fixture(), icon)).toBeUndefined();
  });

  it('confines real paths, rejecting traversal and symlinks outside the plugin', () => {
    const root = fixture();
    const outside = fixture();
    writeFileSync(join(outside, 'secret.svg'), 'private');
    symlinkSync(join(outside, 'secret.svg'), join(root, 'icons/escape.svg'));
    expect(readCatalogIcon(root, './icons/escape.svg')).toBeUndefined();
    expect(readCatalogIcon(join(root, 'icons'), '../icons/escape.svg')).toBeUndefined();
    expect(readCatalogIcon(root, `./../${outside.split(/[\\/]/).pop()}/secret.svg`)).toBeUndefined();
  });

  it('rejects directories, empty images and oversized images; accepts the size limit', () => {
    const root = fixture();
    mkdirSync(join(root, 'dir.svg'));
    writeFileSync(join(root, 'empty.svg'), '');
    writeFileSync(join(root, 'huge.svg'), Buffer.alloc(64 * 1024 + 1));
    writeFileSync(join(root, 'limit.svg'), Buffer.alloc(64 * 1024));
    for (const name of ['dir', 'empty', 'huge']) expect(readCatalogIcon(root, `./${name}.svg`)).toBeUndefined();
    expect(readCatalogIcon(root, './limit.svg')).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
