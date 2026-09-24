// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { listClaudeSessions } from '@zana-ai/zcc-server/services/projects/claude';
import { gitCommonDir } from '@zana-ai/zcc-server/services/projects/git';
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
  ctx.safeHandleFromWindow<[{ projectId?: unknown; filter?: unknown; query?: unknown }], ConversationHistorySnapshot>(
    IPC.history.start,
    (win, input: { projectId?: unknown; filter?: unknown; query?: unknown }) => {
      if (!input || !['project', 'all'].includes(input.filter)) return ctx.conversationHistory.get(win.id, '');
      const projectId = typeof input.projectId === 'string' ? input.projectId : undefined;
      if (input.filter === 'project' && !projectId) return ctx.conversationHistory.get(win.id, '');
      if (projectId && !store.listProjects().some((project) => project.id === projectId && !project.remote)) {
        return ctx.conversationHistory.get(win.id, '');
      }
      return ctx.conversationHistory.start(win.id, projectId, typeof input.query === 'string' ? input.query : '');
    },
    () => ctx.conversationHistory.get(-1, '')
  );
  ctx.safeHandleFromWindow<[unknown], ConversationHistorySnapshot>(
    IPC.history.refresh,
    (win, snapshotId: unknown) => {
      const current = ctx.conversationHistory.get(win.id, snapshotId);
      if (current.status === 'expired') return current;
      const projectId = ctx.conversationHistory.scope(win.id, snapshotId);
      const query = ctx.conversationHistory.query(win.id, snapshotId);
      ctx.conversationHistory.release(win.id, snapshotId);
      return ctx.conversationHistory.refresh(win.id, projectId, query);
    },
    () => ctx.conversationHistory.get(-1, '')
  );
  ctx.safeHandleFromWindow<[unknown, unknown], ConversationHistorySnapshot>(
    IPC.history.page,
    (win, snapshotId: unknown, opaquePageCursor: unknown) => {
      return ctx.conversationHistory.get(win.id, snapshotId, opaquePageCursor);
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
      if (realpathSync(project.path) !== realpathSync(row.projectPath)) return { ok: false, code: 'DENIED', message: 'The original project directory has changed' };
      if (!await ctx.conversationHistory.validate(row)) return { ok: false, code: 'NOT_FOUND', message: 'The saved conversation is unavailable or no longer belongs to this project.' };
      const resume = ctx.conversationHistory.provider(row.source)?.resume?.(row.nativeConversationId);
      if (!resume) return { ok: false, code: 'DENIED', message: 'Exact native resume is unavailable' };
      return ctx.createInteractiveTerminal({
        projectId: project.id,
        cwd: realpathSync(project.path),
        cols: 80,
        rows: 24,
        title: row.title,
        ...resume
      });
    },
    () => ({ ok: false, code: 'DENIED', message: 'Conversation history unavailable' })
  );

  ctx.safeHandleFromWindow(
    IPC.history.transcript,
    async (win, snapshotId: unknown, historyId: unknown) => {
      const row = ctx.conversationHistory.find(win.id, snapshotId, historyId);
      const project = row && store.listProjects().find((entry) => entry.id === row.projectId && !entry.remote);
      if (!row || !project || realpathSync(project.path) !== realpathSync(row.projectPath)) return { messages: [], truncated: false, unavailableReason: 'Conversation history is unavailable. Refresh history and try again.' };
      return ctx.conversationHistory.transcript(row);
    },
    () => ({ messages: [], truncated: false, unavailableReason: 'Conversation history is unavailable.' })
  );

  // `fs.writeFile` is confined below alongside the other read/write ops, once
  // `trustedReadPath` is in scope (it takes a single absolute path, like readFile).
}

