import { describe, expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { groupProjectsByMachine, locationValue, machineProjectMatches, newThreadLocationPath, primaryMachineLabel } from './machine-projects.js';
const host = (id: string, extra: Partial<Host> = {}) => ({ id, name: id, isPrimary: false, status: 'connected', ...extra } as Host);
const project = (id: string, extra: Partial<Project> = {}) => ({ id, name: id, path: `/repo/${id}`, ...extra } as Project);
const hosts = [host('local', { isPrimary: true }), host('dev', { sshHost: 'ssh-dev' }), host('empty')];

describe('machine project locations', () => {
  it('groups fixed local, bound, legacy SSH and disconnected targets without copying named projects', () => {
    const rows = groupProjectsByMachine([project('local'), project('remote', { hostId: 'dev' }), project('ssh', { remote: { host: 'ssh-dev' } }), project('old', { hostId: 'gone' }), project('legacy', { remote: { host: 'box', user: 'me' } })], hosts);
    expect(rows.map(row => [row.id, row.projects.map(p => p.id)])).toEqual([
      ['local', ['local']], ['dev', ['remote', 'ssh']], ['empty', []], ['gone', ['old']], ['ssh:me@box:', ['legacy']]
    ]);
    expect(rows[4].name).toBe('box');
    expect(rows[3].hostId).toBe('gone');
  });
  it('provides the default on every enrolled machine and retains each machine identity', () => {
    const scratch = project('scratch', { quickAgent: true });
    const rows = groupProjectsByMachine([scratch, project('app', { hostId: 'dev' })], hosts);
    expect(rows.map(row => row.projects.map(p => p.id))).toEqual([['scratch'], ['scratch', 'app'], ['scratch']]);
    expect(rows[2].hostId).toBe('empty');
    expect(rows[0].projects[0]).toBe(scratch);
  });
  it('keeps a host-owned default and does not invent one when the scratch project has not loaded', () => {
    expect(groupProjectsByMachine([project('d', { quickAgent: true, hostId: 'dev' })], hosts)[1].projects.map(p => p.id)).toEqual(['d']);
    expect(groupProjectsByMachine([], [])[0]).toMatchObject({ id: 'local', primary: true, projects: [] });
  });
  it('keeps distinct unbound SSH users separate and respects an explicit missing binding', () => {
    const rows = groupProjectsByMachine([project('a', { remote: { host: 'box', user: 'a' } }), project('b', { remote: { host: 'box', user: 'b' } }), project('bound', { hostId: 'missing', remote: { host: 'ssh-dev' } })], hosts);
    expect(rows.slice(3).map(row => row.id)).toEqual(['ssh:a@box:', 'ssh:b@box:', 'missing']);
  });
  it('matches machine, project, default label, path and tag case-insensitively', () => {
    const row = groupProjectsByMachine([project('one', { tag: 'api' }), project('scratch', { name: 'zcc-workspace', quickAgent: true })], hosts)[0];
    for (const q of ['', 'one', '/repo', 'API']) expect(machineProjectMatches(row, row.projects[0], q)).toBe(true);
    expect(machineProjectMatches(row, row.projects[0], 'absent')).toBe(false);
    expect(machineProjectMatches(row, row.projects[1], 'Default Project')).toBe(true);
    expect(machineProjectMatches(row, row.projects[0], row.name)).toBe(true);
  });
  it('encodes the complete location and optional host in new-thread navigation', () => {
    expect(locationValue({ projectId: 'p', hostId: 'h' })).not.toBe(locationValue({ projectId: 'p', hostId: 'other' }));
    expect(locationValue({ projectId: 'p' })).toBe(encodeURIComponent('["p",null]'));
    expect(newThreadLocationPath({ projectId: 'a/b', hostId: 'box@1' })).toBe('/threads/new?locationProject=a%2Fb&host=box%401');
    expect(newThreadLocationPath({ projectId: 'p' })).toBe('/threads/new?locationProject=p');
    expect(['MacIntel', 'Win32', 'Linux'].map(primaryMachineLabel)).toEqual(['This Mac', 'This PC', 'This machine']);
  });
});
