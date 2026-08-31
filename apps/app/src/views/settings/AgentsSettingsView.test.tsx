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
    expect(html).toContain(
      'aria-checked="true" aria-label="Include scheduled agents in Agent View"'
    );
  });

  it('groups CLI Agent, Overseer, and Auto mode after general settings, Auto mode last', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const worktrees = html.indexOf('settings-anchor-git-worktrees');
    const idle = html.indexOf('settings-anchor-auto-close-idle');
    const cli = html.indexOf('settings-anchor-legacy-agent');
    const overseer = html.indexOf('settings-anchor-overseer');
    const autoMode = html.indexOf('settings-anchor-auto-mode');
    expect(worktrees).toBeGreaterThan(-1);
    expect(idle).toBeGreaterThan(worktrees);
    expect(cli).toBeGreaterThan(idle);
    expect(overseer).toBeGreaterThan(cli);
    expect(autoMode).toBeGreaterThan(overseer);
    expect(html.lastIndexOf('<h3>')).toBe(html.indexOf('<h3>Auto mode</h3>'));
  });
});
