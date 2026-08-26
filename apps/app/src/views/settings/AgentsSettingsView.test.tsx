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

  it('places PTY session ceilings under Legacy Agent', () => {
    const html = renderToStaticMarkup(
      <AgentsTab
        config={config}
        onConfigDraft={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />
    );
    expect(html).toContain('Legacy Agent');
    expect(html).toContain('Max live sessions');
    expect(html).toContain('Agent heap limit (MB)');
    expect(html).not.toContain('Performance &amp; limits');
  });
});
