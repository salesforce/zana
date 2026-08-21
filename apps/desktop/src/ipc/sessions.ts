// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { listClaudeSessions } from '@zana-ai/zcc-server/services/projects/claude';
import { gitCommonDir } from '@zana-ai/zcc-server/services/projects/git';
import { registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { listOpenCodeSessions } from '@zana-ai/zcc-server/services/projects/opencode-sessions';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import { realpathSync } from 'node:fs';
import type { ConversationHistorySnapshot, FsMutateResult, Result, TerminalSession } from '@zana-ai/zcc-domain/product';

export function registerSessionsIpc(): void {
  
  ctx.safeHandle(
    IPC.claude.listSessions,
    (projectId: unknown) => {
      if (typeof projectId !== 'string') return [];
      const project = store.listProjects().find((entry) => entry.id === projectId);
      // Native local history has no trustworthy remote-project contract. Resolve
      // the path from main's registered project record, never renderer input.
      return project && !project.remote ? listClaudeSessions(project.path) : [];
    },
    () => []
  );
  ctx.safeHandle(
    IPC.opencode.listSessions,
    (projectId: string) => {
      const project = store.listProjects().find((entry) => entry.id === projectId);
      return project
        ? listOpenCodeSessions(project.path, { binary: store.getConfig().opencodeBinary })
        : Promise.resolve([]);
    },
    () => []
  );
  ctx.safeHandleFromWindow<[{ projectId?: unknown; filter?: unknown }], ConversationHistorySnapshot>(
    IPC.history.start,
    (win, input: { projectId?: unknown; filter?: unknown }) => {
      // History resumes in the selected project's canonical cwd. Cross-project
      // aggregation would replay a native conversation with another project's
      // config/files/MCP assumptions, so `all` is intentionally unsupported.
      if (!input || input.filter !== 'project') {
        return ctx.conversationHistory.get(win.id, '');
      }
      const projectId = typeof input.projectId === 'string' ? input.projectId : undefined;
      if (!projectId) return ctx.conversationHistory.get(win.id, '');
      if (projectId && !store.listProjects().some((project) => project.id === projectId && !project.remote)) {
        return ctx.conversationHistory.get(win.id, '');
      }
      return ctx.conversationHistory.start(win.id, projectId);
    },
    () => ctx.conversationHistory.get(-1, '')
  );
  ctx.safeHandleFromWindow<[unknown], ConversationHistorySnapshot>(
    IPC.history.refresh,
    (win, snapshotId: unknown) => {
      const current = ctx.conversationHistory.get(win.id, snapshotId);
      if (current.status === 'expired') return current;
      const projectId = ctx.conversationHistory.scope(win.id, snapshotId);
      ctx.conversationHistory.release(win.id, snapshotId);
      return ctx.conversationHistory.refresh(win.id, projectId);
    },
    () => ctx.conversationHistory.get(-1, '')
  );
  ctx.safeHandleFromWindow<[unknown, unknown], ConversationHistorySnapshot>(
    IPC.history.page,
    (win, snapshotId: unknown, opaquePageCursor: unknown) => {
      if (opaquePageCursor !== undefined) return ctx.conversationHistory.get(win.id, '');
      return ctx.conversationHistory.get(win.id, snapshotId);
    },
    () => ctx.conversationHistory.get(-1, '')
  );
  ctx.safeHandleFromWindow<[unknown], void>(
    IPC.history.release,
    (win, snapshotId: unknown) => ctx.conversationHistory.release(win.id, snapshotId),
    () => undefined
  );
  ctx.safeHandleFromWindow<[unknown, unknown], Result<TerminalSession>>(
    IPC.history.resume,
    async (win, snapshotId: unknown, historyId: unknown): Promise<Result<TerminalSession>> => {
      const row = ctx.conversationHistory.find(win.id, snapshotId, historyId);
      if (!row) return { ok: false, code: 'DENIED', message: 'Conversation history row unavailable' };
      const project = store.listProjects().find((entry) => entry.id === row.projectId && !entry.remote);
      if (!project) return { ok: false, code: 'NOT_FOUND', message: 'Conversation project is unavailable' };
      const profile = row.source === 'claude' ? 'claude' : 'opencode';
      const resume = registrationFor(profile)?.nativeConversationResume?.(row.nativeConversationId);
      if (!resume) return { ok: false, code: 'DENIED', message: 'Exact native resume is unavailable' };
      return ctx.createInteractiveTerminal({
        projectId: project.id,
        cols: 80,
        rows: 24,
        title: row.title,
        ...resume
      });
    },
    () => ({ ok: false, code: 'DENIED', message: 'Conversation history unavailable' })
  );

  // `fs.writeFile` is confined below alongside the other read/write ops, once
  // `trustedReadPath` is in scope (it takes a single absolute path, like readFile).
}

