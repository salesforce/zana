import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GitPullRequest, Hash, MessageSquare, X } from 'lucide-react';
import type { SquadFlowNode } from '@zana-ai/zcc-domain/product';
import { nodeNotice } from './squadFlowLayout';
import { formatAge } from '@/lib/squad-worker-visibility';
import { memberRole, squadMemberStatus, squadStatuses } from './squadFlowPresentation';

function MemberStatus({ node, now }: { node: SquadFlowNode; now: number }) {
  const status = squadMemberStatus(node, now);
  return <span className="squad-status" data-status={status}>{squadStatuses[status]}</span>;
}

function memberAge(node: SquadFlowNode, now: number): string | undefined {
  const since = node.claim?.claimedAt ?? node.stateSince;
  return since && !node.exited ? `${formatAge(Math.max(0, now - since))} ago` : undefined;
}

interface RosterProps {
  nodes: SquadFlowNode[];
  now: number;
  selectedId?: string;
  onSelect: (node: SquadFlowNode, trigger: HTMLButtonElement) => void;
  solo?: boolean;
}

export function SquadRoster({ nodes, now, selectedId, onSelect, solo }: RosterProps) {
  const [showIdle, setShowIdle] = useState(true);
  const ordered = [...nodes].sort((a, b) => {
    if (solo) {
      const priority = (node: SquadFlowNode) => {
        const state = squadMemberStatus(node, now);
        return state === 'blocked' ? 0 : state === 'working' ? 1 : 2;
      };
      return priority(a) - priority(b);
    }
    return Number(b.isOrchestrator) - Number(a.isOrchestrator);
  });
  const idle = solo ? ordered.filter((node) => squadMemberStatus(node, now) === 'idle') : [];
  const active = solo ? ordered.filter((node) => squadMemberStatus(node, now) !== 'idle') : ordered;
  const memberButton = (node: SquadFlowNode) => {
    const Icon = node.isOrchestrator ? GitPullRequest : node.inspectionTarget.type === 'thread' ? MessageSquare : Hash;
    const age = memberAge(node, now);
    return (
      <button
        aria-pressed={selectedId === node.sessionId}
        className="squad-roster-row"
        data-status={squadMemberStatus(node, now)}
        key={node.sessionId}
        type="button"
        onClick={(event) => onSelect(node, event.currentTarget)}
      >
        <span className="squad-roster-icon"><Icon size={15} aria-hidden="true" /></span>
        <span className="squad-roster-body">
          <strong>{node.label}</strong>
          <small>{memberRole(node)}{age ? ` · ${age}` : ''}</small>
        </span>
        <MemberStatus node={node} now={now} />
        <ChevronRight className="squad-roster-chevron" size={14} aria-hidden="true" />
      </button>
    );
  };
  return (
    <>
      {active.map(memberButton)}
      {idle.length > 0 && (
        <>
          <button type="button" className="squad-idle-toggle" aria-expanded={showIdle} onClick={() => setShowIdle(!showIdle)}>
            {showIdle ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            Idle agents ({idle.length})
          </button>
          {showIdle && idle.map(memberButton)}
        </>
      )}
    </>
  );
}

export function SquadMemberDetails({ node, now, onClose, onOpen, onInspectExecution }: {
  node: SquadFlowNode;
  now: number;
  onClose: () => void;
  onOpen: (node: SquadFlowNode) => void;
  onInspectExecution?: (executionId: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [node.sessionId]);
  const age = memberAge(node, now);
  const notice = nodeNotice(node);
  return (
    <aside className="squad-member-details squad-surface" aria-label="Agent details">
      <div className="squad-detail-title">
        <div><small>{memberRole(node)}</small><h2 tabIndex={-1} ref={heading}>{node.label}</h2></div>
        <button type="button" className="icon-btn" aria-label="Close agent details" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="squad-detail-state">
        <MemberStatus node={node} now={now} />
        {age && <small>{age}</small>}
      </div>
      {node.liveSubagents > 0 && <p>{node.liveSubagents} active {node.liveSubagents === 1 ? 'sub-agent' : 'sub-agents'}</p>}
      {notice && <p className="squad-detail-question"><strong>{notice === 'blocker' ? 'Needs you' : 'Coordinator deciding'}</strong>{node.job?.blockerQuestion}</p>}
      <div className="squad-detail-actions">
        {!node.detached && (
          <button className="btn primary" type="button" onClick={() => onOpen(node)}>
            {node.inspectionTarget.type === 'thread' ? 'Open thread' : 'Open terminal'}
          </button>
        )}
        {onInspectExecution && node.job && (
          <button className="btn" type="button" onClick={() => onInspectExecution(node.job!.executionId)}>Open Squad details</button>
        )}
      </div>
    </aside>
  );
}
