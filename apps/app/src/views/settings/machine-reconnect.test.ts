import { describe, expect, it, vi } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import {
  machineCanReconnect,
  reconnectMachine
} from './machine-reconnect.js';

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h1',
    name: 'limited-pony',
    type: 'persistent',
    status: 'disconnected',
    maxPermissionMode: 'full',
    lastSeenAt: 1,
    lastRejectedProtocolVersion: null,
    isPrimary: false,
    canRepairViaSsh: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

describe('machineCanReconnect', () => {
  it('offers reconnect on offline remotes only', () => {
    expect(machineCanReconnect(host())).toBe(true);
    expect(machineCanReconnect(host({ status: 'connected' }))).toBe(false);
    expect(machineCanReconnect(host({ isPrimary: true }))).toBe(false);
  });
});

describe('reconnectMachine', () => {
  it('asks for an SSH host when the machine has no stored identity', async () => {
    const repair = vi.fn();
    const result = await reconnectMachine({
      hostId: 'h1',
      canRepairViaSsh: false,
      repair
    });
    expect(result).toEqual({
      ok: false,
      message: 'Pick an SSH host so Zana can reconnect this machine.',
      needsSshPick: true
    });
    expect(repair).not.toHaveBeenCalled();
  });

  it('repairs without a Settings public app URL', async () => {
    const repair = vi.fn().mockResolvedValue([{ type: 'done', hostId: 'h1' }]);
    await expect(reconnectMachine({
      hostId: 'h1',
      canRepairViaSsh: true,
      repair
    })).resolves.toEqual({ ok: true, hostId: 'h1' });
    expect(repair).toHaveBeenCalledWith('h1');
  });

  it('repairs after the user binds an SSH host', async () => {
    const repair = vi.fn().mockResolvedValue([{ type: 'done', hostId: 'h1' }]);
    const result = await reconnectMachine({
      hostId: 'h1',
      canRepairViaSsh: false,
      afterSshPick: true,
      repair
    });
    expect(result).toEqual({ ok: true, hostId: 'h1' });
    expect(repair).toHaveBeenCalledWith('h1');
  });

  it('returns repair errors and surfaces a missing SSH identity', async () => {
    await expect(reconnectMachine({
      hostId: 'h1',
      canRepairViaSsh: true,
      repair: async () => [{ type: 'error', code: 'install_failed', message: 'ssh timed out' }]
    })).resolves.toEqual({ ok: false, message: 'ssh timed out' });

    await expect(reconnectMachine({
      hostId: 'h1',
      canRepairViaSsh: true,
      repair: async () => [{
        type: 'error',
        code: 'ssh_identity_required',
        message: 'Pick an SSH host so Zana can reconnect this machine.'
      }]
    })).resolves.toMatchObject({ ok: false, needsSshPick: true });
  });

  it('surfaces a backend public-url error instead of blocking before repair', async () => {
    await expect(reconnectMachine({
      hostId: 'h1',
      canRepairViaSsh: true,
      repair: async () => [{
        type: 'error',
        code: 'public_url_required',
        message: 'Set a public app URL before installing a remote host daemon.'
      }]
    })).resolves.toEqual({
      ok: false,
      message: 'Set a public app URL before installing a remote host daemon.'
    });
  });

  it('catches thrown repair failures', async () => {
    await expect(reconnectMachine({
      hostId: 'h1',
      canRepairViaSsh: true,
      repair: async () => {
        throw new Error('network down');
      }
    })).resolves.toEqual({ ok: false, message: 'network down' });

    await expect(reconnectMachine({
      hostId: 'h1',
      canRepairViaSsh: true,
      repair: async () => {
        throw 'nope';
      }
    })).resolves.toEqual({ ok: false, message: 'Could not reconnect this machine' });
  });
});
