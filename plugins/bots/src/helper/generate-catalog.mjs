import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../../', import.meta.url);
const output = new URL('./catalog.generated.json', import.meta.url);
const sources = [
  ['getting-started', 'Getting started', 'docs/getting-started.md'],
  ['using-zana', 'Using Zana', 'docs/using-zana.md'],
  ['history', 'Conversation history', 'docs/conversation-history.md'],
  ['bots', 'Bots', 'plugins/bots/PLUGIN_OVERVIEW.md'],
  ['slack', 'Using Zana in Slack', 'docs/slack-user-guide.md', 'slack-bridge-2ff2'],
];

const commitVersion = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
const release = `v${commitVersion}`;
const entries = sources.flatMap(([id, guide, path, plugin]) => {
  const doc = readFileSync(new URL(path, root), 'utf8').trim();
  const url = `https://github.com/salesforce/zana/blob/${release}/${path}`;
  return doc.split(/^(?=#{2,3} )/m).flatMap((section, index) => {
    const heading = /^(#{1,3}) (.+)\n/.exec(section);
    const title = heading?.[2] ?? guide;
    if (id === 'slack' && title === 'Try it now in the sandbox') return [];
    const text = section.slice(heading?.[0].length ?? 0).trim();
    if (!text) return [];
    const anchor = title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
    return [{
      id: `${id}-${anchor || index}`,
      guide,
      title,
      text,
      url: index ? `${url}#${anchor}` : url,
      ...(plugin ? { plugin } : {})
    }];
  });
});
const serialized = JSON.stringify({ version: commitVersion, entries }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== serialized) {
    console.error('Zana Helper catalog is stale. Run node ' + fileURLToPath(new URL(import.meta.url)));
    process.exitCode = 1;
  }
} else {
  writeFileSync(output, serialized);
}
