import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { AgentsTab } from '@/views/settings/AgentsSettingsView';

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  worktreeIsolationDefault: true
};

describe('AgentsTab worktree isolation', () => {
  it('renders the global default as an accessible checked control', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Git worktrees');
    expect(html).toContain('Prefer a new git worktree by default');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Prefer a new git worktree by default"');
    expect(html).not.toContain('type="checkbox"');
  });

  it('places PTY session ceilings under CLI Agent', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('CLI Agent');
    expect(html).toContain('Max live sessions');
    expect(html).toContain('Agent heap limit (MB)');
    expect(html).toContain('Remote defaults');
    expect(html).not.toContain('Performance &amp; limits');
  });

  it('offers a global toggle to include scheduled agents in Agent View', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('settings-anchor-scheduled');
    expect(html).toContain('>Scheduled<');
    expect(html).toContain('Include scheduled agents in Agent View');
    expect(html).toContain('aria-label="Include scheduled agents in Agent View"');
    expect(html).toContain('Scheduled column');
    expect(html).toContain('Off hides every scheduled session from Agent View');
    expect(html).toContain('including one that is currently working');
    expect(html).toContain('Scheduled runs never appear under a project in the sidebar');
    expect(html).toContain(
      'aria-checked="true" aria-label="Include scheduled agents in Agent View"'
    );
  });

  it('exposes a Default plan mode picklist that defaults to Infer (freeform)', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Default plan mode');
    expect(html).toContain('aria-label="Default plan mode"');
    // Absent config → the picklist shows the infer default (today's behavior).
    expect(html).toContain('Infer plan from goal');
  });

  it('reflects a persisted structured default in the plan-mode picklist', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={{ ...config, teamDefaultCoordinationMode: 'structured' }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Plan provided in goal');
  });

  it('exposes a Plan startup grace field defaulting to 300 seconds when unset', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Plan startup grace (seconds)');
    expect(html).toContain('auto-failing');
    // Absent config → 300_000 ms default renders as 300 seconds.
    expect(html).toContain('value="300"');
  });

  it('renders the persisted grace in seconds (ms ÷ 1000)', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={{ ...config, executionPlanStartupGraceMs: 600_000 }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('value="600"');
  });

  it('renders grace 0 (disabled) without falling back to the default', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={{ ...config, executionPlanStartupGraceMs: 0 }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('value="0"');
  });

  it('exposes an orchestrator MCP denylist field, empty by default', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Disable orchestrator MCP servers');
    // Absent config → empty textarea (no server names disabled).
    expect(html).toContain('<textarea');
  });

  it('renders a persisted orchestrator MCP denylist newline-joined', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={{ ...config, orchestratorMcpServerDenylist: ['mcp-adaptor', 'other'] }}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('mcp-adaptor\nother');
  });

  it('uses orchestrator (not coordinator) in Teams organization help text', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('each orchestrator and its workers together');
    expect(html).toContain('one orchestrator row per run');
    expect(html).not.toContain('each coordinator and its workers');
    expect(html).not.toContain('one coordinator row per run');
  });

  it('groups CLI Agent, Overseer, and Auto mode after general settings, Auto mode last', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const guidance = html.indexOf('settings-anchor-agent-guidance');
    const worktrees = html.indexOf('settings-anchor-git-worktrees');
    const idle = html.indexOf('settings-anchor-auto-close-idle');
    const cli = html.indexOf('settings-anchor-legacy-agent');
    const overseer = html.indexOf('settings-anchor-overseer');
    const autoMode = html.indexOf('settings-anchor-auto-mode');
    expect(guidance).toBeGreaterThan(-1);
    expect(worktrees).toBeGreaterThan(guidance);
    expect(idle).toBeGreaterThan(worktrees);
    expect(cli).toBeGreaterThan(idle);
    expect(overseer).toBeGreaterThan(cli);
    expect(autoMode).toBeGreaterThan(overseer);
    expect(html.lastIndexOf('<h3>')).toBe(html.indexOf('<h3>Auto mode</h3>'));
  });
});
