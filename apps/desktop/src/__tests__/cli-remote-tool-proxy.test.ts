import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { launchExecutionScope, usesCliRemoteToolProxy } from '../cli-remote-tool-proxy.js';

const ssh = { remote: { host: 'devbox' } };
const local = {};
const flagOn = { cliRemoteToolProxyEnabled: true };
const flagOff = { cliRemoteToolProxyEnabled: false };

describe('usesCliRemoteToolProxy', () => {
  it('requires the advisory pick, Experimental flag, and an SSH project', () => {
    expect(usesCliRemoteToolProxy(ssh, { remoteToolProxy: true }, flagOn)).toBe(true);
    expect(usesCliRemoteToolProxy(ssh, { remoteToolProxy: true }, flagOff)).toBe(false);
    expect(usesCliRemoteToolProxy(ssh, {}, flagOn)).toBe(false);
    expect(usesCliRemoteToolProxy(local, { remoteToolProxy: true }, flagOn)).toBe(false);
  });
});

describe('launchExecutionScope', () => {
  it('is local for CLI remote tools so Cursor models are in scope', () => {
    expect(launchExecutionScope(ssh, { remoteToolProxy: true }, flagOn)).toBe('local');
  });

  it('stays remote for ssh -t (Remote host) or when Experimental is off', () => {
    expect(launchExecutionScope(ssh, {}, flagOn)).toBe('remote');
    expect(launchExecutionScope(ssh, { remoteToolProxy: true }, flagOff)).toBe('remote');
  });

  it('is local for a project without SSH', () => {
    expect(launchExecutionScope(local, { remoteToolProxy: true }, flagOn)).toBe('local');
  });
});

describe('host launch wiring', () => {
  it('preflights and spawns through the helper so Cursor remote-tools is local scope', () => {
    const host = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
    expect(host).toContain('launchExecutionScope(project, req, config)');
    expect(host).toContain('usesCliRemoteToolProxy(project, req, launchConfig)');
    expect(host).not.toContain("scope: project.remote ? 'remote' : 'local'");
  });
});
