import { useState } from 'react';
import { BellOff, Inbox, Loader2, MailCheck, Trash2 } from 'lucide-react';
import { product } from '../lib/product-client.js';
import type { AgentState, TerminalSession } from '@zana-ai/zcc-domain/product';
import { isClaudeProfile } from '../lib/launchProfile.js';
import { useData, useIdleTriage } from '../store.js';
import {
  canCloseWithFollowup,
  cliAgentDeleteConfirm,
  cliAgentRemoveLabel,
  closeAgentWithFollowup
} from './agentCardActions.js';
import { idleSurfacesToNeedsYou } from './AgentBoard.js';

/**
 * Shared CLI-agent footer actions (mark idle / delete / summarize). Used by the
 * inspector modal and the routed session page so those controls stay one path.
 */
export function AgentSessionActions({
  session,
  projectId,
  state,
  onSessionClosed
}: {
  session: TerminalSession;
  projectId: string;
  state: AgentState;
  onSessionClosed?: () => void;
}) {
  const exited = session.status === 'exited';
  const summaryEnabled = useData((s) => s.catchUpSummaryEnabled);
  const canSummarize = summaryEnabled && isClaudeProfile(session.profile);
  const [summarizing, setSummarizing] = useState(false);
  const [closingWithFollowup, setClosingWithFollowup] = useState(false);
  const triageVerdict = useIdleTriage((s) => s.byId[session.id]);
  const sensitivity = useData((s) => s.idleAttentionSensitivity);
  const surfacingForAttention =
    !exited &&
    (state === 'blocked' ||
      (state !== 'working' &&
        !!triageVerdict &&
        idleSurfacesToNeedsYou(triageVerdict.resolution, triageVerdict.confidence ?? 0, sensitivity)));

  const markIdle = () => {
    void product.terminals.clearAgentBlocked(projectId, session.id);
    useIdleTriage.getState().clear(session.id);
  };

  const deleteAgent = () => {
    if (!window.confirm(cliAgentDeleteConfirm(session.title))) return;
    void useData.getState().closeTerminal(session.id, projectId);
    onSessionClosed?.();
  };

  const closeWithFollowup = async () => {
    if (closingWithFollowup) return;
    setClosingWithFollowup(true);
    try {
      const confirmed = await closeAgentWithFollowup(session, projectId);
      if (confirmed) onSessionClosed?.();
    } finally {
      setClosingWithFollowup(false);
    }
  };

  const summarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    try {
      await useData.getState().summarizeSession(session.id, projectId);
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <>
      {surfacingForAttention && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={markIdle}
          title="Clear the “Needs you” flag and mark this agent as Idle. The process keeps running."
        >
          <BellOff size={13} /> Mark as Idle
        </button>
      )}
      {!exited && (
        <button
          type="button"
          className="agent-monitor-action danger"
          onClick={deleteAgent}
          title="Terminate the agent's process and close this view"
        >
          <Trash2 size={13} /> {cliAgentRemoveLabel(exited)}
        </button>
      )}
      {!exited && canCloseWithFollowup(session) && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={() => void closeWithFollowup()}
          disabled={closingWithFollowup}
          title="Close the agent, summarising its work to your inbox and filing a follow-up if it left something unfinished"
        >
          {closingWithFollowup ? <Loader2 size={13} className="spin" /> : <MailCheck size={13} />}
          {closingWithFollowup ? 'Closing…' : 'Close with follow-up'}
        </button>
      )}
      {canSummarize && (
        <button
          type="button"
          className="agent-monitor-action"
          onClick={() => void summarize()}
          disabled={summarizing}
          title="Summarize this agent's work and send it to your inbox"
        >
          {summarizing ? <Loader2 size={13} className="spin" /> : <Inbox size={13} />}
          {summarizing ? 'Summarizing…' : 'Summarize to inbox'}
        </button>
      )}
    </>
  );
}
