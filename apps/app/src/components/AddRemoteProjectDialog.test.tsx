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
      busy={false}
      canSubmit={true}
      onFilterChange={vi.fn()}
      onRefresh={vi.fn()}
      onPickHost={vi.fn()}
      onNameChange={vi.fn()}
      onUserChange={vi.fn()}
      onRemotePathChange={vi.fn()}
      onProxyJumpChange={vi.fn()}
      onSubmit={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe('AddRemoteProjectDialogView', () => {
  it('lists SSH hosts and registers without installing a host daemon', () => {
    const html = renderToStaticMarkup(view());
    expect(html).toContain('Add remote project');
    expect(html).toContain('limited-pony');
    expect(html).toContain('educational-roadrunner');
    expect(html).toContain('kit-kat');
    expect(html).toContain('>Add<');
    expect(html).not.toContain('Add and install');
    expect(html).toContain('Threads run on a host daemon');
    expect(html).toContain('Install the host daemon later from the composer');
    expect(html).not.toContain('SSHs from this computer');
    expect(html).not.toContain('data-testid="remote-install-log"');
    expect(html).not.toContain('data-testid="remote-pairing-command"');
  });

  it('locks the form while adding', () => {
    const html = renderToStaticMarkup(view({
      busy: true,
      canSubmit: false
    }));
    expect(html).toContain('disabled=""');
    expect(html).toContain('>Add<');
    expect(html).not.toContain('Installing…');
  });
});
