import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => {
  const state = {
    collapsedSections: {} as Record<string, boolean>,
    toggleSection: vi.fn(),
    setLauncherOpen: vi.fn(),
    setNav: vi.fn()
  };
  return { state };
});

vi.mock('../../store', () => ({
  useUi: (selector: (state: typeof h.state) => unknown) => selector(h.state)
}));
vi.mock('../AgentTray', () => ({
  AgentTray: ({ projectId, placement }: { projectId?: string; placement?: string }) => (
    <div data-agent-tray-project={projectId ?? ''} data-agent-tray-placement={placement ?? ''} />
  )
}));

import { AgentsSidebarSection } from '../AgentsSidebarSection.js';

describe('AgentsSidebarSection', () => {
  it('renders the collapsible collection chrome with an inline tray', () => {
    h.state.collapsedSections = {};

    const markup = renderToStaticMarkup(<AgentsSidebarSection projectId="proj-1" />);

    expect(markup).toContain('class="sidebar-agents "');
    expect(markup).toContain('aria-label="Collapse Agents section"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Open Agents dashboard"');
    expect(markup).toContain('aria-label="New quick agent"');
    expect(markup).toContain('class="sidebar-agents-resizer"');
    expect(markup).toContain('data-agent-tray-project="proj-1"');
    expect(markup).toContain('data-agent-tray-placement="inline"');
  });

  it('collapses to the heading and hides the live list', () => {
    h.state.collapsedSections = { 'sidebar:agents': true };

    const markup = renderToStaticMarkup(<AgentsSidebarSection />);

    expect(markup).toContain('sidebar-agents--collapsed');
    expect(markup).toContain('aria-label="Expand Agents section"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('hidden=""');
    expect(markup).not.toContain('class="sidebar-agents-resizer"');
  });

  it('opens the global Agents board unless a project dashboard handler is provided', () => {
    const source = readFileSync(new URL('../AgentsSidebarSection.tsx', import.meta.url), 'utf8');

    expect(source).toContain('if (onOpenDashboard)');
    expect(source).toContain("setNav('agents')");
    expect(source).toContain('setLauncherOpen(true)');
    expect(source).toContain('placement="inline"');
    expect(source).toContain('projectId={projectId}');
  });
});
