import { MessageSquareText, TriangleAlert } from 'lucide-react';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { agentTabStatus, type AgentTabStatus } from '../lib/agent-tab-status.js';
import { ProjectDot } from './listpane/ProjectDot.js';
import { ZanaSpinner } from './fairy/ZanaSpinner.js';
import type { ApplicationTabView } from './ApplicationTabBar.js';

const STATUS_ICONS = {
  Error: TriangleAlert,
  'Needs you': MessageSquareText,
  Working: ZanaSpinner
} as const;

function statusBadge(status: AgentTabStatus) {
  const Icon = STATUS_ICONS[status as keyof typeof STATUS_ICONS];
  if (!Icon) return undefined;
  return (
    <span
      className={`titlebar-thread-status status-${status.toLowerCase().replace(' ', '-')}`}
      role="img"
      aria-label={status}
    >
      <Icon size={12} aria-hidden="true" />
    </span>
  );
}

export interface AgentTabViewInput {
  id: string;
  session: TerminalSession;
  project: Project;
  agentState: Parameters<typeof agentTabStatus>[1];
  active: boolean;
  unread: boolean;
  copyLink: () => void;
  openProject: () => void;
  closeAgent: () => void;
}

/** One CLI Agent's strip entry: thread-style label and status, with agent-specific menu actions. */
export function agentTabView(input: AgentTabViewInput): ApplicationTabView {
  const { id, session, project, agentState, active, unread } = input;
  const status = agentTabStatus(session, agentState);
  const title = session.title || 'Untitled agent';
  const flag = unread ? ' — Unread' : '';
  return {
    id,
    kind: 'agent',
    title,
    context: project.name,
    label: `${title} — ${project.name}${flag}`,
    tooltip: `${title}\n${project.name} · ${status}${unread ? ' · Unread' : ''}`,
    active,
    busy: false,
    unread,
    closeHint: 'Close tab (keeps agent running)',
    icon: <ProjectDot project={project} />,
    status: statusBadge(status),
    actions: [
      { label: 'Copy agent link', run: input.copyLink },
      { label: 'Open project', run: input.openProject }
    ],
    footerActions: [
      { label: 'Close agent', separatorBefore: true, run: input.closeAgent }
    ]
  };
}
