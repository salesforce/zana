import { CREATE_PLUGIN_PROMPT } from './create-resource-prompts.js';

export interface PluginCreateArchetype {
  id: string;
  title: string;
  brief: string;
}

export interface PluginCreateUtilityExample {
  id: string;
  label: string;
  brief: string;
}

/** Outcome-shaped briefs. Completing CREATE_PLUGIN_PROMPT is the only job. */
export const PLUGIN_CREATE_ARCHETYPES: readonly PluginCreateArchetype[] = [
  {
    id: 'kanban',
    title: 'Kanban board',
    brief:
      'adds a kanban board panel where each card is a thread, and agents move cards between columns as work progresses'
  },
  {
    id: 'dashboard',
    title: 'Homepage dashboard',
    brief:
      'adds a homepage dashboard with open PR count and CI pass rate, refreshed on an interval'
  },
  {
    id: 'inbox',
    title: 'Support inbox',
    brief:
      'adds a support inbox that clusters bug reports, drafts replies for review, and opens a fix thread for each confirmed bug'
  }
];

/** Shortest path to a single SDK surface. Same prefix as the archetypes. */
export const PLUGIN_CREATE_UTILITIES: readonly PluginCreateUtilityExample[] = [
  {
    id: 'panel',
    label: 'Panel',
    brief: 'adds a nav panel that lists my saved prompts and inserts one into the composer on click'
  },
  {
    id: 'homepage-section',
    label: 'Homepage section',
    brief: "adds a homepage section showing yesterday's merged PRs and my review queue"
  },
  {
    id: 'cli-command',
    label: 'CLI command',
    brief: 'adds a zcc CLI command that deploys the current branch to staging and reports status'
  },
  {
    id: 'background-service',
    label: 'Background service',
    brief: 'adds a background service that watches CI and posts a homepage chip when a run fails'
  },
  {
    id: 'file-opener',
    label: 'File opener',
    brief: 'adds a file opener that renders CSV files as sortable, filterable tables'
  },
  {
    id: 'mentions',
    label: 'Mentions',
    brief: 'adds an @ mention provider that searches my saved reports and inserts a link'
  }
];

export function pluginCreatePrompt(brief: string): string {
  return `${CREATE_PLUGIN_PROMPT}${brief}.`;
}
