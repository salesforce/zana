import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const sharp = createRequire(path.join(root, 'website/package.json'))('sharp');
const out = path.join(root, 'artifacts/zana-fairy-brand');
await mkdir(out, { recursive: true });
const source = await readFile('resources/icon.svg');
await sharp(source).png().toFile('resources/icon-1024.png');
const sizes = [
  ['16x16', 16], ['16x16@2x', 32],
  ['32x32', 32], ['32x32@2x', 64],
  ['128x128', 128], ['128x128@2x', 256],
  ['256x256', 256], ['256x256@2x', 512],
  ['512x512', 512], ['512x512@2x', 1024]
];
for (const [name, size] of sizes) {
  await sharp(source).resize(size, size).png().toFile('resources/icon.iconset/icon_' + name + '.png');
}
const badge = Buffer.from('<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect x="641" y="790" width="274" height="134" rx="44" fill="#ffe0a4" stroke="#172641" stroke-width="10"/><text x="778" y="882" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="800" font-size="78" fill="#172641">DEV</text></svg>');
await sharp(source).composite([{ input: badge }]).png().toFile('resources/icon-dev.png');
const favicon = await readFile('website/public/favicon.svg');
await sharp(favicon, { density: 288 }).resize(32,32).png().toFile('website/public/favicon-32.png');
await sharp(Buffer.from(favicon.toString().replace('rx="15"', 'rx="0"')), { density: 288 }).resize(180,180).flatten({ background: '#172641' }).png().toFile('website/public/apple-touch-icon.png');
await sharp(source).resize(512,512).png().toFile('website/public/zana-icon-512.png');

const app = 'data:image/png;base64,' + (await readFile('resources/icon-1024.png')).toString('base64');
const dev = 'data:image/png;base64,' + (await readFile('resources/icon-dev.png')).toString('base64');
const mark = 'data:image/svg+xml;base64,' + (await readFile('website/public/zana-mark.svg')).toString('base64');
const fav = 'data:image/svg+xml;base64,' + favicon.toString('base64');
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="960" viewBox="0 0 1440 960">
<rect width="1440" height="960" fill="#0b101c"/>
<circle cx="315" cy="390" r="390" fill="#111b30"/>
<text x="76" y="84" font-family="Helvetica,Arial,sans-serif" font-size="20" letter-spacing="4" fill="#a8c9ef">ZANA · THE AI FAIRY</text>
<text x="76" y="145" font-family="Helvetica,Arial,sans-serif" font-size="43" font-weight="600" fill="#f0f5ff">A little magic. A clear purpose.</text>
<text x="76" y="185" font-family="Helvetica,Arial,sans-serif" font-size="20" fill="#98a9c3">Luminous wings · connected intelligence · one golden spark</text>
<image href="${app}" x="42" y="215" width="625" height="625"/>
<text x="90" y="889" font-family="Helvetica,Arial,sans-serif" font-size="19" fill="#a6b5cb">macOS · 16–1024 px · transparent outer margin</text>

<rect x="745" y="244" width="620" height="136" rx="24" fill="#151e30" stroke="#2a3852"/>
<image href="${mark}" x="773" y="282" width="60" height="60"/>
<text x="854" y="320" font-family="Helvetica,Arial,sans-serif" font-size="31" font-weight="600" fill="#f1f6ff">Zana</text>
<text x="1225" y="318" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="#aabbd3">Website</text>

<rect x="745" y="403" width="620" height="136" rx="24" fill="#f3f6fc"/>
<image href="${mark}" x="773" y="441" width="60" height="60"/>
<text x="854" y="479" font-family="Helvetica,Arial,sans-serif" font-size="31" font-weight="600" fill="#172641">Zana</text>
<text x="1225" y="477" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="#51617a">Website</text>

<text x="748" y="605" font-family="Helvetica,Arial,sans-serif" font-size="17" letter-spacing="2" fill="#a8c9ef">SMALL, BUT STILL ZANA</text>
<image href="${fav}" x="751" y="657" width="16" height="16"/>
<image href="${mark}" x="804" y="654" width="22" height="22"/>
<image href="${fav}" x="865" y="649" width="32" height="32"/>
<image href="${app}" x="947" y="633" width="64" height="64"/>
<image href="${app}" x="1060" y="602" width="128" height="128"/>
<image href="${dev}" x="1230" y="602" width="128" height="128"/>
<g font-family="Helvetica,Arial,sans-serif" font-size="15" fill="#92a4c0" text-anchor="middle">
<text x="759" y="760">16</text><text x="815" y="760">22</text><text x="881" y="760">32</text><text x="979" y="760">64</text><text x="1124" y="760">128</text><text x="1294" y="760">DEV</text>
</g>
<path d="M747 811H1364" stroke="#29364d"/>
<text x="748" y="855" font-family="Helvetica,Arial,sans-serif" font-size="18" fill="#b9c7da">App icon + website mark + simplified favicon</text>
<text x="748" y="889" font-family="Helvetica,Arial,sans-serif" font-size="17" fill="#879bb8">Editable vector artwork · matching PNG and ICNS exports</text>
</svg>`;
await writeFile(path.join(out, 'preview.svg'), preview);
await sharp(Buffer.from(preview)).png().toFile(path.join(out, 'preview.png'));
console.log('Exported 10 macOS icon sizes, app/DEV PNGs, website assets, and preview.');
