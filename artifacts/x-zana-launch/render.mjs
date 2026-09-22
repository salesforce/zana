import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../..');
const sharp = createRequire(resolve(root, 'website/package.json'))('sharp');
const fairy = (await readFile(resolve(root, 'website/public/artwork/zana-fairy.svg'), 'utf8'))
  .replace('width="590" height="580"', 'x="904" y="135" width="626" height="615"');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" fill="none">
  <title>Meet Zana. Many agents. One clear view.</title>
  <desc>A midnight-blue introduction to Zana, an open-source IDE for AI coding agents, featuring its blue and lavender fairy, supported tools, and multi-project, agent-team, and plugin features.</desc>
  <defs>
    <linearGradient id="launchBg" x1="0" y1="0" x2="1600" y2="900" gradientUnits="userSpaceOnUse"><stop stop-color="#182b48"/><stop offset=".52" stop-color="#101b32"/><stop offset="1" stop-color="#0a1022"/></linearGradient>
    <radialGradient id="launchGlow"><stop stop-color="#6998e2" stop-opacity=".12"/><stop offset="1" stop-color="#6998e2" stop-opacity="0"/></radialGradient>
    <linearGradient id="launchType" x1="80" y1="410" x2="740" y2="500" gradientUnits="userSpaceOnUse"><stop stop-color="#a8eaff"/><stop offset="1" stop-color="#c0b9ff"/></linearGradient>
    <linearGradient id="launchRule" x1="80" y1="783" x2="1520" y2="783" gradientUnits="userSpaceOnUse"><stop stop-color="#93dfff" stop-opacity=".5"/><stop offset=".62" stop-color="#c0b9ff" stop-opacity=".25"/><stop offset="1" stop-color="#ffdb9e" stop-opacity=".4"/></linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#launchBg)"/>
  <ellipse cx="1260" cy="410" rx="560" ry="500" fill="url(#launchGlow)"/>
  <path d="M0 886C486 664 1167 1067 1600 630" stroke="#abcfff" stroke-opacity=".045" stroke-width="80"/>
  <g font-family="Arial, Helvetica, sans-serif">
    <path d="M92 68L96 80L108 84L96 88L92 100L88 88L76 84L88 80Z" fill="#ffdb9e"/>
    <text x="124" y="91" fill="#d2e0f3" font-size="20" font-weight="700" letter-spacing="3.1">MEET YOUR NEXT IDE</text>
    <rect x="1231" y="61" width="289" height="47" rx="23.5" fill="#ffdb9e" fill-opacity=".055" stroke="#ffdb9e" stroke-opacity=".22"/>
    <circle cx="1256" cy="84.5" r="4" fill="#ffdb9e"/>
    <text x="1273" y="91" fill="#ffdb9e" font-size="16" font-weight="700" letter-spacing="1.6">FREE &amp; OPEN SOURCE</text>
    <text x="77" y="297" fill="#f0f7ff" font-size="160" font-weight="700" letter-spacing="-8">Zana.</text>
    <text x="82" y="412" fill="#f0f7ff" font-size="66" font-weight="700" letter-spacing="-2">Many agents.</text>
    <text x="82" y="490" fill="url(#launchType)" font-size="66" font-weight="700" letter-spacing="-2">One clear view.</text>
    <text x="85" y="563" fill="#b7cbe2" font-size="27">Claude Code, Codex, Cursor &amp; more.</text>
    <text x="85" y="606" fill="#b7cbe2" font-size="27">Together across your projects.</text>
    <g fill="#14253e" stroke="#8eb6ef" stroke-opacity=".22">
      <rect x="85" y="657" width="174" height="49" rx="11"/>
      <rect x="275" y="657" width="164" height="49" rx="11"/>
      <rect x="455" y="657" width="125" height="49" rx="11"/>
    </g>
    <g fill="#d0dff1" font-size="20" font-weight="500" text-anchor="middle">
      <text x="172" y="688">Multi-project</text>
      <text x="357" y="688">Agent teams</text>
      <text x="517.5" y="688">Plugins</text>
    </g>
    <path d="M85 783H1516" stroke="url(#launchRule)"/>
    <text x="85" y="842" fill="#e0ebfa" font-size="25" font-weight="700">zana-ide.com</text>
    <text x="1516" y="842" fill="#a6bad5" font-size="22" text-anchor="end">Your tools. Your projects. Your control.</text>
  </g>
  ${fairy}
</svg>`;

await writeFile(resolve(dir, 'zana-launch.svg'), svg);
await sharp(Buffer.from(svg)).png().toFile(resolve(dir, 'zana-launch.png'));
const caption = 'Meet Zana ✨\nA new, open-source IDE for your AI coding agents.\n\nClaude Code, Codex, Cursor & more. Run agents across projects, coordinate teams and review results—all in one place.\n\nhttps://zana-ide.com\n\n#AI #Salesforce #AgenticAI #DevTools #OpenSource';
const alt = 'Meet Zana: Many agents. One clear view. A pearl-white fairy with blue and lavender wings and a golden spark appears on a midnight-blue background. Text highlights Claude Code, Codex, Cursor and more, with multi-project work, agent teams and plugins. Free and open source. zana-ide.com.';
await writeFile(resolve(dir, 'caption.txt'), caption + '\n');
await writeFile(resolve(dir, 'alt-text.txt'), alt + '\n');
const weighted = [...caption.replace('https://zana-ide.com', 'x'.repeat(23))].reduce((sum, char) => sum + (char.codePointAt(0) > 0x10ff ? 2 : 1), 0);
console.log(JSON.stringify({ image: resolve(dir, 'zana-launch.png'), ...await sharp(resolve(dir, 'zana-launch.png')).metadata(), captionWeightedEstimate: weighted, caption }, null, 2));
