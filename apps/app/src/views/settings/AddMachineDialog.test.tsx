import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AddMachineDialogView } from './AddMachineDialog.js';

const command = 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 https://box.tailnet.ts.net/install.sh | sh -s -- --join-code zcde_abc --host-id host-1 --server https://box.tailnet.ts.net';
const loopbackCommand = 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:8780/install.sh | sh -s -- --join-code zcde_abc --host-id host-1 --server http://127.0.0.1:8780';

describe('AddMachineDialogView', () => {
  it('shows the pairing command, copy, expiry, and waiting status', () => {
    const html = renderToStaticMarkup(
      <AddMachineDialogView
        command={command}
        copied={false}
        remainingMs={14 * 60_000 + 58_000}
        expired={false}
        mintError={null}
        loopbackWarning={false}
        pairedName={null}
        onCopy={vi.fn()}
        onRetryMint={vi.fn()}
        onClose={vi.fn()}
      />
    );
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
    const html = renderToStaticMarkup(
      <AddMachineDialogView
        command={loopbackCommand}
        copied={false}
        remainingMs={60_000}
        expired={false}
        mintError={null}
        loopbackWarning
        pairedName={null}
        onCopy={vi.fn()}
        onRetryMint={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="machines-join-command"');
    expect(html).toContain('http://127.0.0.1:8780/install.sh');
    expect(html).toContain('Waiting for the machine to connect…');
    expect(html).toContain('only reachable on this computer');
    expect(html).not.toContain('Set a public app URL (Tailscale Serve) before pairing');
  });

  it('offers a new code after expiry', () => {
    const html = renderToStaticMarkup(
      <AddMachineDialogView
        command={command}
        copied={false}
        remainingMs={0}
        expired
        mintError={null}
        loopbackWarning={false}
        pairedName={null}
        onCopy={vi.fn()}
        onRetryMint={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('Code expired');
    expect(html).toContain('Generate a new code');
    expect(html).toContain('disabled=""');
  });

  it('flips to connected when the new machine appears', () => {
    const html = renderToStaticMarkup(
      <AddMachineDialogView
        command={command}
        copied
        remainingMs={60_000}
        expired={false}
        mintError={null}
        loopbackWarning={false}
        pairedName="studio.local"
        onCopy={vi.fn()}
        onRetryMint={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('studio.local connected');
    expect(html).toContain('Copied');
    expect(html).not.toContain('Waiting for the machine to connect…');
  });

  it('surfaces a mint failure with retry', () => {
    const html = renderToStaticMarkup(
      <AddMachineDialogView
        command={null}
        copied={false}
        remainingMs={null}
        expired={false}
        mintError="offline"
        loopbackWarning={false}
        pairedName={null}
        onCopy={vi.fn()}
        onRetryMint={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('offline');
    expect(html).toContain('Try again');
    expect(html).toContain('Waiting for the machine to connect…');
  });

  it('shows a creating-code placeholder before the command lands', () => {
    const html = renderToStaticMarkup(
      <AddMachineDialogView
        command={null}
        copied={false}
        remainingMs={null}
        expired={false}
        mintError={null}
        loopbackWarning={false}
        pairedName={null}
        onCopy={vi.fn()}
        onRetryMint={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('Creating a join code…');
    expect(html).toContain('Waiting for the machine to connect…');
  });
});
