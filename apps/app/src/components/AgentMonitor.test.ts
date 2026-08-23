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
});
