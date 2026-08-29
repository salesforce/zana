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
            : item.kind === 'plugin'
              ? item.label
              : item.name;
      const extra = item.kind === 'command'
        ? item.description
        : item.kind === 'thread'
          ? (item.projectName ?? '')
          : item.kind === 'plugin'
            ? item.pluginId
            : '';
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
    if (item.kind === 'plugin') return 2;
    return 3;
  };
  return [...items].sort((left, right) => rank(left) - rank(right));
}

export function buildMentionSuggestions(input: {
  paths: ReadonlyArray<{ path: string; name: string; entryKind: PathEntryKind }>;
  threads: ReadonlyArray<{
    id: string;
    projectId: string;
    title: string | null;
    projectName?: string | null;
  }>;
  projects: ReadonlyArray<{ id: string; name: string }>;
  pluginItems?: ReadonlyArray<{
    pluginId: string;
    providerId: string;
    id: string;
    label: string;
    insertText?: string;
  }>;
  query: string;
}): TypeaheadSuggestion[] {
  const threads = rankSuggestions(
    input.threads.map((thread) => ({
      kind: 'thread' as const,
      threadId: thread.id,
      projectId: thread.projectId,
      title: thread.title?.trim() || 'Untitled agent',
      projectName: thread.projectName?.trim() || null
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
  const plugins = rankSuggestions(
    (input.pluginItems ?? []).map((row) => ({
      kind: 'plugin' as const,
      pluginId: row.pluginId,
      providerId: row.providerId,
      id: row.id,
      label: row.label,
      insertText: row.insertText
    })),
    input.query,
    4
  );
  return mentionOrder([...threads, ...projects, ...plugins, ...paths]).slice(0, COMPOSER_SUGGESTION_LIMIT);
}

export function commandName(name: string): string {
  return name.startsWith('/') ? name : `/${name}`;
}

export function commandsFromComposerActions(
  actions: readonly string[],
  displayName?: string
): Array<{ name: string; description: string }> {
  return actions.map((action) => {
    const name = commandName(action);
    const label = action.replace(/^\//, '');
    return {
      name,
      description: displayName ? `${displayName} ${label}` : label
    };
  });
}

export function commandsFromPluginSkills(
  plugins: ReadonlyArray<{
    name: string;
    enabled?: boolean;
    skillNames?: readonly string[];
  }>
): Array<{ name: string; description: string }> {
  return plugins.flatMap((plugin) => {
    if (plugin.enabled === false) return [];
    return (plugin.skillNames ?? []).map((skillName) => ({
      name: commandName(skillName),
      description: plugin.name
    }));
  });
}

export function mergeCommandCatalogs(
  groups: ReadonlyArray<ReadonlyArray<{ name: string; description: string }>>
): Array<{ name: string; description: string }> {
  const merged = new Map<string, { name: string; description: string }>();
  for (const group of groups) {
    for (const row of group) {
      const name = commandName(row.name);
      if (!merged.has(name)) merged.set(name, { name, description: row.description });
    }
  }
  return [...merged.values()];
}

const THREAD_WORK_MODE_COMMANDS = new Set(['/plan', '/goal']);

/** Thread Agent/Plan/Goal prefixes — never offer these on the CLI Agent catalog. */
export function isThreadWorkModeCommand(name: string): boolean {
  return THREAD_WORK_MODE_COMMANDS.has(commandName(name).toLowerCase());
}

export function filterCliComposerCommands(
  commands: ReadonlyArray<{ name: string; description: string }>
): Array<{ name: string; description: string }> {
  return commands.filter((row) => !isThreadWorkModeCommand(row.name));
}

export function buildCommandSuggestions(
  commands: ReadonlyArray<{ name: string; description: string }>,
  query: string
): TypeaheadSuggestion[] {
  const items: TypeaheadSuggestion[] = commands.map((command) => ({
    kind: 'command',
    name: commandName(command.name),
    description: command.description
  }));
  return rankSuggestions(items, query.replace(/^\//, ''), COMPOSER_SUGGESTION_LIMIT);
}
