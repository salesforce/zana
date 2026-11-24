import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { browseGuides, helpCatalog } from './catalog.js';

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
