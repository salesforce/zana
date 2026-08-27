import { describe, expect, it } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  bootstrapOutcome,
  composerHostActionChipLabel,
  composerRemoteToolsMark,
  hostPickerDescription,
  hostPickerLabel,
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
  it('asks to install a daemon on an SSH project that is not bound to a host', () => {
    const action = resolveComposerHostAction({
      hosts: [primary],
      project: sshProject,
      publicAppUrl: 'https://box.tailnet.ts.net'
    });
    expect(action).toMatchObject({ kind: 'install', label: 'Install' });
    expect(shouldBlockComposerSend(action, sshProject)).toBe(false);
    expect(shouldShowHostPicker([primary], sshProject)).toBe(true);
  });

  it('marks local-agent remote-tools mode without blocking send or hiding Install', () => {
    expect(composerRemoteToolsMark(sshProject, true)).toBe('Local agent · remote tools');
    expect(composerRemoteToolsMark(sshProject, false)).toBeNull();
    expect(composerRemoteToolsMark({ ...sshProject, hostId: 'h-remote' }, true)).toBeNull();
    const action = resolveComposerHostAction({
      hosts: [primary],
      project: sshProject,
      publicAppUrl: 'https://box.tailnet.ts.net'
    });
    expect(action.kind).toBe('install');
    expect(shouldBlockComposerSend(action, sshProject)).toBe(false);
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

  it('blocks install when the public URL is loopback', () => {
    const action = resolveComposerHostAction({
      hosts: [primary],
      project: sshProject,
      publicAppUrl: 'http://127.0.0.1:8780'
    });
    expect(action).toMatchObject({ kind: 'blocked', needsPublicUrl: true });
    expect(shouldBlockComposerSend(action, sshProject)).toBe(false);
    expect(composerHostActionChipLabel(action)).toBeNull();
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
