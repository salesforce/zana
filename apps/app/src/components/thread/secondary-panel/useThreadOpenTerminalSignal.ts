import { useEffect, useRef } from 'react';
import { product } from '../../../lib/product-client.js';
import { useData, useUi } from '../../../store.js';
import type { ClosableSecondaryTab, ThreadSecondaryPanelState } from './threadSecondaryPanelState.js';

export const AGENT_TERMINAL_CAP = 3;
export const AGENT_TERMINAL_OPENER_KEY = 'agent-terminal';

export type ThreadOpenTerminalIntent = {
  command: string | null;
  title: string | null;
};

const pendingByThread = new Map<string, ThreadOpenTerminalIntent[]>();
const projectShellsByOwner = new Map<string, string[]>();

export function resetThreadOpenTerminalBuffer(): void {
  pendingByThread.clear();
  projectShellsByOwner.clear();
}

export function bufferThreadOpenTerminal(threadId: string, terminal: ThreadOpenTerminalIntent): void {
  const queued = pendingByThread.get(threadId) ?? [];
  queued.push(terminal);
  pendingByThread.set(threadId, queued);
}

export function consumePendingOpenTerminal(threadId: string): ThreadOpenTerminalIntent | null {
  const queued = pendingByThread.get(threadId);
  if (!queued || queued.length === 0) return null;
  const next = queued.shift() ?? null;
  if (!queued.length) pendingByThread.delete(threadId);
  return next;
}

export const THREAD_OPEN_TERMINAL_EVENT = 'zcc-thread-open-terminal';

export function parseThreadOpenTerminalPayload(payload: unknown): {
  threadId: string;
  projectId: string | null;
  terminal: ThreadOpenTerminalIntent | null;
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.threadId !== 'string' || row.threadId.length === 0) return null;
  const projectId = typeof row.projectId === 'string' && row.projectId.length > 0 ? row.projectId : null;
  if (row.terminal == null) return { threadId: row.threadId, projectId, terminal: null };
  if (typeof row.terminal !== 'object' || Array.isArray(row.terminal)) {
    return { threadId: row.threadId, projectId, terminal: null };
  }
  const terminal = row.terminal as Record<string, unknown>;
  const command = typeof terminal.command === 'string' && terminal.command.trim()
    ? terminal.command.trim()
    : null;
  const title = typeof terminal.title === 'string' && terminal.title.trim()
    ? terminal.title.trim()
    : null;
  return { threadId: row.threadId, projectId, terminal: { command, title } };
}

function tabTitleFor(intent: ThreadOpenTerminalIntent): string {
  return intent.title || intent.command || 'Terminal';
}

function commandPayload(command: string): string {
  return command.endsWith('\n') ? command : `${command}\n`;
}

type PanelCommands = {
  state: Pick<ThreadSecondaryPanelState, 'tabs'>;
  addTab: (tab: Omit<ClosableSecondaryTab, 'id'> & { id?: string }) => void;
  activateTab: (tabId: string) => void;
};

export function agentOwnedTerminalTabs(tabs: ClosableSecondaryTab[]): ClosableSecondaryTab[] {
  return tabs.filter(
    (tab) => tab.kind === 'terminal' && tab.openerKey === AGENT_TERMINAL_OPENER_KEY && Boolean(tab.sessionId)
  );
}

export async function openThreadPanelTerminal(args: {
  projectId: string;
  cwd?: string | null;
  intent: ThreadOpenTerminalIntent;
  panel: PanelCommands;
}): Promise<void> {
  const owned = agentOwnedTerminalTabs(args.panel.state.tabs);
  if (owned.length >= AGENT_TERMINAL_CAP) {
    const last = owned[owned.length - 1];
    if (last?.id) args.panel.activateTab(last.id);
    if (args.intent.command && last?.sessionId) {
      await product.terminals.write(last.sessionId, commandPayload(args.intent.command));
    }
    return;
  }
  const created = await product.terminals.create({
    projectId: args.projectId,
    profile: 'shell',
    cwd: args.cwd ?? undefined,
    cols: 80,
    rows: 24,
    prompt: args.intent.command ?? undefined,
    title: tabTitleFor(args.intent)
  });
  if (created.ok) {
    args.panel.addTab({
      kind: 'terminal',
      title: tabTitleFor(args.intent),
      sessionId: created.value.id,
      openerKey: AGENT_TERMINAL_OPENER_KEY
    });
  }
}

function liveProjectShells(ownerId: string, projectId: string): string[] {
  const ids = projectShellsByOwner.get(ownerId) ?? [];
  const live = useData.getState().terminals[projectId] ?? [];
  const liveIds = new Set(live.filter((session) => session.status !== 'exited').map((session) => session.id));
  const next = ids.filter((id) => liveIds.has(id));
  projectShellsByOwner.set(ownerId, next);
  return next;
}

export function findCliAgentSession(threadId: string): { id: string; projectId: string; cwd?: string } | null {
  const terminals = useData.getState().terminals;
  for (const [projectId, sessions] of Object.entries(terminals)) {
    const session = sessions.find((row) => row.id === threadId);
    if (session) return { id: session.id, projectId, cwd: session.cwd };
  }
  return null;
}

export async function openProjectStripTerminal(args: {
  ownerId: string;
  projectId: string;
  cwd?: string | null;
  intent: ThreadOpenTerminalIntent;
}): Promise<void> {
  const owned = liveProjectShells(args.ownerId, args.projectId);
  if (owned.length >= AGENT_TERMINAL_CAP) {
    const last = owned[owned.length - 1];
    if (last) {
      useUi.getState().selectTab(args.projectId, last);
      if (args.intent.command) {
        await product.terminals.write(last, commandPayload(args.intent.command));
      }
    }
    return;
  }
  const created = await useData.getState().createTerminal(args.projectId, 'shell', 80, 24, {
    cwd: args.cwd ?? undefined,
    prompt: args.intent.command ?? undefined,
    title: tabTitleFor(args.intent)
  });
  if (!created) return;
  const next = [...owned, created.id];
  projectShellsByOwner.set(args.ownerId, next);
  useUi.getState().selectTab(args.projectId, created.id);
}

export function useThreadOpenTerminalSignal({
  threadId,
  environmentId,
  projectId,
  cwd,
  panel
}: {
  threadId: string | null | undefined;
  environmentId: string | null | undefined;
  projectId: string | null | undefined;
  cwd?: string | null;
  panel: PanelCommands;
}): void {
  const openRef = useRef<(intent: ThreadOpenTerminalIntent) => void>(() => undefined);
  openRef.current = (intent) => {
    if (!projectId) return;
    void openThreadPanelTerminal({ projectId, cwd, intent, panel });
  };

  useEffect(() => {
    return product.threads.onOpen((payload) => {
      const parsed = parseThreadOpenTerminalPayload(payload);
      if (!parsed?.terminal) return;
      if (findCliAgentSession(parsed.threadId)) return;
      bufferThreadOpenTerminal(parsed.threadId, parsed.terminal);
    });
  }, []);

  useEffect(() => {
    if (threadId == null || environmentId === undefined || !projectId) return;
    const drain = () => {
      let intent = consumePendingOpenTerminal(threadId);
      while (intent) {
        openRef.current(intent);
        intent = consumePendingOpenTerminal(threadId);
      }
    };
    drain();
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string }>).detail;
      if (detail?.threadId === threadId) drain();
    };
    window.addEventListener(THREAD_OPEN_TERMINAL_EVENT, onLocal);
    const stopHost = product.threads.onOpen((payload) => {
      const parsed = parseThreadOpenTerminalPayload(payload);
      if (parsed?.threadId === threadId && parsed.terminal) drain();
    });
    return () => {
      window.removeEventListener(THREAD_OPEN_TERMINAL_EVENT, onLocal);
      stopHost();
    };
  }, [environmentId, projectId, threadId]);
}

export function useCliAgentTerminalSignal(): void {
  useEffect(() => {
    return product.threads.onOpen((payload) => {
      const parsed = parseThreadOpenTerminalPayload(payload);
      if (!parsed?.terminal) return;
      const session = findCliAgentSession(parsed.threadId);
      if (!session) return;
      void openProjectStripTerminal({
        ownerId: parsed.threadId,
        projectId: session.projectId,
        cwd: session.cwd,
        intent: parsed.terminal
      });
    });
  }, []);
}
