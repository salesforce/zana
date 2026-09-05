import type { PaneContent } from '../../lib/split-layout/types.js';

const PROJECT_MODE_LABELS: Record<string, string> = {
  agents: 'Agents',
  feed: 'Feed',
  terminals: 'Terminals',
  explorer: 'Explorer',
  scheduler: 'Scheduler',
  goals: 'Goals',
  followups: 'Follow-ups',
  docs: 'Library'
};

export function paneBarTitle(content: PaneContent, pluginTitle?: string): string {
  switch (content.kind) {
    case 'home':
      return 'Home';
    case 'inbox':
      return 'Inbox';
    case 'agents':
      return 'Agents';
    case 'scheduler':
      return 'Scheduler';
    case 'empty':
      return 'Drop a view here';
    case 'new-thread':
      return 'New thread';
    case 'plugin-detail':
      return 'Extension';
    case 'plugin-panel': {
      const title = pluginTitle?.trim();
      return title && title.length > 0 ? title : content.pluginId;
    }
    case 'project-view':
      return PROJECT_MODE_LABELS[content.mode] ?? content.mode;
    default:
      return 'Pane';
  }
}

export function paneHasOwnCloseChrome(content: PaneContent): boolean {
  return (
    content.kind === 'thread' ||
    content.kind === 'agent-session' ||
    content.kind === 'schedule' ||
    content.kind === 'new-schedule'
  );
}

export function paneUsesHostBar(content: PaneContent): boolean {
  if (paneHasOwnCloseChrome(content)) return false;
  if (content.kind === 'project-view' && content.mode !== 'agents') return false;
  return true;
}
