import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AddMachineDialogView } from './AddMachineDialog.js';

const command = 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 https://box.tailnet.ts.net/install.sh | sh -s -- --join-code zcde_abc --host-id host-1 --server https://box.tailnet.ts.net';
const loopbackCommand = 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:8780/install.sh | sh -s -- --join-code zcde_abc --host-id host-1 --server http://127.0.0.1:8780';
const sshCommand = "ssh -o ExitOnForwardFailure=yes -R 18782:127.0.0.1:8780 limited-pony 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:18782/install.sh | sh -s -- --join-code zcde_abc --host-id host-1 --server http://127.0.0.1:18782'";

function view(overrides: Partial<Parameters<typeof AddMachineDialogView>[0]> = {}) {
  return (
    <AddMachineDialogView
      command={command}
      copied={false}
      remainingMs={14 * 60_000 + 58_000}
      expired={false}
      mintError={null}
      loopbackWarning={false}
      viaSsh={false}
      sshHost=""
      sshHosts={[]}
      pairedName={null}
      onSshHostChange={vi.fn()}
      onCopy={vi.fn()}
      onRetryMint={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );
}

describe('AddMachineDialogView', () => {
  it('shows the pairing command, copy, expiry, and waiting status', () => {
    const html = renderToStaticMarkup(view());
    expect(html).toContain('Add a machine');
    expect(html).toContain('Run this on the machine you want to add');
    expect(html).toContain('data-testid="machines-join-command"');
    expect(html).toContain('--join-code zcde_abc');
    expect(html).toContain('Copy');
    expect(html).toContain('Code expires in 14:58');
    expect(html).toContain('This installs the host daemon');
    expect(html).toContain('Waiting for the machine to connect…');
    expect(html).toContain('Done');
    expect(html).not.toContain('only reachable on this computer');
  });

  it('still shows the installer when the origin is loopback, with a remote-pairing hint', () => {
    const html = renderToStaticMarkup(view({
      command: loopbackCommand,
      remainingMs: 60_000,
      loopbackWarning: true
    }));
    expect(html).toContain('data-testid="machines-join-command"');
    expect(html).toContain('http://127.0.0.1:8780/install.sh');
    expect(html).toContain('Waiting for the machine to connect…');
    expect(html).toContain('only reachable on this computer');
    expect(html).toContain('data-testid="add-machine-ssh-host"');
    expect(html).toContain('No remote projects or SSH hosts found.');
    expect(html).not.toContain('Set a public app URL (Tailscale Serve) before pairing');
  });

  it('copies an SSH reverse-tunnel command for a workspace host', () => {
    const html = renderToStaticMarkup(view({
      command: sshCommand,
      remainingMs: 60_000,
      loopbackWarning: true,
      viaSsh: true,
      sshHost: 'limited-pony',
      sshHosts: [
        { host: 'educational-roadrunner', label: 'Roadrunner', detail: 'educational-roadrunner', group: 'project' },
        { host: 'kit-kat', label: 'kit-kat', group: 'project' },
        { host: 'limited-pony', label: 'Pony', detail: 'limited-pony', group: 'project' },
        { host: 'github-work', label: 'github-work', group: 'ssh-config', detail: 'github.com @grebmann' }
      ]
    }));
    expect(html).toContain('ssh -o ExitOnForwardFailure=yes -R 18782:127.0.0.1:8780 limited-pony');
    expect(html).toContain('Run this in a terminal on this computer');
    expect(html).toContain('Paste it locally');
    expect(html).toContain('Remote projects');
    expect(html).toContain('educational-roadrunner');
    expect(html).toContain('kit-kat');
    expect(html).toContain('limited-pony');
    expect(html).toContain('SSH config');
    expect(html).toContain('github-work');
    expect(html).toContain('role="listbox"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('datalist');
    expect(html).not.toContain('only reachable on this computer');
  });

  it('keeps a typed SSH host visible when it is not in the list', () => {
    const html = renderToStaticMarkup(view({
      loopbackWarning: true,
      sshHost: 'custom-box',
      sshHosts: [{ host: 'limited-pony', label: 'limited-pony', group: 'project' }]
    }));
    expect(html).toContain('custom-box');
    expect(html).toContain('limited-pony');
    expect(html).toContain('aria-selected="true"');
  });

  it('offers a new code after expiry', () => {
    const html = renderToStaticMarkup(view({
      remainingMs: 0,
      expired: true
    }));
    expect(html).toContain('Code expired');
    expect(html).toContain('Generate a new code');
    expect(html).toContain('disabled=""');
  });

  it('flips to connected when the new machine appears', () => {
    const html = renderToStaticMarkup(view({
      copied: true,
      remainingMs: 60_000,
      pairedName: 'studio.local'
    }));
    expect(html).toContain('studio.local connected');
    expect(html).toContain('Copied');
    expect(html).not.toContain('Waiting for the machine to connect…');
  });

  it('surfaces a mint failure with retry', () => {
    const html = renderToStaticMarkup(view({
      command: null,
      remainingMs: null,
      mintError: 'offline'
    }));
    expect(html).toContain('offline');
    expect(html).toContain('Try again');
    expect(html).toContain('Waiting for the machine to connect…');
  });

  it('shows a creating-code placeholder before the command lands', () => {
    const html = renderToStaticMarkup(view({
      command: null,
      remainingMs: null
    }));
    expect(html).toContain('Creating a join code…');
    expect(html).toContain('Waiting for the machine to connect…');
  });
});
