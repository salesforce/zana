#!/usr/bin/env node
/** Export the approved SVG masters. Run from any directory; requires website's Sharp. */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (file) => resolve(root, file);
const sharp = createRequire(at('website/package.json'))('sharp');
const icon = await readFile(at('resources/icon.svg'));
const glyph = await readFile(at('resources/zana-glyph.svg'), 'utf8');
const favicon = await readFile(at('website/public/favicon.svg'), 'utf8');
await mkdir(at('resources/icon.iconset'), { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    await sharp(icon).resize(size * scale).png().toFile(
      at(`resources/icon.iconset/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)
    );
  }
}
await sharp(icon).png().toFile(at('resources/icon-1024.png'));
const badge = Buffer.from('<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect x="641" y="790" width="274" height="134" rx="44" fill="#ffe0a4" stroke="#172641" stroke-width="10"/><text x="778" y="882" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="800" font-size="78" fill="#172641">DEV</text></svg>');
await sharp(icon).composite([{ input: badge }]).png().toFile(at('resources/icon-dev.png'));
await sharp(icon).resize(512).png().toFile(at('website/public/zana-icon-512.png'));
await sharp(Buffer.from(favicon), { density: 288 }).resize(32).png().toFile(at('website/public/favicon-32.png'));
await sharp(Buffer.from(favicon.replace('rx="15"', 'rx="0"')), { density: 288 })
  .resize(180).flatten({ background: '#172641' }).png().toFile(at('website/public/apple-touch-icon.png'));
await copyFile(at('website/public/favicon.svg'), at('apps/app/src/assets/zana-favicon.svg'));
await copyFile(at('resources/zana-glyph.svg'), at('apps/app/src/assets/zana-glyph.svg'));

// The tray uses a pre-rendered alpha mask: no filesystem access or SVG renderer at runtime.
const { data, info } = await sharp(Buffer.from(glyph), { density: 288 })
  .resize(36, 36).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const alpha = Buffer.alloc(info.width * info.height);
for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = data[pixel * info.channels + info.channels - 1];
await mkdir(at('apps/desktop/src/generated'), { recursive: true });
await writeFile(at('apps/desktop/src/generated/zana-glyph.ts'),
  '// Generated from resources/zana-glyph.svg by scripts/generate-brand-assets.mjs.\n' +
  'export const FAIRY_GLYPH_SIZE = 36;\n' +
  `export const FAIRY_GLYPH_ALPHA = '${alpha.toString('base64')}';\n`);
const path = glyph.match(/\sd="([^"]+)"/)?.[1];
if (!path) throw new Error('The fairy glyph must contain a path');
await writeFile(at('packages/streamdeck/src/deck/fairy-path.ts'),
  '// Generated from resources/zana-glyph.svg by scripts/generate-brand-assets.mjs.\n' +
  `export const FAIRY_PATH = '${path}';\n`);
console.log('Exported app, website, menu-bar, and Stream Deck branding. Run iconutil to refresh resources/icon.icns.');
