// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostBootstrapEvent } from '@zana-ai/zcc-desktop-contract';
import { AddMachineDialog, AddMachineDialogView } from './AddMachineDialog.js';

const api = vi.hoisted(() => ({
  bridge: true,
  liveHosts: [] as Array<{ id: string; name: string; status: string }>,
  relay: {
    status: vi.fn(),
    onChanged: vi.fn(() => () => {}),
    renewJoinWindow: vi.fn()
  },
  ssh: { syncHosts: vi.fn(), listHosts: vi.fn() },
  hosts: {
    createJoinCode: vi.fn(),
    list: vi.fn(),
    onChanged: vi.fn(() => () => {}),
    bootstrapBySsh: vi.fn(),
    updateSshIdentity: vi.fn(),
    pairing: {
      start: vi.fn(),
      stop: vi.fn(),
      status: vi.fn(),
      onExit: vi.fn(() => () => {}),
      onData: vi.fn(() => () => {})
    }
  }
}));
vi.mock('../../lib/product-client.js', () => ({
  product: { relay: api.relay, ssh: api.ssh, hosts: api.hosts },
  requestPreferredJoinCode: async () => {
    const issued = await api.hosts.createJoinCode();
    return issued && issued.ok === false ? issued : { ok: true, join: issued };
  }
}));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => api.bridge }));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => api.liveHosts }));
vi.mock('../../components/Modal.js', () => ({
  Modal: ({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) => (
    <div role="dialog" aria-label={title}><h2>{title}</h2>{children}{footer}</div>
  )
}));
vi.mock('./PairingTerminal.js', () => ({ PairingTerminal: () => <div data-testid="add-machine-pairing-terminal" /> }));

const command = 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 https://machine.example.com/install.sh | sh -s -- --join-code zcde_abc --host-id host-1 --server https://machine.example.com';
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
      loopbackWarning: true,
      pairingMethod: 'ssh'
    }));
    expect(html).toContain('data-testid="machines-join-command"');
    expect(html).toContain('http://127.0.0.1:8780/install.sh');
    expect(html).toContain('Waiting for the machine to connect…');
    expect(html).toContain('only reachable on this computer');
    expect(html).toContain('data-testid="add-machine-ssh-host"');
    expect(html).toContain('No remote projects or SSH hosts found.');
    expect(html).not.toContain('Configure the machine-pairing relay before pairing');
  });

  it('copies an SSH reverse-tunnel command for a workspace host', () => {
    const html = renderToStaticMarkup(view({
      command: sshCommand,
      remainingMs: 60_000,
      loopbackWarning: true,
      viaSsh: true,
      pairingMethod: 'ssh',
      sshHost: 'limited-pony',
      sshHosts: [
        { host: 'educational-roadrunner', label: 'Roadrunner', detail: 'educational-roadrunner', group: 'project' },
        { host: 'kit-kat', label: 'kit-kat', group: 'project' },
        { host: 'limited-pony', label: 'Pony', detail: 'limited-pony', group: 'project' },
        { host: 'github-work', label: 'github-work', group: 'ssh-config', detail: 'github.com @grebmann' }
      ]
    }));
    expect(html).toContain('ssh -o ExitOnForwardFailure=yes -R 18782:127.0.0.1:8780 limited-pony');
    expect(html).toContain('Run this on this computer');
    expect(html).toContain('copy and paste it locally');
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
      pairingMethod: 'ssh',
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

  it('offers renew when the relay join window has closed', () => {
    const html = renderToStaticMarkup(view({
      remainingMs: 0,
      expired: true,
      joinWindowClosed: true
    }));
    expect(html).toContain('Join window closed');
    expect(html).toContain('Renew join window');
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

  it('does not offer Run for the remote curl installer', () => {
    const html = renderToStaticMarkup(view());
    expect(html).toContain('Copy');
    expect(html).not.toContain('data-testid="add-machine-run"');
    expect(html).not.toContain('Stop tunnel');
  });

  it('offers Run and a mini terminal for SSH pairing on this computer', () => {
    const html = renderToStaticMarkup(view({
      command: sshCommand,
      remainingMs: 60_000,
      loopbackWarning: true,
      viaSsh: true,
      pairingMethod: 'ssh',
      canRun: true,
      pairingRunning: true,
      pairingVisible: true,
      pairingSlot: <div data-testid="add-machine-pairing-terminal" />,
      sshHost: 'limited-pony',
      sshHosts: [{ host: 'limited-pony', label: 'limited-pony', group: 'project' }]
    }));
    expect(html).toContain('Copy');
    expect(html).toContain('data-testid="add-machine-run"');
    expect(html).toContain('Stop tunnel');
    expect(html).toContain('data-testid="add-machine-pairing-terminal"');
    expect(html).toContain('Run it here');
  });

  it('shows an alert for a nonzero pairing exit and none otherwise', () => {
    const html = renderToStaticMarkup(view({ pairingMethod: 'ssh', pairingExitCode: 255 }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Pairing exited with code 255 — see output above.');
    expect(renderToStaticMarkup(view({ pairingMethod: 'ssh', pairingExitCode: null }))).not.toContain('Pairing exited');
  });

  it('lets the user choose SSH or the installer command', () => {
    const html = renderToStaticMarkup(view({
      showMethodToggle: true,
      pairingMethod: 'command'
    }));
    expect(html).toContain('data-testid="add-machine-method-ssh"');
    expect(html).toContain('data-testid="add-machine-method-command"');
    expect(html).toContain('Installer command');
    expect(html).not.toContain('data-testid="add-machine-ssh-host"');
    expect(html).not.toContain('data-testid="add-machine-run"');

    const ssh = renderToStaticMarkup(view({
      showMethodToggle: true,
      pairingMethod: 'ssh',
      canRun: true,
      sshHost: 'limited-pony',
      sshHosts: [{ host: 'limited-pony', label: 'limited-pony', group: 'project' }]
    }));
    expect(ssh).toContain('data-testid="add-machine-ssh-host"');
    expect(ssh).toContain('data-testid="add-machine-run"');
  });

  it('copies through the desktop clipboard bridge', () => {
    const source = readFileSync(join(import.meta.dirname, 'AddMachineDialog.tsx'), 'utf8');
    expect(source).toContain('await copyText(command)');
    expect(source).not.toContain('navigator.clipboard');
  });
});

describe('AddMachineDialog Connect', () => {
  const join = { joinCode: 'zcde_abc', hostId: 'host-1', expiresAt: Date.now() + 10 * 60_000, pairingServerUrl: 'https://relay.example.com/t/zcrs_abcdefghijklmnopqr1234' };

  beforeEach(() => {
    api.bridge = true;
    api.liveHosts = [];
    api.relay.status.mockResolvedValue({ state: 'unconfigured' });
    api.relay.renewJoinWindow.mockResolvedValue({ state: 'unconfigured' });
    api.hosts.createJoinCode.mockResolvedValue(join);
    api.hosts.updateSshIdentity.mockResolvedValue({});
    api.hosts.list.mockResolvedValue([{ id: 'host-9', name: 'Pony box', status: 'connected' }]);
    api.hosts.pairing.status.mockResolvedValue({ running: false, sshHost: null, backlog: '', exitCode: null });
    api.hosts.pairing.start.mockResolvedValue({ ok: true, handoff: 'tunnel', reason: 'relay_offline' });
    api.ssh.syncHosts.mockResolvedValue({ hosts: [{ alias: 'limited-pony', hostname: 'pony.example', user: 'geoff' }] });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  function open() {
    return render(
      <AddMachineDialog
        open
        onClose={vi.fn()}
        publicAppUrl={null}
        sshHosts={[{ host: 'kit-kat', label: 'Kit', group: 'project' }]}
        defaultSshHost="limited-pony"
      />
    );
  }

  async function chooseSsh() {
    fireEvent.click(await screen.findByTestId('add-machine-method-ssh'));
    await waitFor(() => expect((screen.getByTestId('add-machine-connect') as HTMLButtonElement).disabled).toBe(false));
  }

  it('lists hosts from syncHosts merged with remote projects and re-queries on refresh', async () => {
    api.ssh.syncHosts
      .mockResolvedValueOnce({ hosts: [{ alias: 'limited-pony' }] })
      .mockResolvedValueOnce({ hosts: [{ alias: 'limited-pony' }, { alias: 'new-box' }], warning: 'Provider slow' });
    open();
    await chooseSsh();
    expect(api.ssh.listHosts).not.toHaveBeenCalled();
    expect(screen.getByText('Kit')).toBeTruthy();
    expect(screen.getByText('limited-pony')).toBeTruthy();
    expect(screen.queryByText('new-box')).toBeNull();
    fireEvent.click(screen.getByTestId('add-machine-refresh-hosts'));
    expect(await screen.findByText('new-box')).toBeTruthy();
    expect(screen.getByText('Provider slow')).toBeTruthy();
    expect(api.ssh.syncHosts).toHaveBeenCalledTimes(2);
  });

  it('shows a read warning when syncHosts fails', async () => {
    api.ssh.syncHosts.mockRejectedValue(new Error('nope'));
    open();
    fireEvent.click(await screen.findByTestId('add-machine-method-ssh'));
    expect(await screen.findByText('Could not read SSH hosts.')).toBeTruthy();
  });

  it('hands off to the host-scoped bootstrap stream and renders stages through Connected', async () => {
    api.hosts.bootstrapBySsh.mockImplementation(async (_ssh: unknown, onEvent: (event: HostBootstrapEvent) => void) => {
      const events: HostBootstrapEvent[] = [
        { type: 'stage', stage: 'ssh', status: 'running' },
        { type: 'log', text: 'hello from remote\n' },
        { type: 'stage', stage: 'ssh', status: 'passed' },
        { type: 'stage', stage: 'tunnel', status: 'passed' },
        { type: 'stage', stage: 'connected', status: 'passed' },
        { type: 'done', hostId: 'host-9' }
      ];
      for (const event of events) onEvent(event);
      return events;
    });
    open();
    await chooseSsh();
    expect(screen.getByTestId('add-machine-other-ways').tagName).toBe('DETAILS');
    fireEvent.click(screen.getByTestId('add-machine-connect'));
    expect(await screen.findByText('Pony box connected')).toBeTruthy();
    expect(api.hosts.pairing.start).toHaveBeenCalledWith(expect.objectContaining({ sshHost: 'limited-pony', joinCode: 'zcde_abc' }));
    expect(api.hosts.bootstrapBySsh).toHaveBeenCalledWith({ host: 'limited-pony', user: 'geoff' }, expect.any(Function));
    expect(screen.getByTestId('host-install-stage-ssh').getAttribute('data-status')).toBe('passed');
    expect(screen.getByTestId('host-install-stage-connected').getAttribute('data-status')).toBe('passed');
    expect(screen.getByTestId('add-machine-connect-log').textContent).toContain('hello from remote');
    expect(api.hosts.list).toHaveBeenCalled();
  });

  it('shows the failed stage, its reason, and Retry re-runs without reopening', async () => {
    api.hosts.bootstrapBySsh
      .mockImplementationOnce(async (_ssh: unknown, onEvent: (event: HostBootstrapEvent) => void) => {
        const events: HostBootstrapEvent[] = [
          { type: 'stage', stage: 'ssh', status: 'passed' },
          { type: 'stage', stage: 'install', status: 'failed', reason: 'curl: (7) refused' },
          { type: 'error', code: 'install_failed', message: 'Install failed' }
        ];
        for (const event of events) onEvent(event);
        return events;
      })
      .mockResolvedValueOnce([{ type: 'done', hostId: 'unknown-id' }]);
    open();
    await chooseSsh();
    fireEvent.click(screen.getByTestId('add-machine-connect'));
    expect((await screen.findByTestId('host-install-stage-reason-install')).textContent).toBe('curl: (7) refused');
    expect(screen.getByTestId('add-machine-connect-error').textContent).toBe('Install failed');
    expect(screen.queryByTestId('add-machine-connect-retry')).toBeNull();
    fireEvent.click(screen.getByTestId('host-install-retry'));
    expect(await screen.findByText('limited-pony connected')).toBeTruthy();
    expect(api.hosts.bootstrapBySsh).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('host-install-stages')).toBeNull();
  });

  it('offers Retry for a stream that ends or throws without a failed stage', async () => {
    api.hosts.bootstrapBySsh
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('503'))
      .mockRejectedValueOnce('weird');
    open();
    await chooseSsh();
    fireEvent.click(screen.getByTestId('add-machine-connect'));
    expect((await screen.findByTestId('add-machine-connect-error')).textContent).toBe('The machine did not finish connecting.');
    fireEvent.click(screen.getByTestId('add-machine-connect-retry'));
    await waitFor(() => expect(screen.getByTestId('add-machine-connect-error').textContent).toBe('503'));
    fireEvent.click(screen.getByTestId('add-machine-connect-retry'));
    await waitFor(() => expect(screen.getByTestId('add-machine-connect-error').textContent).toBe('Could not connect the machine'));
    expect(api.hosts.bootstrapBySsh).toHaveBeenCalledTimes(3);
  });

  it('keeps the relay/direct PTY path: no bootstrap, terminal shown, Stop ends it', async () => {
    api.hosts.pairing.start.mockResolvedValue({ ok: true, handoff: 'pty' });
    open();
    await chooseSsh();
    fireEvent.click(screen.getByTestId('add-machine-connect'));
    expect(await screen.findByTestId('add-machine-pairing-terminal')).toBeTruthy();
    expect(api.hosts.bootstrapBySsh).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('add-machine-stop-tunnel')).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByTestId('add-machine-stop-tunnel')); });
    expect(api.hosts.pairing.stop).toHaveBeenCalled();
  });

  it('surfaces a pairing-start refusal', async () => {
    api.hosts.pairing.start.mockResolvedValue({ ok: false, message: 'Choose a valid SSH host' });
    open();
    await chooseSsh();
    fireEvent.click(screen.getByTestId('add-machine-connect'));
    expect(await screen.findByText('Choose a valid SSH host')).toBeTruthy();
    expect(api.hosts.bootstrapBySsh).not.toHaveBeenCalled();
  });

  it('goes straight to bootstrap when no join code could be minted', async () => {
    api.hosts.createJoinCode.mockRejectedValue(new Error('offline'));
    api.hosts.bootstrapBySsh.mockResolvedValue([{ type: 'done', hostId: 'host-9' }]);
    api.ssh.syncHosts.mockResolvedValue({ hosts: [{ alias: 'limited-pony' }] });
    open();
    await chooseSsh();
    fireEvent.click(screen.getByTestId('add-machine-connect'));
    expect(await screen.findByText('Pony box connected')).toBeTruthy();
    expect(api.hosts.pairing.start).not.toHaveBeenCalled();
    expect(api.hosts.bootstrapBySsh).toHaveBeenCalledWith({ host: 'limited-pony' }, expect.any(Function));
  });

  it('shows no Connect or refresh without the desktop bridge', async () => {
    api.bridge = false;
    open();
    expect(await screen.findByTestId('machines-join-command')).toBeTruthy();
    expect(screen.queryByTestId('add-machine-connect')).toBeNull();
    expect(screen.queryByTestId('add-machine-refresh-hosts')).toBeNull();
    expect(api.ssh.syncHosts).not.toHaveBeenCalled();
  });

  it('uses the issued pairing URL for the copy command, never the bare relay origin', async () => {
    api.bridge = false;
    open();
    const text = (await screen.findByTestId('machines-join-command')).textContent ?? '';
    expect(text).toContain('--server https://relay.example.com/t/zcrs_abcdefghijklmnopqr1234');
    expect(text).toContain('https://relay.example.com/t/zcrs_abcdefghijklmnopqr1234/install.sh');
    expect(text).not.toMatch(/https:\/\/relay\.example\.com(?!\/t\/)/);
  });

  it('on relay_unavailable disables Copy with the message while Connect stays enabled', async () => {
    api.hosts.createJoinCode.mockResolvedValue({ ok: false, error: 'relay_unavailable', reason: 'offline' });
    open();
    await chooseSsh();
    const box = await screen.findByTestId('add-machine-relay-unavailable');
    expect(box.textContent).toContain('Relay unavailable — use Connect via SSH');
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('machines-join-command')).toBeNull();
    expect((screen.getByTestId('add-machine-connect') as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers a copyable ssh -R command on the Installer tab when the relay is offline', async () => {
    api.hosts.createJoinCode.mockResolvedValue({ ...join, pairingServerUrl: 'http://127.0.0.1:8780', pairingMode: 'tunnel' });
    open();
    fireEvent.click(await screen.findByTestId('add-machine-method-command'));
    const text = (await screen.findByTestId('machines-join-command')).textContent ?? '';
    expect(text).toContain('ssh -o ExitOnForwardFailure=yes -R');
    expect(text).toContain('limited-pony');
    expect(text).toContain('--join-code zcde_abc');
    expect(screen.queryByTestId('add-machine-relay-unavailable')).toBeNull();
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('records the SSH identity once a machine paired by the ssh -R command connects', async () => {
    api.hosts.createJoinCode.mockResolvedValue({ ...join, pairingServerUrl: 'http://127.0.0.1:8780', pairingMode: 'tunnel' });
    api.liveHosts = [{ id: 'host-1', name: 'Pony box', status: 'connected' }];
    open();
    fireEvent.click(await screen.findByTestId('add-machine-method-command'));
    await screen.findByText('Pony box connected');
    expect(api.hosts.updateSshIdentity).toHaveBeenCalledWith('host-1', { host: 'limited-pony' });
    expect(api.hosts.updateSshIdentity).toHaveBeenCalledTimes(1);
  });

  it('keeps Connect available on the SSH tab with a tunnel-issued code', async () => {
    api.hosts.createJoinCode.mockResolvedValue({ ...join, pairingServerUrl: 'http://127.0.0.1:8780', pairingMode: 'tunnel' });
    open();
    await chooseSsh();
    expect((screen.getByTestId('add-machine-connect') as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks for an SSH host instead of a command when a tunnel code has no host', () => {
    const html = renderToStaticMarkup(view({ command: null, tunnelIssued: true, pairingMethod: 'command', showMethodToggle: true }));
    expect(html).toContain('add-machine-tunnel-pick-host');
    expect(html).toContain('data-testid="add-machine-ssh-host"');
    expect(html).toContain('relay is offline');
  });

  it('hides the waiting spinner when relay is unavailable and nothing was issued', async () => {
    api.bridge = false;
    api.hosts.createJoinCode.mockResolvedValue({ ok: false, error: 'relay_unavailable', reason: 'offline' });
    open();
    const box = await screen.findByTestId('add-machine-relay-unavailable');
    expect(box.textContent).not.toContain('Connect via SSH');
    expect(box.textContent).toContain('public URL');
    expect(box.textContent).toContain('relay');
    expect(screen.queryByText('Waiting for the machine to connect…')).toBeNull();
  });

  it('hides the waiting spinner on the idle SSH tab until Connect is running', async () => {
    open();
    await chooseSsh();
    await screen.findByTestId('add-machine-connect');
    expect(screen.queryByText('Waiting for the machine to connect…')).toBeNull();
  });

  it('shows a retryable error on relay_changed and rejects an issuance with no pairing URL', async () => {
    api.bridge = false;
    api.hosts.createJoinCode.mockResolvedValueOnce({ ok: false, error: 'relay_changed' });
    open();
    expect(await screen.findByText('The relay changed while creating the code.')).toBeTruthy();
    api.hosts.createJoinCode.mockResolvedValueOnce({ joinCode: 'zcde_x', hostId: 'host-1', expiresAt: Date.now() + 60_000 });
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByText('The server did not return a pairing address.')).toBeTruthy();
  });

  it('ignores a stale issuance reply after close/reopen and keeps code and URL from one issuance', async () => {
    api.bridge = false;
    let resolveOld: (value: unknown) => void = () => {};
    api.hosts.createJoinCode
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ...join, joinCode: 'zcde_new', pairingServerUrl: 'https://relay.example.com/t/zcrs_newnewnewnewnewnew1234' });
    const props = { onClose: vi.fn(), publicAppUrl: null, defaultSshHost: 'limited-pony' };
    const view = render(<AddMachineDialog open {...props} />);
    view.rerender(<AddMachineDialog open={false} {...props} />);
    view.rerender(<AddMachineDialog open {...props} />);
    const fresh = (await screen.findByTestId('machines-join-command')).textContent ?? '';
    expect(fresh).toContain('zcde_new');
    await act(async () => { resolveOld(join); });
    const after = screen.getByTestId('machines-join-command').textContent ?? '';
    expect(after).toContain('--join-code zcde_new');
    expect(after).toContain('zcrs_newnewnewnewnewnew1234');
    expect(after).not.toContain('zcde_abc');
  });

  it('remint replaces the command with the new issuance', async () => {
    api.bridge = false;
    api.hosts.createJoinCode
      .mockResolvedValueOnce({ ...join, expiresAt: Date.now() - 1000 })
      .mockResolvedValueOnce({ ...join, joinCode: 'zcde_two', pairingServerUrl: 'https://relay.example.com/t/zcrs_twotwotwotwotwotwo1234' });
    open();
    expect((await screen.findByTestId('machines-join-command')).textContent).toContain('zcde_abc');
    fireEvent.click(screen.getByText('Generate a new code'));
    await waitFor(() => expect(screen.getByTestId('machines-join-command').textContent).toContain('zcde_two'));
    expect(screen.getByTestId('machines-join-command').textContent).toContain('zcrs_twotwotwotwotwotwo1234');
  });
});

describe('AddMachineDialogView connect mode', () => {
  it('makes Connect primary and collapses the command panel under Other ways to connect', () => {
    const html = renderToStaticMarkup(view({
      command: sshCommand,
      pairingMethod: 'ssh',
      connectMode: true,
      canConnect: true,
      canRun: true,
      sshHost: 'limited-pony',
      sshHosts: [{ host: 'limited-pony', label: 'limited-pony', group: 'project' }],
      onConnect: vi.fn(),
      onRefreshHosts: vi.fn()
    }));
    expect(html).toContain('data-testid="add-machine-connect"');
    expect(html).toContain('settings-btn--primary');
    expect(html).toContain('<details class="add-machine-other-ways"');
    expect(html).toContain('Other ways to connect');
    expect(html).toContain('data-testid="machines-join-command"');
    expect(html).toContain('data-testid="add-machine-refresh-hosts"');
    expect(html).toContain('Pick an SSH host and Connect');
  });

  it('disables Connect while busy and without a host', () => {
    const busy = renderToStaticMarkup(view({ pairingMethod: 'ssh', connectMode: true, canConnect: true, connectBusy: true, hostsRefreshing: true, onRefreshHosts: vi.fn() }));
    expect(busy).toContain('Connecting…');
    expect(busy).toContain('Refreshing…');
    const none = renderToStaticMarkup(view({ pairingMethod: 'ssh', connectMode: true, canConnect: false }));
    expect(none).toMatch(/disabled=""[^>]*data-testid="add-machine-connect"|data-testid="add-machine-connect"[^>]*disabled=""/);
  });
});
