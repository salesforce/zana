// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';

export function registerAgentsIpc(): void {
  

  // Agent mesh (read-only for the renderer): expose the live discovery registry
  // and the agent↔agent message history so the Agents board can show who's
  // registered and what peers said to each other. Distinct from inbox: this is
  // agent↔agent traffic, never agent→User. The registry change push carries no
  // payload (the renderer re-fetches list()), matching its cheap full-list
  // model; messages push the appended entry like inbox does.
  ctx.safeHandle(IPC.agents.list, () => ctx.agentRegistry.list(), () => []);
  ctx.safeHandle(
    IPC.agents.messages,
    (projectId?: string) => ctx.agentMessageLog.history(projectId),
    () => []
  );
  ctx.agentRegistry.onChanged(() => {
    ctx.safeSend(IPC.agents.onRegistryChanged);
  });
  ctx.agentMessageLog.onAppended((msg) => {
    ctx.safeSend(IPC.agents.onMessage, msg);
  });
  ctx.agentMessageLog.onPruned((removedIds) => {
    ctx.safeSend(IPC.agents.onMessagesPruned, removedIds);
  });
}

