import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  status: 'idle' as string,
  subagents: 0
}));

vi.mock('../../store.js', () => ({
  useAgentStatus: (selector: (state: { byId: Record<string, string> }) => unknown) =>
    selector({ byId: { s1: h.status } }),
  useSubagents: (selector: (state: { byId: Record<string, number> }) => unknown) =>
    selector({ byId: { s1: h.subagents } })
}));

import { AgentRowDetail } from './AgentRowDetail.js';

function session(over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 's1',
    title: 'CLI session',
    status: 'running',
    profile: 'claude',
    createdAt: Date.now() - 60_000,
    ...over
  } as TerminalSession;
}

describe('AgentRowDetail', () => {
  it('names a live PTY row with the same harness/runtime line as the board card', () => {
    h.status = 'idle';
    h.subagents = 0;
    const html = renderToStaticMarkup(<AgentRowDetail session={session()} />);
    expect(html).toContain('Idle');
    expect(html).toContain('Claude Code · Local');
    expect(html).toContain('started');
    expect(html).not.toContain('CLI Agent');
    expect(html).not.toContain('Thread');
  });

  it('marks an SSH project as Remote host', () => {
    h.status = 'working';
    h.subagents = 0;
    const html = renderToStaticMarkup(
      <AgentRowDetail session={session()} projectRemote />
    );
    expect(html).toContain('Working');
    expect(html).toContain('Claude Code · Remote host');
    expect(html).not.toContain('CLI Agent');
  });

  it('keeps harness/runtime on an exited row that has no live state word', () => {
    h.status = 'done';
    h.subagents = 2;
    const html = renderToStaticMarkup(
      <AgentRowDetail session={session({ status: 'exited', finishedAt: Date.now() - 5_000 })} />
    );
    expect(html).toContain('Claude Code · Local');
    expect(html).toContain('exited');
    expect(html).not.toContain('sub-agent');
    expect(html).not.toContain('CLI Agent');
  });
});
