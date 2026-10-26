import type { Project } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { composerProjectLabel, isScratchWorkspaceProject } from '../components/composer-project-default.js';

export interface MachineProjectGroup {
  id: string;
  name: string;
  hostId?: string;
  host?: Host;
  remote?: Project['remote'];
  primary: boolean;
  projects: Project[];
}

export interface ComposerLocation {
  projectId: string;
  hostId?: string;
}

export function primaryMachineLabel(platform = typeof navigator === 'undefined' ? '' : navigator.platform): string {
  return /^mac/i.test(platform) ? 'This Mac' : /^win/i.test(platform) ? 'This PC' : 'This machine';
}

/** A project appears only on its registered target. Scratch work can use each daemon's personal environment. */
export function groupProjectsByMachine(projects: readonly Project[], hosts: readonly Host[]): MachineProjectGroup[] {
  const primary = hosts.find(host => host.isPrimary);
  const groups = new Map<string, MachineProjectGroup>();
  groups.set(primary?.id ?? 'local', {
    id: primary?.id ?? 'local', name: primaryMachineLabel(), hostId: primary?.id,
    host: primary, primary: true, projects: []
  });
  for (const host of hosts) {
    if (host.isPrimary) continue;
    groups.set(host.id, { id: host.id, name: host.name, hostId: host.id, host, primary: false, projects: [] });
  }
  for (const project of projects) {
    const sshHost = project.remote && hosts.find(host => !host.isPrimary && host.sshHost === project.remote!.host);
    const hostId = project.hostId ?? (sshHost ? sshHost.id : undefined);
    const key = hostId ?? (project.remote
      ? `ssh:${project.remote.user ?? ''}@${project.remote.host}:${project.remote.proxyJump ?? ''}`
      : primary?.id ?? 'local');
    let group = groups.get(key);
    if (!group) {
      const host = hosts.find(row => row.id === hostId);
      group = {
        id: key, name: host?.name ?? project.remote?.host ?? 'Unavailable machine', hostId,
        host, remote: project.remote, primary: false, projects: []
      };
      groups.set(key, group);
    }
    if (project.remote) group.remote ??= project.remote;
    group.projects.push(project);
  }
  const scratch = projects.find(project => isScratchWorkspaceProject(project) && !project.remote && (!project.hostId || project.hostId === primary?.id));
  for (const group of groups.values()) {
    // Keep one default visible per enrolled machine. It uses a host-owned personal
    // environment; never project a named checkout onto another machine.
    if (!group.primary && group.host && scratch && !group.projects.some(isScratchWorkspaceProject)) group.projects.unshift(scratch);
  }
  return [...groups.values()];
}

export function locationValue(location: ComposerLocation): string {
  return encodeURIComponent(JSON.stringify([location.projectId, location.hostId ?? null]));
}

export function machineProjectMatches(group: MachineProjectGroup, project: Project, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [group.name, composerProjectLabel(project), project.path, project.tag ?? ''].some(value => value.toLowerCase().includes(q));
}

export function newThreadLocationPath(location: ComposerLocation): string {
  const query = new URLSearchParams({ locationProject: location.projectId });
  if (location.hostId) query.set('host', location.hostId);
  return `/threads/new?${query}`;
}
