import { useEffect, useMemo, useState } from 'react';
import { product } from '../../lib/product-client.js';
import { useThreads } from '../../thread-store.js';
import { buildCommandSuggestions, buildMentionSuggestions } from './filter-composer-suggestions.js';
import { typeaheadMenuOpen } from './typeahead-keyboard.js';
import type { ActiveTrigger, PathEntryKind, TypeaheadSuggestion } from './types.js';

interface PathRow {
  path: string;
  name: string;
  entryKind: PathEntryKind;
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

  const suggestions = useMemo(() => {
    if (!args.trigger) return [];
    if (args.trigger.kind === 'command') {
      return buildCommandSuggestions(args.commands, args.trigger.query);
    }
    return buildMentionSuggestions({
      paths,
      threads: threads.map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title
      })),
      projects: args.projects,
      query: args.trigger.query
    });
  }, [args.commands, args.projects, args.trigger, paths, threads]);

  return {
    suggestions,
    menuOpen: typeaheadMenuOpen(args.trigger?.kind ?? null, suggestions.length, args.commandsLoaded)
  };
}
