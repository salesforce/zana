import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AgentMonitor thread selection', () => {
  it('does not feed a thread id to the PTY monitor selection store', () => {
    const source = readFileSync(new URL('./AgentMonitor.tsx', import.meta.url), 'utf8');
    expect(source).toContain('resolveMonitorSelection');
    expect(source).toContain("selected.kind === 'agent'");
    expect(source).toContain('selectMonitorAgent(selected.card.session.id, selected.projectId)');
    expect(source).toContain('clearMonitorAgent()');
    expect(source).toContain('data-testid="agent-monitor-thread"');
    expect(source).not.toContain('selectMonitorAgent(selected.id');
    expect(source).not.toContain('selectMonitorAgent(item.id');
  });

  it('mounts the live thread in the monitor instead of an open-elsewhere placeholder', () => {
    const source = readFileSync(new URL('./AgentMonitor.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<ThreadDetail threadId={thread.id} embedded />');
    expect(source).toContain("selected?.kind === 'thread' ? 'is-thread'");
    expect(source).toContain("selected?.kind === 'agent' ? 'is-agent-session'");
    expect(source).toContain('<AgentSessionView');
    expect(source).not.toContain('AgentMonitorAgentStatus');
    expect(source).not.toContain('agent-monitor-thread-placeholder');
    expect(source).not.toContain('Open thread');
    expect(source).not.toContain('getThreadRoutePath');
  });

  it('opens the shared thread and agent context menus from monitor rows', () => {
    const source = readFileSync(new URL('./AgentMonitor.tsx', import.meta.url), 'utf8');
    expect(source).toContain('openThreadMenu(e, item.thread, setThreadMenu)');
    expect(source).toContain('onContextMenu={onContextMenu}');
    expect(source).toContain('<ThreadCardMenu menu={threadMenu}');
    expect(source).toContain('<AgentCardMenu');
    expect(source).toContain('createPortal(');
    expect(source).toContain('document.body');
    expect(source).toContain('openAgentInWorkspace');
  });

  it('uses the thread harness icon instead of a chat bubble', () => {
    const source = readFileSync(new URL('./AgentMonitor.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<ProviderIcon providerId={item.thread.providerId}');
    expect(source).not.toContain('MessageSquare');
  });
});
