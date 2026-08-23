import { fuzzyScore } from '../../lib/fuzzy.js';
import {
  COMPOSER_SUGGESTION_LIMIT,
  type PathEntryKind,
  type TypeaheadSuggestion
} from './types.js';

export function rankSuggestions(
  items: readonly TypeaheadSuggestion[],
  query: string,
  limit = COMPOSER_SUGGESTION_LIMIT
): TypeaheadSuggestion[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  return items
    .map((item) => {
      const primary = item.kind === 'path'
        ? item.path
        : item.kind === 'thread'
          ? item.title
          : item.kind === 'project'
            ? item.name
            : item.name;
      const extra = item.kind === 'command' ? item.description : '';
      const primaryScore = fuzzyScore(primary, q);
      const extraScore = extra ? fuzzyScore(extra, q) : null;
      const score = Math.max(primaryScore?.score ?? -1, extraScore?.score ?? -1);
      return score >= 0 ? { item, score } : null;
    })
    .filter((row): row is { item: TypeaheadSuggestion; score: number } => row !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((row) => row.item);
}

export function mentionOrder(items: readonly TypeaheadSuggestion[]): TypeaheadSuggestion[] {
  const rank = (item: TypeaheadSuggestion) => {
    if (item.kind === 'thread') return 0;
    if (item.kind === 'project') return 1;
    return 2;
  };
  return [...items].sort((left, right) => rank(left) - rank(right));
}

export function buildMentionSuggestions(input: {
  paths: ReadonlyArray<{ path: string; name: string; entryKind: PathEntryKind }>;
  threads: ReadonlyArray<{ id: string; projectId: string; title: string | null }>;
  projects: ReadonlyArray<{ id: string; name: string }>;
  query: string;
}): TypeaheadSuggestion[] {
  const threads = rankSuggestions(
    input.threads.map((thread) => ({
      kind: 'thread' as const,
      threadId: thread.id,
      projectId: thread.projectId,
      title: thread.title?.trim() || 'Untitled thread'
    })),
    input.query,
    4
  );
  const projects = rankSuggestions(
    input.projects.map((project) => ({
      kind: 'project' as const,
      projectId: project.id,
      name: project.name
    })),
    input.query,
    3
  );
  const paths = rankSuggestions(
    input.paths.map((row) => ({
      kind: 'path' as const,
      path: row.path,
      name: row.name,
      entryKind: row.entryKind
    })),
    input.query,
    COMPOSER_SUGGESTION_LIMIT
  );
  return mentionOrder([...threads, ...projects, ...paths]).slice(0, COMPOSER_SUGGESTION_LIMIT);
}

export function buildCommandSuggestions(
  commands: ReadonlyArray<{ name: string; description: string }>,
  query: string
): TypeaheadSuggestion[] {
  const items: TypeaheadSuggestion[] = commands.map((command) => ({
    kind: 'command',
    name: command.name.startsWith('/') ? command.name : `/${command.name}`,
    description: command.description
  }));
  return rankSuggestions(items, query.replace(/^\//, ''), COMPOSER_SUGGESTION_LIMIT);
}
