import { describe, expect, it } from 'vitest';
import {
  buildCommandSuggestions,
  buildMentionSuggestions,
  commandsFromComposerActions,
  commandsFromPluginSkills,
  mergeCommandCatalogs,
  mentionOrder,
  rankSuggestions
} from './filter-composer-suggestions.js';
import type { TypeaheadSuggestion } from './types.js';

const files: TypeaheadSuggestion[] = [
  { kind: 'path', path: 'src/foo.ts', name: 'foo.ts', entryKind: 'file' },
  { kind: 'path', path: 'README.md', name: 'README.md', entryKind: 'file' },
  { kind: 'path', path: 'apps/app/src/bar.ts', name: 'bar.ts', entryKind: 'file' }
];

const commands: TypeaheadSuggestion[] = [
  { kind: 'command', name: '/plan', description: 'Enter plan mode' },
  { kind: 'command', name: '/goal', description: 'Set a goal' }
];

describe('rankSuggestions', () => {
  it('returns the first N items when the query is empty', () => {
    expect(rankSuggestions(files, '', 2).map((row) => row.kind === 'path' ? row.path : '')).toEqual([
      'src/foo.ts',
      'README.md'
    ]);
  });

  it('fuzzy-filters file paths', () => {
    expect(rankSuggestions(files, 'readme').map((row) => row.kind === 'path' ? row.path : '')).toEqual([
      'README.md'
    ]);
  });

  it('matches command names and descriptions', () => {
    expect(rankSuggestions(commands, 'goal').map((row) => row.kind === 'command' ? row.name : '')).toEqual([
      '/goal'
    ]);
    expect(rankSuggestions(commands, 'plan').map((row) => row.kind === 'command' ? row.name : '')).toEqual([
      '/plan'
    ]);
  });
});

describe('mentionOrder', () => {
  it('lists threads then projects then files', () => {
    const ordered = mentionOrder([
      { kind: 'path', path: 'a.ts', name: 'a.ts', entryKind: 'file' },
      { kind: 'project', projectId: 'p1', name: 'Alpha' },
      { kind: 'thread', threadId: 't1', projectId: 'p1', title: 'Work' }
    ]);
    expect(ordered.map((row) => row.kind)).toEqual(['thread', 'project', 'path']);
  });
});

describe('buildMentionSuggestions', () => {
  it('ranks and caps mixed mention sources', () => {
    const rows = buildMentionSuggestions({
      query: 'al',
      paths: [{ path: 'src/alpha.ts', name: 'alpha.ts', entryKind: 'file' }],
      threads: [{ id: 't1', projectId: 'p1', title: 'Alpha review', projectName: 'Zana' }],
      projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Other' }]
    });
    expect(rows.map((row) => row.kind)).toEqual(['thread', 'project', 'path']);
    expect(rows[0]).toMatchObject({ kind: 'thread', title: 'Alpha review', projectName: 'Zana' });
  });

  it('matches a thread by project name when the title does not', () => {
    const rows = buildMentionSuggestions({
      query: 'zana',
      paths: [],
      threads: [{ id: 't1', projectId: 'p1', title: 'Hello', projectName: 'Zana' }],
      projects: []
    });
    expect(rows).toEqual([
      { kind: 'thread', threadId: 't1', projectId: 'p1', title: 'Hello', projectName: 'Zana' }
    ]);
  });
});

describe('buildCommandSuggestions', () => {
  it('filters the provider catalog by query and hides non-matches', () => {
    expect(buildCommandSuggestions([
      { name: '/plan', description: 'Enter plan mode' },
      { name: 'goal', description: 'Set a goal' }
    ], 'goa').map((row) => row.kind === 'command' ? row.name : '')).toEqual(['/goal']);
    expect(buildCommandSuggestions([{ name: '/plan', description: 'Enter plan mode' }], 'xyz')).toEqual([]);
  });
});

describe('commandsFromComposerActions', () => {
  it('turns provider actions into slash catalog rows', () => {
    expect(commandsFromComposerActions(['plan', '/goal'], 'Claude Code')).toEqual([
      { name: '/plan', description: 'Claude Code plan' },
      { name: '/goal', description: 'Claude Code goal' }
    ]);
  });
});

describe('commandsFromPluginSkills', () => {
  it('turns enabled plugin skills into slash catalog rows', () => {
    expect(commandsFromPluginSkills([
      {
        name: 'Salesforce',
        enabled: true,
        skillNames: ['salesforce-dx', 'salesforce-constitution']
      },
      { name: 'Disabled', enabled: false, skillNames: ['hidden'] },
      { name: 'Empty', enabled: true, skillNames: [] }
    ])).toEqual([
      { name: '/salesforce-dx', description: 'Salesforce' },
      { name: '/salesforce-constitution', description: 'Salesforce' }
    ]);
  });
});

describe('mergeCommandCatalogs', () => {
  it('keeps the first description for a slash name across catalogs', () => {
    expect(mergeCommandCatalogs([
      [{ name: 'plan', description: 'Fallback plan' }],
      [{ name: '/plan', description: 'HTTP plan' }, { name: '/commit', description: 'Commit' }]
    ])).toEqual([
      { name: '/plan', description: 'Fallback plan' },
      { name: '/commit', description: 'Commit' }
    ]);
  });
});
