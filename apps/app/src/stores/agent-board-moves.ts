import { useStore } from 'zustand';
import { createAgentBoardMoves } from '../lib/agent-board-moves.js';
import { product } from '../lib/product-client.js';
import { errorMessage, pushErrorToast, useData, useIdleTriage } from '../store.js';
import { useThreads } from '../thread-store.js';
import { useSplitWorkspace } from '../lib/split-layout/store.js';

export const agentBoardMoves = createAgentBoardMoves({
  async stop(item) {
    if (item.kind === 'thread') {
      await product.threads.stop(item.id);
    } else if (item.kind === 'agent') {
      await product.terminals.write(item.id, '\x03');
      await product.terminals.clearAgentBlocked(item.projectId, item.id);
      useIdleTriage.getState().clear(item.id);
    }
  },
  async close(item) {
    if (item.kind === 'thread') {
      const result = await product.threads.archive(item.id);
      if (!result.ok) throw new Error('Could not archive the agent');
      useThreads.getState().remove(item.id);
      useSplitWorkspace.getState().closePanesForThreads([item.id]);
    } else if (item.kind === 'agent') {
      await useData.getState().closeTerminal(item.id, item.projectId);
    }
  },
  exists(item) {
    if (item.kind === 'thread') return useThreads.getState().threads.some(
      (thread) => thread.id === item.id && thread.createdAt === item.thread.createdAt && !thread.archivedAt
    );
    if (item.kind === 'agent') return (useData.getState().terminals[item.projectId] ?? []).some(
      (session) => session.id === item.id && session.createdAt === item.card.session.createdAt
    );
    return false;
  },
  onError: (error) => pushErrorToast(errorMessage(error, 'Could not move the agent'))
});

export function useAgentBoardMoves() {
  return useStore(agentBoardMoves.store);
}

/** Install once with the app, never with the board (which mounts per route). */
export function installAgentBoardMoves() {
  const unsubscribeAgents = useData.subscribe(agentBoardMoves.reconcile);
  const unsubscribeThreads = useThreads.subscribe(agentBoardMoves.reconcile);
  return () => {
    unsubscribeAgents();
    unsubscribeThreads();
    agentBoardMoves.dispose();
  };
}
