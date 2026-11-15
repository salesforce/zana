import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import {
  BB_IDE_URL,
  CLAUDE_CODE_URL,
  CODEX_URL,
  CURSOR_URL,
  GITHUB_REPO_URL
} from '@zana-ai/zcc-domain/product';

vi.mock('../../lib/product-client.js', () => ({
  product: {
    app: { version: async () => '1.0.0' },
    updates: { simulate: vi.fn() }
  }
}));

const updates = vi.hoisted(() => ({
  status: { kind: 'idle' } as { kind: string; version?: string; message?: string },
  progress: null as { percent: number } | null
}));

vi.mock('@/store', () => ({
  useUpdates: (selector: (s: typeof updates) => unknown) => selector(updates),
  openWhatsNewAll: vi.fn()
}));

import { AboutView } from './AboutView.js';

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('AboutView credits', () => {
  it('credits the bb IDE rebase and the products that inspired Zana', () => {
    const html = renderToStaticMarkup(
      <AboutView config={config} onUpdate={async () => undefined} />
    );

    expect(html).toContain('settings-anchor-about-credits');
    expect(html).toContain('rebased on the awesome');
    expect(html).toContain(`href="${BB_IDE_URL}"`);
    expect(html).toContain(`href="${CURSOR_URL}"`);
    expect(html).toContain(`href="${CODEX_URL}"`);
    expect(html).toContain(`href="${CLAUDE_CODE_URL}"`);
    expect(html).toContain(`>bb</a>,`);
    expect(html).toContain('Inspired by');
    expect(html).toContain('Cursor');
    expect(html).toContain('Codex');
    expect(html).toContain('Claude Code');
  });

  it('keeps a Star on GitHub link next to the release notes', () => {
    const html = renderToStaticMarkup(
      <AboutView config={config} onUpdate={async () => undefined} />
    );
    expect(html).toContain(`href="${GITHUB_REPO_URL}"`);
    expect(html).toContain('Star on GitHub');
  });
});

describe('AboutView update status', () => {
  const render = () => renderToStaticMarkup(<AboutView config={config} onUpdate={async () => undefined} />);

  it('uses the fairy spinner while checking and downloading', () => {
    updates.status = { kind: 'checking' };
    expect(render()).toContain('Checking for updates…');
    expect(render()).toContain('fairy-spinner');

    updates.status = { kind: 'downloading', version: '2.0.0' };
    updates.progress = { percent: 41.6 };
    const downloading = render();
    expect(downloading).toContain('Downloading v2.0.0…');
    expect(downloading).toContain('42% complete');
    expect(downloading).toContain('fairy-spinner');

    updates.status = { kind: 'downloading' };
    updates.progress = null;
    const unknown = render();
    expect(unknown).toContain('Downloading update…');
    expect(unknown).not.toContain('% complete');

    updates.status = { kind: 'idle' };
  });

  it.each([
    [{ kind: 'idle' }, 'No update check yet'],
    [{ kind: 'disabled' }, 'Auto-update unavailable'],
    [{ kind: 'available', version: '2.0.0' }, 'Version 2.0.0 is available'],
    [{ kind: 'not-available' }, 'on the latest version'],
    [{ kind: 'downloaded', version: '2.0.0' }, 'Version 2.0.0 is ready'],
    [{ kind: 'error', message: 'offline' }, 'offline']
  ])('renders the %o status without a spinner', (status, text) => {
    updates.status = status;
    updates.progress = null;
    const html = render();
    expect(html).toContain(text);
    expect(html).not.toContain('fairy-spinner');
    updates.status = { kind: 'idle' };
  });
});
