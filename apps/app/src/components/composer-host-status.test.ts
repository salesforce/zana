import { describe, expect, it } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  bootstrapOutcome,
  composerBootstrapErrorMessage,
  composerHostActionChipLabel,
  composerHostsForProject,
  composerRemoteHostBadge,
  hostPickerDescription,
  hostPickerLabel,
  isForeignExecutionHost,
  PAIRING_DOOR_ERROR,
  DAEMON_UNRESPONSIVE_ERROR,
  resolveComposerHostAction,
  shortHostName,
  shouldBlockComposerSend,
  shouldShowHostPicker
} from './composer-host-status.js';

function host(patch: Partial<Host> & Pick<Host, 'id' | 'name'>): Host {
  return {
    type: 'persistent',
    status: 'connected',
    maxPermissionMode: 'full',
    lastSeenAt: 1,
    lastRejectedProtocolVersion: null,
    isPrimary: false,
    canRepairViaSsh: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch
  };
}

const primary = host({ id: 'h-primary', name: 'Laptop', isPrimary: true });
const remoteHost = host({
  id: 'h-remote',
  name: 'Devbox',
  status: 'disconnected',
  canRepairViaSsh: true
});

const sshProject: Project = {
  id: 'p-ssh',
  name: 'Remote app',
  path: '/tmp/placeholder',
  createdAt: 1,
  lastActiveAt: 1,
  remote: { host: 'devbox', user: 'me' }
};

describe('composer host status', () => {
  it('offers Install on an unbound SSH project and blocks send', () => {
    const action = resolveComposerHostAction({
      hosts: [primary],
      project: sshProject,
      publicAppUrl: 'https://box.tailnet.ts.net'
    });
    expect(action).toMatchObject({ kind: 'install', label: 'Install' });
    expect(shouldBlockComposerSend(action, sshProject)).toBe(true);
    expect(shouldShowHostPicker([primary], sshProject)).toBe(false);
    expect(shouldShowHostPicker([primary, remoteHost], sshProject)).toBe(false);
    expect(composerRemoteHostBadge({ project: sshProject, host: primary })).toBeNull();
    expect(composerHostActionChipLabel(action)).toBe('Install host daemon');
  });

  it('blocks send when install needs a public URL', () => {
    const action = resolveComposerHostAction({
      hosts: [primary],
      project: sshProject,
      publicAppUrl: 'http://127.0.0.1:8780'
    });
    expect(action).toMatchObject({ kind: 'blocked', needsPublicUrl: true });
    expect(shouldBlockComposerSend(action, sshProject)).toBe(true);
    expect(composerHostActionChipLabel(action)).toBeNull();
  });

  it('blocks send when the bound remote host row is gone', () => {
    const project = { ...sshProject, hostId: 'h-missing' };
    const action = resolveComposerHostAction({
      hosts: [primary],
      project,
      selectedHostId: 'h-primary',
      publicAppUrl: 'http://127.0.0.1:8780'
    });
    expect(action).toMatchObject({ kind: 'blocked', needsPublicUrl: true });
    expect(shouldBlockComposerSend(action, project)).toBe(true);
    expect(composerHostActionChipLabel(action)).toBeNull();
    expect(composerRemoteHostBadge({ project, host: primary })).toBeNull();
    expect(composerRemoteHostBadge({ project })).toBeNull();
  });

  it('does not offer this machine for a bound SSH project', () => {
    const project = {
      ...sshProject,
      hostId: 'h-remote',
      remote: { host: 'devbox', user: 'me', remotePath: '/src' }
    };
    const action = resolveComposerHostAction({
      hosts: [primary, remoteHost],
      project,
      selectedHostId: 'h-primary',
      publicAppUrl: 'https://box.tailnet.ts.net'
    });
    expect(action).toMatchObject({ kind: 'fix', hostId: 'h-remote', label: 'Fix' });
    expect(shouldBlockComposerSend(action, project)).toBe(true);
    expect(shouldShowHostPicker([primary, remoteHost], project)).toBe(false);
    expect(composerHostsForProject([primary, remoteHost, host({ id: 'h-other', name: 'Other' })], project))
      .toEqual([remoteHost]);
    expect(composerRemoteHostBadge({ project, host: remoteHost })).toEqual({
      path: '/src',
      status: 'offline'
    });
    expect(hostPickerLabel(remoteHost, project)).toBe('Remote machine');
    expect(hostPickerDescription(remoteHost, project)).toBe('Devbox · Offline');
  });

  it('shows an online badge when the bound daemon is connected', () => {
    const online = host({ id: 'h-remote', name: 'Devbox', status: 'connected' });
    const project = {
      ...sshProject,
      hostId: 'h-remote',
      remote: { host: 'devbox', user: 'me', remotePath: '/src' }
    };
    const action = resolveComposerHostAction({
      hosts: [primary, online],
      project,
      publicAppUrl: 'https://box.tailnet.ts.net'
    });
    expect(action).toEqual({ kind: 'ready' });
    expect(shouldBlockComposerSend(action, project)).toBe(false);
    expect(composerRemoteHostBadge({ project, host: online })).toEqual({
      path: '/src',
      status: 'online'
    });
  });

  it('blocks send when the remote machine is selected and offline', () => {
    const project = { ...sshProject, hostId: 'h-remote' };
    const action = resolveComposerHostAction({
      hosts: [primary, remoteHost],
      project,
      selectedHostId: 'h-remote',
      publicAppUrl: 'https://box.tailnet.ts.net'
    });
    expect(action).toMatchObject({ kind: 'fix', hostId: 'h-remote', label: 'Fix' });
    expect(shouldBlockComposerSend(action, project)).toBe(true);
  });

  it('asks to pick SSH when an enrolled host cannot be repaired yet', () => {
    const offline = host({ id: 'h-remote', name: 'Devbox', status: 'disconnected' });
    const project: Project = {
      id: 'p-enrolled',
      name: 'On box',
      path: '/home/me/app',
      createdAt: 1,
      lastActiveAt: 1,
      hostId: 'h-remote'
    };
    const action = resolveComposerHostAction({
      hosts: [primary, offline],
      project,
      selectedHostId: 'h-remote',
      publicAppUrl: 'https://box.tailnet.ts.net'
    });
    expect(action).toMatchObject({ kind: 'fix', needsSshPick: true });
    expect(shouldBlockComposerSend(action, project)).toBe(true);
  });

  it('offers Fix on an enrolled offline host even without a public app URL', () => {
    const project: Project = {
      id: 'p-enrolled',
      name: 'On box',
      path: '/home/me/app',
      createdAt: 1,
      lastActiveAt: 1,
      hostId: 'h-remote'
    };
    const action = resolveComposerHostAction({
      hosts: [primary, remoteHost],
      project,
      selectedHostId: 'h-remote',
      publicAppUrl: 'http://127.0.0.1:8780'
    });
    expect(action).toMatchObject({ kind: 'fix', hostId: 'h-remote', label: 'Fix' });
    expect(shouldBlockComposerSend(action, project)).toBe(true);
    expect(composerHostActionChipLabel(action)).toBe('Fix connection');
  });

  it('offers Fix and blocks send when an enrolled host is offline', () => {
    const project: Project = {
      id: 'p-enrolled',
      name: 'On box',
      path: '/home/me/app',
      createdAt: 1,
      lastActiveAt: 1,
      hostId: 'h-remote'
    };
    const action = resolveComposerHostAction({
      hosts: [primary, remoteHost],
      project,
      selectedHostId: 'h-remote',
      publicAppUrl: 'https://box.tailnet.ts.net'
    });
    expect(action).toMatchObject({ kind: 'fix', hostId: 'h-remote', label: 'Fix' });
    expect(shouldBlockComposerSend(action, project)).toBe(true);
    expect(shouldShowHostPicker([primary, remoteHost], project)).toBe(true);
  });

  it('hides the picker for a single connected primary on a local project', () => {
    expect(shouldShowHostPicker([primary])).toBe(false);
    expect(resolveComposerHostAction({ hosts: [primary] }).kind).toBe('ready');
  });

  it('blocks when this machine’s daemon is offline', () => {
    const action = resolveComposerHostAction({
      hosts: [{ ...primary, status: 'disconnected' }]
    });
    expect(action.kind).toBe('blocked');
    expect(shouldBlockComposerSend(action)).toBe(true);
  });

  it('labels this machine and online/offline status', () => {
    expect(shortHostName('grebmann-ltmmfjc.internal.salesforce.com')).toBe('grebmann-ltmmfjc');
    expect(shortHostName('MacBook-Pro.local')).toBe('MacBook-Pro');
    expect(shortHostName('10.0.0.5')).toBe('10.0.0.5');
    expect(shortHostName('fe80::1')).toBe('fe80::1');
    expect(shortHostName('Laptop')).toBe('Laptop');
    expect(shortHostName('')).toBe('');
    expect(hostPickerLabel(primary)).toBe('This machine');
    expect(hostPickerDescription(primary)).toBe('Laptop · Online');
    expect(hostPickerLabel(host({
      id: 'h-fqdn',
      name: 'grebmann-ltmmfjc.internal.salesforce.com',
      isPrimary: true
    }))).toBe('This machine');
    expect(hostPickerDescription(host({
      id: 'h-fqdn',
      name: 'grebmann-ltmmfjc.internal.salesforce.com',
      isPrimary: true
    }))).toBe('grebmann-ltmmfjc · Online');
    expect(hostPickerLabel(remoteHost)).toBe('Devbox');
    expect(hostPickerDescription(remoteHost)).toBe('Offline');
    expect(composerHostActionChipLabel({ kind: 'ready' })).toBeNull();
    expect(composerHostActionChipLabel({ kind: 'blocked', reason: 'down' })).toBe('Unavailable');
    expect(composerHostActionChipLabel({
      kind: 'blocked',
      needsPublicUrl: true,
      hostId: 'h-remote',
      reason: 'Set a public app URL'
    })).toBe('Set URL');
  });

  it('lets Default Project run on another connected machine', () => {
    const scratch: Project = {
      id: 'p-scratch',
      name: 'Default Project',
      path: '/Users/me/zcc-workspace',
      createdAt: 1,
      lastActiveAt: 1,
      quickAgent: true
    };
    const online = host({ id: 'h-remote', name: 'limited-pony', status: 'connected' });
    const action = resolveComposerHostAction({
      hosts: [primary, online],
      project: scratch,
      selectedHostId: 'h-remote'
    });
    expect(action).toEqual({ kind: 'ready' });
    expect(shouldBlockComposerSend(action, scratch)).toBe(false);
    expect(isForeignExecutionHost(scratch, [primary, online], 'h-remote')).toBe(true);
    expect(isForeignExecutionHost(scratch, [primary, online], 'h-primary')).toBe(false);
  });

  it('blocks a local project aimed at another machine', () => {
    const project: Project = {
      id: 'p-local',
      name: 'App',
      path: '/Users/me/app',
      createdAt: 1,
      lastActiveAt: 1
    };
    const online = host({ id: 'h-remote', name: 'limited-pony', status: 'connected' });
    const action = resolveComposerHostAction({
      hosts: [primary, online],
      project,
      selectedHostId: 'h-remote'
    });
    expect(action).toMatchObject({
      kind: 'blocked',
      reason: 'This project lives on this machine. Add a folder on limited-pony first.'
    });
    expect(shouldBlockComposerSend(action, project)).toBe(true);
    expect(isForeignExecutionHost(project, [primary, online], 'h-remote')).toBe(true);
  });

  it('maps pairing-door failures to retry-in-place copy', () => {
    expect(composerBootstrapErrorMessage({
      code: 'join_expired',
      message: 'The pairing join window has closed. Reopen Add a machine so this laptop can renew the window, then try again.'
    })).toBe(PAIRING_DOOR_ERROR);
    expect(composerBootstrapErrorMessage({
      code: 'relay_offline',
      message: 'The pairing relay is offline.'
    })).toBe(PAIRING_DOOR_ERROR);
    expect(composerBootstrapErrorMessage({
      code: 'daemon_unresponsive',
      message: 'host abc did not connect'
    })).toBe(DAEMON_UNRESPONSIVE_ERROR);
    expect(composerBootstrapErrorMessage({
      code: 'ssh_identity_required',
      message: 'Pick SSH'
    })).toBe('Pick SSH');
    expect(PAIRING_DOOR_ERROR).toContain('Retry,');
    expect(PAIRING_DOOR_ERROR).not.toContain('Retry Install');
    expect(PAIRING_DOOR_ERROR).not.toContain('Add a machine');
  });

  it('reads done and error events from bootstrap NDJSON', () => {
    expect(bootstrapOutcome([
      { type: 'log', message: 'Installing…' },
      { type: 'done', hostId: 'h-1' }
    ])).toEqual({ ok: true, hostId: 'h-1' });
    expect(bootstrapOutcome([
      { type: 'error', code: 'ssh_identity_required', message: 'Pick SSH', pairingCommand: 'curl …' }
    ])).toEqual({
      ok: false,
      code: 'ssh_identity_required',
      message: 'Pick SSH',
      pairingCommand: 'curl …'
    });
  });
});
