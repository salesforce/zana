import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComposerRemoteHostBadge } from './ComposerRemoteHostBadge.js';

describe('ComposerRemoteHostBadge', () => {
  it('shows the remote path and an Offline pill without repeating the host name', () => {
    const html = renderToStaticMarkup(
      <ComposerRemoteHostBadge path="/home/sfwork" status="offline" />
    );
    expect(html).toContain('data-testid="composer-remote-host-badge"');
    expect(html).toContain('/home/sfwork');
    expect(html).toContain('Offline');
    expect(html).toContain('is-offline');
    expect(html).not.toContain('limited-pony');
  });

  it('shows an Online pill when the daemon is connected', () => {
    const html = renderToStaticMarkup(
      <ComposerRemoteHostBadge path="/src" status="online" />
    );
    expect(html).toContain('Online');
    expect(html).toContain('is-online');
    expect(html).not.toContain('Offline');
  });
});
