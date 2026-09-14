import type { LucideIcon } from 'lucide-react';
import {
  ChartColumn,
  Columns2,
  Inbox,
  ListTodo,
  MessagesSquare,
  Sparkles
} from 'lucide-react';
import { pluginCreatePrompt } from '../../../lib/create-plugin-examples.js';

export interface BrowseHeroArchetype {
  id: string;
  noun: string;
  title: string;
  hook: string;
  brief: string;
  icon: LucideIcon;
  accent: string;
  scene: 'kanban' | 'dashboard' | 'inbox' | 'panel';
}

export const BROWSE_HERO_ARCHETYPES: readonly BrowseHeroArchetype[] = [
  {
    id: 'kanban',
    noun: 'a kanban board',
    title: 'Kanban board',
    hook: 'Ship a board your agents move cards across while they work.',
    brief:
      'adds a kanban board panel where each card is a thread, and agents move cards between columns as work progresses',
    icon: Columns2,
    accent: '--accent-blue',
    scene: 'kanban'
  },
  {
    id: 'dashboard',
    noun: 'a live dashboard',
    title: 'Live dashboard',
    hook: 'Put the numbers your team actually checks on the homepage.',
    brief:
      'adds a homepage dashboard with open PR count and CI pass rate, refreshed on an interval',
    icon: ChartColumn,
    accent: '--success',
    scene: 'dashboard'
  },
  {
    id: 'inbox',
    noun: 'a support inbox',
    title: 'Support inbox',
    hook: 'Cluster reports, draft replies, and open a fix thread for each bug.',
    brief:
      'adds a support inbox that clusters bug reports, drafts replies for review, and opens a fix thread for each confirmed bug',
    icon: Inbox,
    accent: '--accent-gold',
    scene: 'inbox'
  },
  {
    id: 'tasks',
    noun: 'a task board',
    title: 'Task board',
    hook: 'Track agent work in a sidebar your team already lives in.',
    brief: 'adds a nav panel that lists my saved prompts and inserts one into the composer on click',
    icon: ListTodo,
    accent: '--success',
    scene: 'panel'
  },
  {
    id: 'mentions',
    noun: 'a mention picker',
    title: 'Mentions',
    hook: 'Search saved reports and drop a link from the composer.',
    brief: 'adds an @ mention provider that searches my saved reports and inserts a link',
    icon: MessagesSquare,
    accent: '--accent-blue',
    scene: 'panel'
  },
  {
    id: 'spark',
    noun: 'whatever you need',
    title: 'Your plugin',
    hook: 'Describe the surface. The thread scaffolds, installs, and iterates.',
    brief: 'adds a nav panel with the workflow I describe next',
    icon: Sparkles,
    accent: '--accent-gold',
    scene: 'panel'
  }
];

export function browseHeroPrompt(brief: string): string {
  return pluginCreatePrompt(brief);
}

let composerNonce = 1;

export function nextComposerRequestNonce(): number {
  composerNonce += 1;
  return composerNonce;
}

export type BrowseHeroOpenRequest = { nonce: number; seed?: string };

/** Apply a create request only when its nonce is new. Callback identity must not re-enter compose. */
export function applyBrowseHeroOpenRequest(
  request: BrowseHeroOpenRequest | null | undefined,
  appliedNonce: number | null
):
  | { enterCompose: true; nonce: number; seed?: string }
  | { enterCompose: false; nonce: number | null } {
  if (!request) return { enterCompose: false, nonce: null };
  if (request.nonce === appliedNonce) {
    return { enterCompose: false, nonce: appliedNonce };
  }
  return { enterCompose: true, nonce: request.nonce, seed: request.seed };
}
