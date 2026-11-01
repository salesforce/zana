import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { basename } from 'node:path';

const execFileCalls = vi.hoisted(() => [] as Array<{ bin: string; options: Record<string, unknown> }>);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (bin: string, args: readonly string[], options: Record<string, unknown>, callback: never) => {
      execFileCalls.push({ bin, options });
      return actual.execFile(bin, args, options, callback);
    }
  };
});

const { createBrokerCapabilities } = await import('../broker-caps.js');
const { PermissionBroker, grantFromManifest } = await import('../permission-broker.js');

// Main is a GUI process: on Windows a brokered console bin without windowsHide
// opens its own visible console window.
describe('broker-caps — exec console window', () => {
  it('passes windowsHide to the brokered execFile', async () => {
    const bin = basename(process.execPath);
    const broker = new PermissionBroker({
      builtinIds: new Set(),
      grants: (id) => (id === 'alpha' ? grantFromManifest(['exec'], { execAllowlist: [bin] }, tmpdir()) : null)
    });
    const res = await createBrokerCapabilities(broker).exec('alpha', { bin, args: ['-e', "process.stdout.write('ok')"] });
    expect(res.stdout).toBe('ok');
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].options.windowsHide).toBe(true);
  });
});
