import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('AgentTerminalModal secondary panel', () => {
  it('hosts AgentSessionView instead of the dedicated inspector column', () => {
    const source = readFileSync(new URL('./AgentTerminalModal.tsx', import.meta.url), 'utf8');
    const css = readFileSync(fileURLToPath(new URL('../styles/global.css', import.meta.url)), 'utf8');
    expect(source).toContain('<AgentSessionView');
    expect(source).toContain('footer={modalActions}');
    expect(source).toContain('data-testid="agent-terminal-modal"');
    expect(source).toContain('data-testid="agent-modal-header"');
    expect(source).toContain('className="agent-modal-window-controls"');
    expect(source).not.toContain('agent-modal-title');
    expect(source).not.toContain('agent-modal-heading');
    expect(source).not.toContain('agent-modal-icon');
    expect(source.indexOf('agent-modal-header')).toBeLessThan(source.indexOf('<AgentSessionView'));
    expect(source.indexOf('data-testid="agent-modal-state"')).toBeLessThan(
      source.indexOf('className="agent-modal-window-controls"')
    );
    expect(css).toContain('.agent-modal-window-controls');
    expect(css).not.toContain('.agent-modal-title');
    expect(css).not.toContain('.agent-modal-heading');
    expect(source).toContain('showProject\n            modal');
    expect(source).toContain('Close Session');
    expect(source).toContain('Close with follow-up');
    expect(source).toContain('closeAgentWithFollowup(session, projectId)');
    expect(source).toContain('canCloseWithFollowup(session)');
    expect(source).not.toContain('AgentDetailPanel');
    expect(source).not.toContain('useAgentPanel');
    expect(source).not.toContain('product.threads.create');
    expect(source).not.toContain('Changes');
  });
});
