import { useState, type MouseEvent } from 'react';
import { BotMessageSquare, FileText, HelpCircle, Inbox, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isReport } from '@zana-ai/zcc-domain/feed-categories';
import type { InboxEntry, Project } from '@zana-ai/zcc-domain/product';
import { buildInboxAgentPrompt, inboxContextLine, inboxOffersAgentFix, inboxPrimaryTitle, inboxSecondaryLine, isUnansweredQuestion } from '../lib/inboxPresentation.js';
import { inspectAgentSession } from '../lib/inspect-session.js';
import { AgentLauncher } from './AgentLauncher.js';

export function InboxFeedCards({ entries, projects, readIds, keptIds, answeredIds, onOpen, onContextMenu, formatTime }: {
  entries: readonly InboxEntry[];
  projects: ReadonlyMap<string, Project>;
  readIds: Record<string, boolean>;
  keptIds: Record<string, boolean>;
  answeredIds: Record<string, true>;
  onOpen: (id: string) => void;
  onContextMenu: (event: MouseEvent, entry: InboxEntry) => void;
  formatTime: (ts: number) => string;
}) {
  const [draftId, setDraftId] = useState<string | null>(null);
  const draft = draftId ? entries.find((entry) => entry.id === draftId) : undefined;
  const draftProject = draft && projects.get(draft.projectId);

  return (
    <div className="inbox-feed-cards">
      {entries.map((entry) => {
        const project = projects.get(entry.projectId);
        const projectName = project?.name ?? entry.projectLabel ?? entry.projectId;
        const report = isReport(entry);
        const answer = isUnansweredQuestion(entry, answeredIds);
        const fix = !!project && inboxOffersAgentFix(entry);
        const Icon = answer ? HelpCircle : report ? FileText : fix ? BotMessageSquare : Inbox;
        const preview = inboxSecondaryLine(entry) || inboxContextLine(entry);
        const title = inboxPrimaryTitle(entry) || 'Inbox message';
        return (
          <article key={entry.id} className={`inbox-feed-card ${answer ? 'inbox-feed-card--attention' : ''}`} onContextMenu={(event) => onContextMenu(event, entry)}>
            <button className="inbox-feed-card-open" type="button" onClick={() => onOpen(entry.id)}>
              <span className={`inbox-feed-card-icon ${report ? 'inbox-feed-card-icon--report' : ''}`}><Icon size={19} aria-hidden /></span>
              <span className="inbox-feed-card-content">
                <span className="inbox-feed-card-title">
                  {!readIds[entry.id] && <span className="inbox-feed-unread" aria-label="Unread" role="img" />}
                  {title}
                  {keptIds[entry.id] && <Star size={12} aria-label="Kept" />}
                </span>
                <span className="inbox-feed-card-preview">{projectName}{preview && ` · ${preview}`}</span>
              </span>
            </button>
            <span className="inbox-feed-card-meta">
              <time title={new Date(entry.ts).toLocaleString()}>{formatTime(entry.ts)}</time>
              {report && <span className="inbox-row-report-badge">Report</span>}
            </span>
            {answer ? (
              <button type="button" className="inbox-feed-action" onClick={() => onOpen(entry.id)}>Answer</button>
            ) : fix && (
              <button type="button" className="inbox-feed-action" onClick={() => setDraftId(entry.id)}>Fix with agent</button>
            )}
          </article>
        );
      })}
      {draft && draftProject && (
        <InboxAgentFix entry={draft} project={draftProject} onClose={() => setDraftId(null)} />
      )}
    </div>
  );
}

function InboxAgentFix({ entry, project, onClose }: { entry: InboxEntry; project: Project; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <AgentLauncher
      project={project}
      initialPrompt={buildInboxAgentPrompt(entry, 'Investigate the failure described in this Inbox message and propose a fix.')}
      onLaunched={(session, projectId) => inspectAgentSession(session.id, projectId, navigate)}
      onClose={onClose}
    />
  );
}
