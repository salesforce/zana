import { useEffect, useMemo, useState } from 'react';
import { product } from '../../lib/product-client.js';
import { apiJson } from '../../lib/fetch-with-app-surface.js';
import { useThreads } from '../../thread-store.js';
import { buildCommandSuggestions, buildMentionSuggestions, rankSuggestions } from './filter-composer-suggestions.js';
import { typeaheadMenuOpen } from './typeahead-keyboard.js';
import type { ActiveTrigger, PathEntryKind, TypeaheadSuggestion } from './types.js';

interface PathRow {
  path: string;
  name: string;
  entryKind: PathEntryKind;
}

interface MentionProviderRow {
  pluginId: string;
  id: string;
  trigger?: string;
}

export function useComposerSuggestions(args: {
  trigger: ActiveTrigger | null;
  projectId: string;
  projects: ReadonlyArray<{ id: string; name: string }>;
  commands: ReadonlyArray<{ name: string; description: string }>;
  commandsLoaded: boolean;
}): { suggestions: TypeaheadSuggestion[]; menuOpen: boolean } {
  const threads = useThreads((state) => state.threads);
  const loadThreads = useThreads((state) => state.load);
  const [paths, setPaths] = useState<PathRow[]>([]);
  const [pluginMentions, setPluginMentions] = useState<TypeaheadSuggestion[]>([]);

  useEffect(() => {
    if (args.trigger?.kind !== 'mention' || !args.projectId) return;
    void loadThreads();
  }, [args.projectId, args.trigger?.kind, loadThreads]);

  useEffect(() => {
    if (args.trigger?.kind !== 'mention' || !args.projectId) return;
    let cancelled = false;
    void product.projects.paths(args.projectId, { limit: 200 }).then((body) => {
      if (cancelled) return;
      setPaths(body.paths.map((row) => ({
        path: row.path,
        name: row.name,
        entryKind: row.kind
      })));
    }).catch(() => {
      if (!cancelled) setPaths([]);
    });
    return () => {
      cancelled = true;
    };
  }, [args.projectId, args.trigger?.kind]);

  useEffect(() => {
    if (args.trigger?.kind !== 'mention') return;
    let cancelled = false;
    void apiJson<{ mentionProviders?: MentionProviderRow[] }>('/plugins/contributions')
      .then(async (body) => {
        const providers = body.mentionProviders ?? [];
        const rows = await Promise.all(
          providers.map(async (provider) => {
            try {
              const result = await apiJson<{ items?: Array<{ id: string; label: string; insertText?: string }> }>(
                `/plugins/${encodeURIComponent(provider.pluginId)}/http/mentions/${encodeURIComponent(provider.id)}/search`,
                { method: 'POST', body: JSON.stringify({ query: args.trigger?.query ?? '' }) }
              );
              return (result.items ?? []).map((item): TypeaheadSuggestion => ({
                kind: 'plugin',
                pluginId: provider.pluginId,
                providerId: provider.id,
                id: item.id,
                label: item.label,
                insertText: item.insertText
              }));
            } catch {
              return [];
            }
          })
        );
        if (!cancelled) setPluginMentions(rows.flat());
      })
      .catch(() => {
        if (!cancelled) setPluginMentions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [args.trigger?.kind, args.trigger?.query]);

  const suggestions = useMemo(() => {
    if (!args.trigger) return [];
    if (args.trigger.kind === 'command') {
      return buildCommandSuggestions(args.commands, args.trigger.query);
    }
    const projectNames = new Map(args.projects.map((project) => [project.id, project.name]));
    const host = buildMentionSuggestions({
      paths,
      threads: threads.map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        projectName: projectNames.get(thread.projectId) ?? null
      })),
      projects: args.projects,
      query: args.trigger.query
    });
    const plugin = rankSuggestions(pluginMentions, args.trigger.query, 4);
    return [...plugin, ...host].slice(0, 8);
  }, [args.commands, args.projects, args.trigger, paths, pluginMentions, threads]);

  return {
    suggestions,
    menuOpen: typeaheadMenuOpen(args.trigger?.kind ?? null, suggestions.length, args.commandsLoaded)
  };
}
