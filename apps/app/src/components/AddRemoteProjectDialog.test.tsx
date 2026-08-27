import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AddRemoteProjectDialogView } from './AddRemoteProjectDialog.js';
import type { SshHostEntry } from '@zana-ai/zcc-domain/product';

const hosts: SshHostEntry[] = [
  {
    alias: 'limited-pony',
    hostname: 'cursorssh-1.example',
    user: 'sfwork'
  },
  { alias: 'educational-roadrunner', user: 'sfwork' },
  { alias: 'kit-kat', user: 'sfwork' }
];

function view(overrides: Partial<Parameters<typeof AddRemoteProjectDialogView>[0]> = {}) {
  return (
    <AddRemoteProjectDialogView
      hosts={hosts}
      filtered={hosts}
      filter=""
      loading={false}
      warning={null}
      error={null}
      picked="limited-pony"
      name="limited-pony"
      user=""
      remotePath=""
      proxyJump=""
      installHost={true}
      created={false}
      busy={false}
      installing={false}
      installLogs={[]}
      pairingCommand={null}
      canSubmit={true}
      onFilterChange={vi.fn()}
      onRefresh={vi.fn()}
      onPickHost={vi.fn()}
      onNameChange={vi.fn()}
      onUserChange={vi.fn()}
      onRemotePathChange={vi.fn()}
      onProxyJumpChange={vi.fn()}
      onInstallHostChange={vi.fn()}
      onSubmit={vi.fn()}
      onSkip={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe('AddRemoteProjectDialogView', () => {
  it('lists SSH hosts and defaults to installing the host daemon', () => {
    const html = renderToStaticMarkup(view());
    expect(html).toContain('Add remote project');
    expect(html).toContain('limited-pony');
    expect(html).toContain('educational-roadrunner');
    expect(html).toContain('kit-kat');
    expect(html).toContain('data-testid="remote-install-host"');
    expect(html).toContain('Install host daemon on this machine');
    expect(html).toContain('Add and install');
    expect(html).toContain('checked=""');
  });

  it('lets the user add an SSH remote without installing a daemon', () => {
    const html = renderToStaticMarkup(view({ installHost: false }));
    expect(html).toContain('Add project');
    expect(html).not.toContain('Add and install');
  });

  it('shows install progress and locks the form', () => {
    const html = renderToStaticMarkup(view({
      busy: true,
      installing: true,
      canSubmit: false,
      installLogs: ['Installing host daemon over SSH…']
    }));
    expect(html).toContain('Installing…');
    expect(html).toContain('data-testid="remote-install-log"');
    expect(html).toContain('Installing host daemon over SSH…');
    expect(html).toContain('disabled=""');
  });

  it('offers retry and a copy-paste command when install fails after the project exists', () => {
    const html = renderToStaticMarkup(view({
      created: true,
      error: 'Set a public app URL first',
      pairingCommand: 'curl -fL https://box.example/install.sh | sh',
      canSubmit: true
    }));
    expect(html).toContain('Retry install');
    expect(html).toContain('Continue without daemon');
    expect(html).toContain('data-testid="remote-pairing-command"');
    expect(html).toContain('curl -fL https://box.example/install.sh | sh');
    expect(html).not.toContain('>Cancel<');
  });
});
