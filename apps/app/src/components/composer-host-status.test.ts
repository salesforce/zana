import { describe, expect, it } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  bootstrapOutcome,
  hostPickerDescription,
  hostPickerLabel,
  resolveComposerHostAction,
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
    expect(hostPickerLabel(primary)).toBe('Laptop (this machine)');
    expect(hostPickerDescription(primary)).toBe('Online');
    expect(hostPickerLabel(remoteHost)).toBe('Devbox');
    expect(hostPickerDescription(remoteHost)).toBe('Offline');
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
