import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HostInstallDrawerView } from '../HostInstallDrawer.js';

describe('HostInstallDrawerView', () => {
  it('renders live logs, the failure, and a copy-command footer', () => {
    const html = renderToStaticMarkup(
      <HostInstallDrawerView
        busy={false}
        kind="install"
        target="limited-pony"
        logs={['Installing host daemon over SSH…', 'host daemon did not report connected']}
        error="The host daemon started but never connected back. Retry, or copy the SSH command."
        pairingCommand="ssh -R 18782:127.0.0.1:8780 limited-pony 'curl …'"
        onClose={vi.fn()}
        onCopyPairing={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="host-install-drawer"');
    expect(html).toContain('Install failed');
    expect(html).toContain('limited-pony');
    expect(html).toContain('host daemon did not report connected');
    expect(html).toContain('never connected back');
    expect(html).toContain('Copy install command');
  });

  it('sits beside the notifications drawer in the shell', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('<HostInstallDrawer />');
    expect(app).toContain('<NotificationsDrawer />');
  });

  it('auto-closes after a successful reconnect and stays open on failure', () => {
    const source = readFileSync(new URL('../HostInstallDrawer.tsx', import.meta.url), 'utf8');
    expect(source).toContain('hostInstallDrawerShouldAutoClose');
    expect(source).toContain('HOST_INSTALL_SUCCESS_CLOSE_MS');
    expect(source).toContain('closeAfterSuccessRef');
    expect(source).toContain('setOpen(false)');
  });
});
