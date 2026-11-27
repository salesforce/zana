import { useLayoutEffect, useRef } from 'react';
import { ChevronRight, GitPullRequest, Hash, MessageSquare, X } from 'lucide-react';
import type { SquadFlowNode } from '@zana-ai/zcc-domain/product';
import { nodeNotice } from './squadFlowLayout';
import { formatAge } from '@/lib/squad-worker-visibility';
import { memberRole, squadMemberStatus, squadStatuses } from './squadFlowPresentation';

function memberAge(node: SquadFlowNode, now: number): string | undefined {
  const since = node.claim?.claimedAt ?? node.stateSince;
  return since && !node.exited ? `${formatAge(Math.max(0, now - since))} ago` : undefined;
}

interface RosterProps {
  nodes: SquadFlowNode[];
  now: number;
  selectedId?: string;
  onSelect: (node: SquadFlowNode, trigger: HTMLButtonElement) => void;
  questionPinned?: boolean;
}

export function SquadRoster({ nodes, now, selectedId, onSelect, questionPinned }: RosterProps) {
  const ordered = [...nodes].sort((a, b) => Number(b.isOrchestrator) - Number(a.isOrchestrator));
  return ordered.map((node) => {
    const Icon = node.isOrchestrator ? GitPullRequest : node.inspectionTarget.type === 'thread' ? MessageSquare : Hash;
    const age = memberAge(node, now);
    const memberStatus = squadMemberStatus(node, now);
    const status = memberStatus === 'blocked' && questionPinned && node.isOrchestrator && node.job?.needsAttention
      ? 'waiting' : memberStatus;
    return (
      <button
        aria-pressed={selectedId === node.sessionId}
        className="squad-roster-row"
        data-status={status}
        key={node.sessionId}
        type="button"
        onClick={(event) => onSelect(node, event.currentTarget)}
      >
        <span className="squad-roster-icon"><Icon size={15} aria-hidden="true" /></span>
        <span className="squad-roster-body">
          <strong>{node.label}</strong>
          <small>{memberRole(node)}{age ? ` · ${age}` : ''}</small>
        </span>
        <span className="squad-status" data-status={status}>{squadStatuses[status]}</span>
        <ChevronRight className="squad-roster-chevron" size={14} aria-hidden="true" />
      </button>
    );
  });
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
  const status = squadMemberStatus(node, now);
  return (
    <aside className="squad-member-details squad-surface" aria-label="Agent details">
      <div className="squad-detail-title">
        <div><small>{memberRole(node)}</small><h2 tabIndex={-1} ref={heading}>{node.label}</h2></div>
        <button type="button" className="icon-btn" aria-label="Close agent details" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="squad-detail-state">
        <span className="squad-status" data-status={status}>{squadStatuses[status]}</span>
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
