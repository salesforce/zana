import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('AgentTerminalModal secondary panel', () => {
  it('hosts AgentSessionView instead of the dedicated inspector column', () => {
    const source = readFileSync(new URL('./AgentTerminalModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<AgentSessionView');
    expect(source).toContain('footer={modalActions}');
    expect(source).toContain('data-testid="agent-terminal-modal"');
    expect(source).toContain('data-testid="agent-modal-header"');
    expect(source.indexOf('agent-modal-header')).toBeLessThan(source.indexOf('<AgentSessionView'));
    expect(source).toContain('showProject\n            modal');
    expect(source).toContain('Close Session');
    expect(source).toContain('Close with follow-up');
    expect(source).not.toContain('AgentDetailPanel');
    expect(source).not.toContain('useAgentPanel');
    expect(source).not.toContain('product.threads.create');
    expect(source).not.toContain('Changes');
  });
});
