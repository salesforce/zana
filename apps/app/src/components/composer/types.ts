import type { PromptMentionResource } from '@zana-ai/zcc-domain/thread-runtime';

export type TypeaheadKind = 'mention' | 'command';

export interface TypeaheadTrigger {
  char: string;
  kind: TypeaheadKind;
}

export interface ActiveTrigger {
  char: string;
  kind: TypeaheadKind;
  query: string;
  from: number;
  to: number;
}

export type PathEntryKind = 'file' | 'directory';

export type TypeaheadSuggestion =
  | {
      kind: 'path';
      path: string;
      name: string;
      entryKind: PathEntryKind;
    }
  | {
      kind: 'thread';
      threadId: string;
      projectId: string;
      title: string;
      projectName?: string | null;
    }
  | {
      kind: 'project';
      projectId: string;
      name: string;
    }
  | {
      kind: 'command';
      name: string;
      description: string;
    }
  | {
      kind: 'plugin';
      pluginId: string;
      providerId: string;
      id: string;
      label: string;
      insertText?: string;
    };

export const COMPOSER_TRIGGERS: readonly TypeaheadTrigger[] = [
  { char: '@', kind: 'mention' },
  { char: '/', kind: 'command' }
];

export const COMPOSER_SUGGESTION_LIMIT = 8;

export function suggestionKey(item: TypeaheadSuggestion): string {
  if (item.kind === 'path') return `path:${item.path}`;
  if (item.kind === 'thread') return `thread:${item.threadId}`;
  if (item.kind === 'project') return `project:${item.projectId}`;
  if (item.kind === 'plugin') return `plugin:${item.pluginId}:${item.providerId}:${item.id}`;
  return `command:${item.name}`;
}

export function suggestionLabel(item: TypeaheadSuggestion): string {
  if (item.kind === 'path') return item.path;
  if (item.kind === 'thread') return item.title;
  if (item.kind === 'project') return item.name;
  if (item.kind === 'plugin') return item.label;
  return item.name.startsWith('/') ? item.name : `/${item.name}`;
}

export function serializedTextForSuggestion(item: TypeaheadSuggestion): string {
  if (item.kind === 'command') {
    return item.name.startsWith('/') ? item.name : `/${item.name}`;
  }
  if (item.kind === 'path') return `@${item.path}`;
  if (item.kind === 'thread') return `@${item.title}`;
  if (item.kind === 'plugin') return item.insertText ?? `@${item.label}`;
  return `@${item.name}`;
}

export function resourceFromSuggestion(item: TypeaheadSuggestion): PromptMentionResource {
  if (item.kind === 'path') {
    return {
      kind: 'path',
      source: 'workspace',
      entryKind: item.entryKind,
      path: item.path,
      label: item.name
    };
  }
  if (item.kind === 'thread') {
    return {
      kind: 'thread',
      threadId: item.threadId,
      projectId: item.projectId,
      label: item.title
    };
  }
  if (item.kind === 'project') {
    return {
      kind: 'project',
      projectId: item.projectId,
      label: item.name
    };
  }
  if (item.kind === 'plugin') {
    return {
      kind: 'plugin',
      pluginId: item.pluginId,
      itemId: `${item.providerId}:${item.id}`,
      label: item.label
    };
  }
  const name = item.name.replace(/^\//, '');
  return {
    kind: 'command',
    trigger: '/',
    name,
    source: 'command',
    origin: 'builtin',
    label: name,
    argumentHint: null
  };
}
