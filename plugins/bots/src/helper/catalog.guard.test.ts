import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { browseGuides, GUIDE_REPOSITORY, guideMarkdown, helpCatalog } from './catalog.js';

it('builds the offline catalog from the current user guides and product version', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('./generate-catalog.mjs', import.meta.url)), '--check']);
});

it('finds help for the supported first-run, scheduling, and provider questions', () => {
  expect(browseGuides(helpCatalog.entries, 'How do I add a project?').slice(0, 4))
    .toEqual(expect.arrayContaining([expect.objectContaining({ guide: 'Getting started', title: '2. Add a project' })]));
  expect(browseGuides(helpCatalog.entries, 'How do I schedule a task?').slice(0, 4))
    .toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Scheduler' })]));
  expect(browseGuides(helpCatalog.entries, 'Which provider does my bot use?').slice(0, 4))
    .toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Choose a bot provider' })]));
  expect(browseGuides(helpCatalog.entries, 'notarealfeature')).toEqual([]);
  expect(browseGuides(helpCatalog.entries, '')).toHaveLength(helpCatalog.entries.length);
  expect(new Set(helpCatalog.entries.map(row => row.id)).size).toBe(helpCatalog.entries.length);
});

it('resolves inline guide links at the matching ref and keeps public site and external URLs', () => {
  const ref = `v${helpCatalog.version}`;
  const prefix = `${GUIDE_REPOSITORY}${ref}/docs/`;
  const guide = helpCatalog.entries.find(entry => entry.text.includes('(remote-conversation-presentation.md)'))!;
  expect(guideMarkdown(guide.text, guide.url)).toContain(`[remote presentation support](${prefix}remote-conversation-presentation.md)`);
  const source = `${prefix}slack-user-guide.md#old-heading`;
  expect(guideMarkdown([
    '[Another file](./slackbot-app.md#setup "Slack setup")',
    '[Same file](#another-heading)',
    '[Install](/download)',
    '[GitHub](https://github.com/salesforce/zana)',
    '[Network link](//example.test/help)',
    '[Escaped path](folder\\help.md)'
  ].join('\n'), source)).toBe([
    `[Another file](${prefix}slackbot-app.md#setup "Slack setup")`,
    `[Same file](${prefix}slack-user-guide.md#another-heading)`,
    '[Install](https://zana-ide.com/download)',
    '[GitHub](https://github.com/salesforce/zana)',
    '[Network link](//example.test/help)',
    '[Escaped path](folder\\help.md)'
  ].join('\n'));
});
