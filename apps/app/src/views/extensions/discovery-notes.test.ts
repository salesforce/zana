import { expect, it } from 'vitest';
import { dedupeDiscoveryNotes } from './discovery-notes.js';

const msg = (path: string, line: number, reason = 'bad yaml') =>
  `Invalid frontmatter in ${path} (line ${line}): ${reason}`;

it('strips the harness prefix and merges the same file across harnesses', () => {
  const out = dedupeDiscoveryNotes([
    `Claude Code: ${msg('/a/SKILL.md', 2)}`,
    `Codex: ${msg('/a/SKILL.md', 3)}`,
    msg('/a/SKILL.md', 4)
  ]);
  expect(out).toEqual([{ key: '/a/SKILL.md\0bad yaml', text: msg('/a/SKILL.md', 2) }]);
});
it('keeps distinct paths and distinct reasons separate, in first-seen order', () => {
  const out = dedupeDiscoveryNotes([
    msg('/b/SKILL.md', 1),
    msg('/a/SKILL.md', 1),
    msg('/a/SKILL.md', 1, 'other reason'),
    msg('/b/SKILL.md', 9)
  ]);
  expect(out.map((n) => n.key)).toEqual([
    '/b/SKILL.md\0bad yaml',
    '/a/SKILL.md\0bad yaml',
    '/a/SKILL.md\0other reason'
  ]);
});
it('passes unparseable notes through, deduped by text, without touching other prefixes', () => {
  const out = dedupeDiscoveryNotes(['Listing reached its limit', 'Listing reached its limit', 'Host: offline']);
  expect(out).toEqual([
    { key: 'Listing reached its limit', text: 'Listing reached its limit' },
    { key: 'Host: offline', text: 'Host: offline' }
  ]);
});
it('returns an empty list for no notes', () => {
  expect(dedupeDiscoveryNotes([])).toEqual([]);
});
