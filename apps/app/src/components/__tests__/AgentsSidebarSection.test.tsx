import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';

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

function renderSection(node: ReactElement, path = '/') {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
}

describe('AgentsSidebarSection', () => {
  it('renders the collapsible collection chrome with an inline tray', () => {
    h.state.collapsedSections = {};

    const markup = renderSection(<AgentsSidebarSection projectId="proj-1" />);

    expect(markup).toContain('class="sidebar-agents "');
    expect(markup).toContain('data-testid="sidebar-agents-heading"');
    expect(markup).toContain('href="/projects/proj-1"');
    expect(markup).toContain('>Agents</a>');
    expect(markup).toContain('data-testid="sidebar-agents-toggle"');
    expect(markup).toContain('aria-label="Collapse Agents section"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Open Agents dashboard"');
    expect(markup).toContain('aria-label="New thread"');
    expect(markup).toContain('class="sidebar-agents-resizer"');
    expect(markup).toContain('--sidebar-agents-height');
    expect(markup).toContain('data-agent-tray-project="proj-1"');
    expect(markup).toContain('data-agent-tray-placement="inline"');
  });

  it('collapses to the heading and hides the live list', () => {
    h.state.collapsedSections = { 'sidebar:agents': true };

    const markup = renderSection(<AgentsSidebarSection />);

    expect(markup).toContain('sidebar-agents--collapsed');
    expect(markup).toContain('href="/agents"');
    expect(markup).toContain('aria-label="Expand Agents section"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('hidden=""');
    expect(markup).not.toContain('--sidebar-agents-height');
    expect(markup).not.toContain('class="sidebar-agents-resizer"');
  });

  it('marks the Agents label as the current page on the matching route', () => {
    const projectMarkup = renderSection(
      <AgentsSidebarSection projectId="proj-1" />,
      '/projects/proj-1'
    );
    expect(projectMarkup).toContain('aria-current="page"');
    expect(projectMarkup).toContain('sidebar-agents-heading active');

    const otherMode = renderSection(
      <AgentsSidebarSection projectId="proj-1" />,
      '/projects/proj-1/scheduler'
    );
    expect(otherMode).not.toContain('aria-current="page"');

    const globalMarkup = renderSection(<AgentsSidebarSection />, '/agents');
    expect(globalMarkup).toContain('href="/agents"');
    expect(globalMarkup).toContain('aria-current="page"');
  });

  it('opens the Agents board from the label; only the chevron toggles the tray', () => {
    const source = readFileSync(new URL('../AgentsSidebarSection.tsx', import.meta.url), 'utf8');

    expect(source).toContain('if (onOpenDashboard)');
    expect(source).toContain("setNav('agents')");
    expect(source).not.toContain('setLauncherOpen(true)');
    expect(source).toContain('navigate(getRootRoutePath())');
    expect(source).toContain('placement="inline"');
    expect(source).toContain('projectId={projectId}');
    expect(source).toContain('getProjectWorkspaceRoutePath(projectId, \'agents\')');
    expect(source).toContain('getAgentsRoutePath()');
    expect(source).toContain('data-testid="sidebar-agents-heading"');
    expect(source).toContain('data-testid="sidebar-agents-toggle"');
    const headingStart = source.indexOf('data-testid="sidebar-agents-heading"');
    const toggleStart = source.indexOf('data-testid="sidebar-agents-toggle"');
    expect(headingStart).toBeGreaterThan(-1);
    expect(toggleStart).toBeGreaterThan(headingStart);
    expect(source.slice(headingStart, toggleStart)).not.toContain('toggleSection');
    expect(source.slice(toggleStart, toggleStart + 400)).toContain('toggleSection(AGENTS_SECTION_KEY)');
    expect(source).toContain('<LayoutDashboard size={14} />');
    expect(source).toContain('<MessageCirclePlus size={14} />');
  });
});
