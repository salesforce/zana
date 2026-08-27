import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import {
  BB_IDE_URL,
  CLAUDE_CODE_URL,
  CODEX_URL,
  CURSOR_URL
} from '@zana-ai/zcc-domain/product';

vi.mock('../../lib/product-client.js', () => ({
  product: {
    app: { version: async () => '1.0.0' },
    updates: { simulate: vi.fn() }
  }
}));

vi.mock('@/store', () => ({
  useUpdates: (selector: (s: { status: { kind: string }; progress: null }) => unknown) =>
    selector({ status: { kind: 'idle' }, progress: null }),
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
});
