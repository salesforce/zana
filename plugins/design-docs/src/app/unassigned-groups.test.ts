import { describe, expect, it } from 'vitest';
import type { DesignDocSummary } from '../shared/contract.js';
import type { UnassignedProject } from './api.js';
import { buildUnassignedGroups, cleanPeerText, foldLabel, groupLabel, headingLabel, MAX_GROUP_LABEL, OTHER_KEY, UNNAMED_PROJECT } from './unassigned-groups.js';

let clock = 1000;
function doc(title: string, foreignProjectId?: unknown, updatedAt = clock++): DesignDocSummary {
  return { id: `d_${title}_${updatedAt}`, title, updatedAt, foreignProjectId } as unknown as DesignDocSummary;
}
function project(id: string, extra: Partial<UnassignedProject> = {}): UnassignedProject {
  return { foreignProjectId: id, docCount: 1, sampleTitles: [], senderName: null, senderTag: null, suggestion: null, ...extra };
}
const build = (docs: DesignDocSummary[], projects: UnassignedProject[], local: string[] = [], opts = { cap: 200 } as { cap: number; labels?: 'ready' | 'loading' | 'failed' }) =>
  buildUnassignedGroups(docs, projects, local, opts);

describe('labels', () => {
  it('uses sender name, else first title, else Unnamed project', () => {
    expect(groupLabel(project('a', { senderName: 'Billing', sampleTitles: ['T'] })).label).toBe('Billing');
    expect(groupLabel(project('a', { sampleTitles: ['First', 'Second'] })).label).toBe('First');
    expect(groupLabel(project('a')).label).toBe(UNNAMED_PROJECT);
    expect(groupLabel(project('a'), 'Doc title').label).toBe('Doc title');
    expect(headingLabel(project('a', { senderName: '  ' , sampleTitles: ['X'] }))).toBe('X');
  });

  it('never reads the suggestion for the label', () => {
    const base = project('a', { senderName: 'Peer', sampleTitles: ['T'] });
    const withSuggestion = { ...base, suggestion: { projectId: 'p', name: 'Local', basis: 'name' as const } };
    expect(groupLabel(withSuggestion).label).toBe(groupLabel(base).label);
    expect(groupLabel(withSuggestion).suggestedName).toBe('Local');
    expect(groupLabel(base).suggestedName).toBeNull();
    const unnamed = project('a', { suggestion: { projectId: 'p', name: 'Local', basis: 'tag' } });
    expect(groupLabel(unnamed).label).toBe(UNNAMED_PROJECT);
  });

  it('sanitizes hostile and long peer text', () => {
    expect(cleanPeerText('A‮B​C\u{e0041}ㅤ')).toBe('ABC');
    expect(cleanPeerText('ㅤ⠀ ')).toBeNull();
    expect(cleanPeerText(null)).toBeNull();
    expect(cleanPeerText('Z' + '̀'.repeat(30))).toBe('Z̀̀̀');
    expect(Array.from(cleanPeerText('n'.repeat(5000))!)).toHaveLength(MAX_GROUP_LABEL);
    expect(cleanPeerText(`${'a'.repeat(79)} ${'b'.repeat(9)}`)).toBe('a'.repeat(79));
  });

  it('folds case, width, whitespace and lookalike letters', () => {
    expect(foldLabel('Ａｐｐ  ＳＩＴＥ')).toBe('app site');
    expect(foldLabel('аpp')).toBe('app'); // Cyrillic a
    expect(foldLabel('ΑΡΡ'.toLowerCase())).toBe('app'); // Greek alpha, rho, rho
  });
});

describe('grouping', () => {
  it('makes one group per foreign project and joins labels by id', () => {
    const docs = [doc('a1', 'f1'), doc('b1', 'f2'), doc('a2', 'f1')];
    const groups = build(docs, [project('f1', { senderName: 'Alpha' }), project('f2', { senderName: 'Beta' })]);
    expect(groups.map((g) => [g.label, g.docs.length])).toEqual([['Alpha', 2], ['Beta', 1]]); // a2 is the newest doc
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.label === 'Alpha')!.docs).toHaveLength(2);
    expect(groups.every((g) => g.key.startsWith('unassigned:') && !g.pending && !g.capped)).toBe(true);
  });

  it('keeps membership from docs: missing project rows fall back to the first doc title, extra rows are ignored', () => {
    const groups = build([doc('Orphan title', 'zz')], [project('other', { senderName: 'Ghost' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: 'Orphan title', suggestedName: null, foreignProjectId: 'zz' });
  });

  it('sends docs without a usable id to a trailing Other group', () => {
    const groups = build([doc('n', undefined, 5000), doc('num', 123, 4000), doc('empty', '', 3000), doc('x', 'f1', 1)], [project('f1', { senderName: 'Alpha' })]);
    expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Other']);
    expect(groups[1]).toMatchObject({ key: OTHER_KEY, foreignProjectId: null });
    expect(groups[1]!.docs).toHaveLength(3);
  });

  it('orders by newest doc, then label, then id', () => {
    const docs = [doc('b', 'fb', 10), doc('a', 'fa', 10), doc('c', 'fc', 20), doc('d', 'fd', 10)];
    const groups = build(docs, [project('fa', { senderName: 'Same' }), project('fb', { senderName: 'Same' }), project('fd', { senderName: 'Zed' })]);
    expect(groups.map((g) => g.foreignProjectId)).toEqual(['fc', 'fa', 'fb', 'fd']);
  });

  it('flags capped lists on every group and not otherwise', () => {
    const docs = [doc('a', 'f1'), doc('b', 'f2'), doc('c')];
    expect(build(docs, [], [], { cap: 3 }).every((g) => g.capped)).toBe(true);
    expect(build(docs, [], [], { cap: 4 }).some((g) => g.capped)).toBe(false);
    expect(build(docs, [], [], { cap: 0 }).some((g) => g.capped)).toBe(false);
  });

  it('exposes the suggestion basis only as a suggestion, leaving the label untouched', () => {
    const p = project('f1', { senderName: 'Peer', suggestion: { projectId: 'p', name: 'App', basis: 'tag' } });
    const [group] = build([doc('x', 'f1')], [p], ['App']);
    expect(group).toMatchObject({ label: 'Peer', suggestedName: 'App', suggestionBasis: 'tag' });
    const [bare] = build([doc('x', 'f1')], [project('f1', { senderName: 'Peer' })], ['App']);
    expect(bare).toMatchObject({ label: 'Peer', suggestedName: null, suggestionBasis: null });
  });
});

describe('loading and failure', () => {
  it('marks groups pending without suggestions or suffixes while loading', () => {
    const docs = [doc('same', 'f1'), doc('same', 'f2')];
    const groups = build(docs, [project('f1', { senderName: 'X', suggestion: { projectId: 'p', name: 'App', basis: 'name' } })], [], { cap: 200, labels: 'loading' });
    expect(groups.every((g) => g.pending && g.suggestedName === null)).toBe(true);
    expect(groups.map((g) => g.label)).toEqual(['same', 'same']);
  });

  it('falls back to the first doc title when the label source failed', () => {
    const groups = build([doc('First doc', 'f1')], [project('f1', { senderName: 'Ignored' })], [], { cap: 200, labels: 'failed' });
    expect(groups[0]).toMatchObject({ label: 'First doc', pending: false, suggestedName: null });
  });
});

describe('collisions', () => {
  it('suffixes a sender named like a local Project, by tag then by number', () => {
    const tagged = build([doc('x', 'f1')], [project('f1', { senderName: 'App', senderTag: 'peer-a' })], ['app']);
    expect(tagged[0]!.label).toBe('App (peer-a)');
    const numbered = build([doc('x', 'f1')], [project('f1', { senderName: 'App' })], ['app']);
    expect(numbered[0]!.label).toBe('App #1');
  });

  it('folds lookalike, fullwidth and own-suggestion matches', () => {
    expect(build([doc('x', 'f1')], [project('f1', { senderName: 'Ａpp' })], ['app'])[0]!.label).toBe('Ａpp #1');
    expect(build([doc('x', 'f1')], [project('f1', { senderName: 'аpp' })], ['App'])[0]!.label).toBe('аpp #1');
    const own = project('f1', { senderName: 'Site', suggestion: { projectId: 'p', name: 'site', basis: 'name' } });
    expect(build([doc('x', 'f1')], [own], [])[0]!.label).toBe('Site #1');
  });

  it('numbers two groups sharing a label by sorted id, stable across a filtered doc list', () => {
    const projects = [project('f2', { senderName: 'Shared' }), project('f1', { senderName: 'Shared' })];
    const both = build([doc('a', 'f1'), doc('b', 'f2')], projects);
    expect(both.map((g) => [g.foreignProjectId, g.label]).sort()).toEqual([['f1', 'Shared #1'], ['f2', 'Shared #2']]);
    const filtered = build([doc('b', 'f2')], projects);
    expect(filtered[0]!.label).toBe('Shared #2'); // sibling hidden by search keeps its number
  });

  it('uses tags when they disambiguate, else falls back to numbers', () => {
    const distinct = build([doc('a', 'f1'), doc('b', 'f2')], [project('f1', { senderName: 'Shared', senderTag: 't1' }), project('f2', { senderName: 'Shared', senderTag: 't2' })]);
    expect(distinct.map((g) => g.label).sort()).toEqual(['Shared (t1)', 'Shared (t2)']);
    const same = build([doc('a', 'f1'), doc('b', 'f2')], [project('f1', { senderName: 'Shared', senderTag: 't' }), project('f2', { senderName: 'Shared', senderTag: 't' })]);
    expect(same.map((g) => g.label).sort()).toEqual(['Shared #1', 'Shared #2']);
    const tagIsLocal = build([doc('a', 'f1')], [project('f1', { senderName: 'App', senderTag: 'x' })], ['app', 'App (x)']);
    expect(tagIsLocal[0]!.label).toBe('App #1');
  });

  it('keeps numeric suffixes when a same-tag sibling is filtered out of the doc list', () => {
    const projects = [project('f1', { senderName: 'Shared', senderTag: 't' }), project('f2', { senderName: 'Shared', senderTag: 't' })];
    const filtered = build([doc('a', 'f1')], projects);
    expect(filtered[0]!.label).toBe('Shared #1'); // not 'Shared (t)', which the unfiltered list never shows
  });

  it('never generates a label that equals a local Project or another group', () => {
    const local = build([doc('x', 'f1')], [project('f1', { senderName: 'App' })], ['app', 'App #1']);
    expect(local[0]!.label).toBe('App #2');
    const projects = [project('f1', { senderName: 'App' }), project('f2', { senderName: 'App' }), project('f3', { senderName: 'App #1' })];
    const groups = build([doc('a', 'f1'), doc('b', 'f2'), doc('c', 'f3')], projects, ['app']);
    const labels = groups.map((g) => g.label);
    expect(new Set(labels.map(foldLabel)).size).toBe(3);
    expect(labels.map(foldLabel)).not.toContain('app');
    const tagged = build([doc('a', 'f1')], [project('f1', { senderName: 'Site', senderTag: 'x' }), project('f2', { senderName: 'Site' }), project('f3', { senderName: 'Site (x)' })]);
    expect(tagged[0]!.label).toBe('Site #1'); // 'Site (x)' is another group's label
  });

  it('does not suffix unique labels', () => {
    const groups = build([doc('a', 'f1'), doc('b', 'f2')], [project('f1', { senderName: 'One' }), project('f2', { senderName: 'Two' })], ['Other project']);
    expect(groups.map((g) => g.label).sort()).toEqual(['One', 'Two']);
  });
});
