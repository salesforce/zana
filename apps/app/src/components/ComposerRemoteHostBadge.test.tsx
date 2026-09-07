import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComposerRemoteHostBadge } from './ComposerRemoteHostBadge.js';

describe('ComposerRemoteHostBadge', () => {
  it('shows an Offline pill without the remote filesystem path or host name', () => {
    const html = renderToStaticMarkup(
      <ComposerRemoteHostBadge status="offline" />
    );
    expect(html).toContain('data-testid="composer-remote-host-badge"');
    expect(html).toContain('Offline');
    expect(html).toContain('is-offline');
    expect(html).not.toContain('/home/sfwork');
    expect(html).not.toContain('limited-pony');
    expect(html).not.toContain('composer-remote-host-path');
  });

  it('shows an Online pill when the daemon is connected', () => {
    const html = renderToStaticMarkup(
      <ComposerRemoteHostBadge status="online" />
    );
    expect(html).toContain('Online');
    expect(html).toContain('is-online');
    expect(html).not.toContain('Offline');
    expect(html).not.toContain('/src');
  });
});
