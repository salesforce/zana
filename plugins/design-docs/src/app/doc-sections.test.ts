import { describe, expect, it } from 'vitest';
import type { DesignDocSummary } from '../shared/contract.js';
import { buildSections, parseCollapsed, projectSwatch, toggleCollapsed } from './doc-sections.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };

function doc(id: string, patch: Partial<DesignDocSummary> = {}): DesignDocSummary {
  return {
    id,
    slug: id,
    title: id,
    summary: '',
    status: 'draft',
    projectId: null,
    tags: [],
    entryPath: 'README.md',
    fileCount: 1,
    openComments: 0,
    pinnedAt: null,
    alternativeTo: null,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    createdBy: actor,
    updatedBy: actor,
    ...patch
  };
}

const names = (id: string) => ({ p1: 'App', p2: 'Site' })[id] ?? 'Unknown project';
const shape = (sections: ReturnType<typeof buildSections>) =>
  sections.map((section) => [section.label, section.count, section.entries.map((entry) => [entry.doc.id, ...entry.alternatives.map((alt) => `alt:${alt.id}`)])]);

describe('buildSections', () => {
  it('puts pinned docs, then docs needing review, then projects in order of latest activity', () => {
    const docs = [
      doc('a', { projectId: 'p2' }),
      doc('b', { projectId: 'p1', openComments: 2 }),
      doc('c', { projectId: 'p1', pinnedAt: 5, openComments: 1 }),
      doc('d', { projectId: 'p1' }),
      doc('e'),
      doc('f', { projectId: 'p2' })
    ];
    expect(shape(buildSections(docs, { byProject: true, projectName: names }))).toEqual([
      ['Pinned', 1, [['c']]],
      ['Needs me', 1, [['b']]],
      ['Site', 2, [['a'], ['f']]],
      ['App', 1, [['d']]],
      ['Global', 1, [['e']]]
    ]);
  });

  it('lists the current project first and marks it', () => {
    const docs = [doc('a', { projectId: 'p2' }), doc('b', { projectId: 'p1' }), doc('c', { projectId: 'p1', openComments: 1 })];
    const sections = buildSections(docs, { byProject: true, projectName: names, currentProjectId: 'p1' });
    expect(shape(sections)).toEqual([
      ['Needs me', 1, [['c']]],
      ['App', 1, [['b']]],
      ['Site', 1, [['a']]]
    ]);
    expect(sections.map((section) => [section.projectId, section.current])).toEqual([
      [undefined, undefined],
      ['p1', true],
      ['p2', false]
    ]);
    // A current project with nothing left to list gets no empty section.
    expect(shape(buildSections([doc('c', { projectId: 'p1', openComments: 1 })], { byProject: true, projectName: names, currentProjectId: 'p1' }))).toEqual([
      ['Needs me', 1, [['c']]]
    ]);
  });

  it('colors projects stably', () => {
    expect(projectSwatch('p1')).toBe(projectSwatch('p1'));
    expect(projectSwatch('p1')).toMatch(/^hsl\(\d+ 62% 52%\)$/);
    expect(projectSwatch(null)).toBe('var(--text-dim)');
  });

  it('keeps one timeline when not grouping by project', () => {
    const docs = [doc('a', { projectId: 'p2' }), doc('b', { projectId: 'p1' })];
    const sections = buildSections(docs, { byProject: false, projectName: names });
    expect(shape(sections)).toEqual([['Recent', 2, [['a'], ['b']]]]);
    expect(sections[0]!.kind).toBe('recent');
    expect(buildSections([], { byProject: false, projectName: names })).toEqual([]);
  });

  it('nests alternatives under the doc they point at, wherever it is listed', () => {
    const docs = [
      doc('alt1', { alternativeTo: 'root', projectId: 'p1' }),
      doc('root', { pinnedAt: 1, projectId: 'p1' }),
      doc('orphan', { alternativeTo: 'gone', projectId: 'p1' }),
      doc('alt2', { alternativeTo: 'root', projectId: 'p2', openComments: 3 }),
      doc('self', { alternativeTo: 'self' })
    ];
    expect(shape(buildSections(docs, { byProject: true, projectName: names }))).toEqual([
      ['Pinned', 3, [['root', 'alt:alt1', 'alt:alt2']]],
      ['App', 1, [['orphan']]],
      ['Global', 1, [['self']]]
    ]);
  });
});

describe('collapsed sections', () => {
  it('toggles keys and tolerates bad stored values', () => {
    const once = toggleCollapsed('[]', 'pinned');
    expect([...parseCollapsed(once)]).toEqual(['pinned']);
    expect([...parseCollapsed(toggleCollapsed(once, 'pinned'))]).toEqual([]);
    expect([...parseCollapsed('not json')]).toEqual([]);
    expect([...parseCollapsed('{"a":1}')]).toEqual([]);
    expect([...parseCollapsed('["a", 2]')]).toEqual(['a']);
  });
});
