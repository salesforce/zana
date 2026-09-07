import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ComposerHostActionChip } from './ComposerHostActionChip.js';

describe('ComposerHostActionChip', () => {
  it('renders Install as a clickable host-daemon CTA', () => {
    const html = renderToStaticMarkup(
      <ComposerHostActionChip
        action={{ kind: 'install', label: 'Install', reason: 'Install a host daemon on limited-pony' }}
        onAction={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="composer-host-action"');
    expect(html).toContain('Install host daemon');
    expect(html).toContain('is-cta');
    expect(html).toContain('is-install');
    expect(html).toContain('aria-label="Install a host daemon on limited-pony"');
    expect(html).not.toContain('disabled');
  });

  it('renders Fix as the same kind of clickable CTA', () => {
    const html = renderToStaticMarkup(
      <ComposerHostActionChip
        action={{
          kind: 'fix',
          hostId: 'h-remote',
          label: 'Fix',
          reason: 'limited-pony is offline'
        }}
        onAction={vi.fn()}
      />
    );
    expect(html).toContain('Fix connection');
    expect(html).toContain('is-cta');
    expect(html).not.toContain('is-install');
    expect(html).toContain('aria-label="limited-pony is offline"');
    expect(html).not.toContain('disabled');
  });
});
