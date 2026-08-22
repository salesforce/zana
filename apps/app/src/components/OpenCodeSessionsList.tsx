import { product } from '../lib/product-client.js';
import { useEffect, useState } from 'react';
import { Clock, Sparkles } from 'lucide-react';
import type { OpenCodeSessionSummary } from '@zana-ai/zcc-domain/product';

interface Props {
  projectId: string;
  onResume: (session: OpenCodeSessionSummary) => void;
}

function timeAgo(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function OpenCodeSessionsList({ projectId, onResume }: Props) {
  const [sessions, setSessions] = useState<OpenCodeSessionSummary[] | null>(null);

  useEffect(() => {
    let active = true;
    product.opencode
      .listSessions(projectId)
      .then((items) => active && setSessions(items))
      .catch(() => active && setSessions([]));
    return () => {
      active = false;
    };
  }, [projectId]);

  if (!sessions || sessions.length === 0) return null;

  return (
    <div className="sessions">
      <div className="sessions-title">OpenCode conversations</div>
      <div className="sessions-list">
        {sessions.slice(0, 8).map((session) => (
          <button
            key={session.id}
            className="agents-row session-agent-row"
            onClick={() => onResume(session)}
            title={session.title}
          >
            <span className="agents-row-icon tab-profile-icon profile-opencode" aria-hidden="true">
              <Sparkles size={13} />
            </span>
            <span className="agents-row-text">
              <span className="agents-row-title-line">
                <span className="agents-row-title">{session.title || <em className="dim">empty session</em>}</span>
              </span>
              <span className="agents-row-meta">
                <span title={new Date(session.lastActiveAt).toLocaleString()}>
                  <Clock size={11} /> {timeAgo(session.lastActiveAt)}
                </span>
                <span className="session-id">{session.id.slice(0, 7)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
