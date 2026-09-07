import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./TerminalSurface.tsx', import.meta.url), 'utf8');

describe('TerminalSurface agent-session portal', () => {
  it('ranks the inspector modal above the session page, then monitor, then the inspector terminal tab over project terminals', () => {
    expect(source).toContain('projectTerminalsPaneId');
    expect(source).toContain('pickAgentSessionPortalTarget');
    expect(source).toContain('pickProjectTerminalsPortalTarget');
    expect(source).toContain('projectTerminalsAnchorId(projectTerminalsPaneId)');
    expect(source).toContain('agentSessionAnchorId(agentSessionId)');
    expect(source).toContain('const modalAnchor');
    expect(source).toContain('const agentSessionAnchor');
    expect(source.indexOf('const modalAnchor')).toBeLessThan(source.indexOf('const agentSessionAnchor'));
    expect(source.indexOf('const agentSessionAnchor')).toBeLessThan(source.indexOf('const monitorAnchor'));
    expect(source.indexOf('const threadPanelAnchor')).toBeLessThan(source.indexOf('const projectTerminalsAnchor'));
    expect(source).toContain('else if (agentSession)');
    expect(source).toContain('else if (projectTerminals)');
    expect(source.indexOf('if (agentModal)')).toBeLessThan(source.indexOf('else if (agentSession)'));
    expect(source.indexOf('else if (agentSession)')).toBeLessThan(source.indexOf('else if (agentMonitor)'));
    expect(source.indexOf('else if (threadPanelTerminal)')).toBeLessThan(source.indexOf('else if (projectTerminals)'));
  });
});
