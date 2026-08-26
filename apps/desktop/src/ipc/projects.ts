// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { asSshHosts, asSshSyncResult, mergeSshHosts } from '../extensions/ssh-host-provider-registry.js';
import { ensureMcpConfigForProject } from '@zana-ai/zcc-host-daemon/mcp-config';
import { parseSshConfig } from '@zana-ai/zcc-server/services/projects/ssh-config';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import { dialog } from 'electron';
import { isAbsolute } from 'node:path';
import type { CloneProjectResult, Project, Result } from '@zana-ai/zcc-domain/product';

export function registerProjectsIpc(): void {
  
  ctx.safeHandle(IPC.projects.list, async () => {
    const projects = await ctx.runtimeSupervisor?.listProjects();
    return ctx.runtimeSupervisor ? projects as Project[] : store.listProjects();
  }, () => []);
  ipcMain.handle(IPC.projects.add, async (_e, path: string): Promise<Result<Project>> => {
    try {
      // Once the runtime is active, the server is the only local-project writer.
      // Do not fall back after a server error: an expired response may still have
      // committed, and a second legacy write could create a divergent record.
      const project = ctx.runtimeSupervisor
        ? await ctx.runtimeSupervisor.addProject(path) as Project
        : store.addProject(path);
      // Fire-and-forget the .mcp.json write; failure shouldn't block
      // adding a project (terminal still works without inbox push). Logged
      // for visibility.
      ensureMcpConfigForProject(project.id).catch((err) =>
        ctx.logMainError(`ensureMcpConfigForProject(${project.id})`, err)
      );
      ctx.stampFeedEvent(
        project.id,
        'project-created',
        `Project added: ${project.name}`,
        `project-created:${project.id}`
      );
      ctx.templates.rebindProjects();
      ctx.personas.rebindProjects();
      ctx.teams.rebindProjects();
      ctx.libraryStore.rebindProjects?.();
      ctx.scheduler.rebindWatchers();
      ctx.goals.rebindWatchers();
      ctx.followups.rebindWatchers();
      ctx.safeSend(
        IPC.projects.onChanged,
        ctx.runtimeSupervisor ? await ctx.runtimeSupervisor.listProjects() as Project[] : store.listProjects()
      );
      return { ok: true, value: project };
    } catch (err) {
      return { ok: false, code: 'ADD_FAILED', message: String(err) };
    }
  });
  ipcMain.handle(
    IPC.projects.addRemote,
    async (
      _e,
      input: { host: string; user?: string; remotePath?: string; proxyJump?: string; name?: string }
    ): Promise<Result<Project>> => {
      try {
        const project = store.addRemoteProject(input);
        return { ok: true, value: project };
      } catch (err) {
        return { ok: false, code: 'ADD_REMOTE_FAILED', message: String(err) };
      }
    }
  );
  // Clone-root: where `projects.clone` drops repos. Honors a persisted
  // `cloneRoot` when it's a valid absolute path; otherwise falls back to
  // `~/zcc-workspace` — the same scratch root the Quick Agent uses.
  // The fallback goes through ensureScratchRoot so a clone-first upgrade still
  // runs the legacy `~/cc-workspace` migration before materializing the dir.
  const cloneRoot = () => {
    const configured = store.getConfig().cloneRoot?.trim();
    if (configured && isAbsolute(configured)) return configured;
    return store.ensureScratchRoot();
  };
  ipcMain.handle(IPC.projects.cloneRoot, async (): Promise<string> => cloneRoot());
  ipcMain.handle(
    IPC.projects.clone,
    async (_e, input: { url: string; name?: string }): Promise<CloneProjectResult> => {
      try {
        return await ctx.cloneAndRegisterProject(input, (line) => ctx.safeSend(IPC.projects.cloneProgress, line));
      } catch (err) {
        return { ok: false, code: 'CLONE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.projects.ensureQuickAgent,
    async (): Promise<Result<Project>> => {
      try {
        const project = store.ensureQuickAgentProject();
        // Match projects.add: make sure the scratch project has an .mcp.json and
        // the various stores know about it, so a Quick Agent gets inbox push etc.
        ensureMcpConfigForProject(project.id).catch((err) =>
          ctx.logMainError(`ensureMcpConfigForProject(${project.id})`, err)
        );
        ctx.templates.rebindProjects();
        ctx.personas.rebindProjects();
        ctx.teams.rebindProjects();
        ctx.libraryStore.rebindProjects?.();
        ctx.scheduler.rebindWatchers();
        ctx.goals.rebindWatchers();
        ctx.followups.rebindWatchers();
        return { ok: true, value: project };
      } catch (err) {
        return { ok: false, code: 'ENSURE_QUICK_AGENT_FAILED', message: String(err) };
      }
    }
  );
  ctx.safeHandle(
    IPC.ssh.listHosts,
    async () => {
      const provider = ctx.sshHostProviderRegistry.activeModuleId();
      if (!provider) return parseSshConfig();
      try {
        const [generic, provided] = await Promise.all([
          parseSshConfig(),
          ctx.moduleRouter.dispatch(provider, 'listSshHosts', [])
        ]);
        return mergeSshHosts(generic, asSshHosts(provided));
      } catch (err) {
        ctx.logMainError(`ssh host provider ${provider}`, err);
        return parseSshConfig();
      }
    },
    () => []
  );
  ctx.safeHandle(
    IPC.ssh.syncHosts,
    async () => {
      const provider = ctx.sshHostProviderRegistry.activeModuleId();
      if (!provider) return { hosts: await parseSshConfig() };
      try {
        const provided = asSshSyncResult(await ctx.moduleRouter.dispatch(provider, 'syncSshHosts', []));
        return { ...provided, hosts: mergeSshHosts(await parseSshConfig(), provided.hosts) };
      } catch (err) {
        ctx.logMainError(`ssh host provider sync ${provider}`, err);
        return {
          hosts: await parseSshConfig(),
          warning: 'Could not refresh the selected SSH host provider; showing hosts from ~/.ssh/config.'
        };
      }
    },
    () => ({ hosts: [] })
  );
  ctx.safeHandle(
    IPC.projects.remove,
    async (id: string) => {
      ctx.ptys.list(id).forEach((s) => ctx.ptys.close(s.id));
      // A packaged runtime owns the project record and its settings cleanup.
      // Never fall back after a server error: the request may have committed.
      if (ctx.runtimeSupervisor) await ctx.runtimeSupervisor.removeProject(id);
      else store.removeProject(id);
      ctx.scheduler.onProjectRemoved(id);
      ctx.scheduler.rebindWatchers();
      ctx.goals.onProjectRemoved(id);
      ctx.goals.rebindWatchers();
      ctx.followups.onProjectRemoved(id);
      ctx.followups.rebindWatchers();
      ctx.feedStore.onProjectRemoved(id);
      ctx.templates.rebindProjects();
      ctx.personas.rebindProjects();
      ctx.teams.rebindProjects();
      ctx.libraryStore.rebindProjects?.();
      // If the removed project was the one whose .claude/skills we were watching,
      // tear the watcher down — its path is now gone or owned by no-one.
      if (ctx.activeProjectSkillsId === id) ctx.setActiveProjectSkillsWatcher(null, null);
    },
    () => undefined
  );
  ctx.safeHandle(
    IPC.projects.update,
    async (
      id: string,
      patch: {
        name?: string;
        color?: string;
        defaultAgents?: string[];
        defaultPersonas?: string[];
        launchDefault?: Project['launchDefault'];
        favorite?: boolean;
        remotePath?: string;
      }
    ) => {
      const usesLegacyFields = patch.defaultAgents !== undefined
        || patch.defaultPersonas !== undefined
        || patch.launchDefault !== undefined
        || patch.favorite !== undefined
        || patch.remotePath !== undefined;
      if (!ctx.runtimeSupervisor || usesLegacyFields || (patch.name === undefined && patch.color === undefined)) {
        return store.updateProject(id, patch);
      }
      const project = await ctx.runtimeSupervisor.updateProject(id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.color !== undefined ? { color: patch.color as '#2f81f7' | '#3fb950' | '#d4a017' | '#bc8cff' | '#39c5cf' | '#f85149' | '#ff7b72' | '#8b949e' } : {})
      });
      ctx.safeSend(IPC.projects.onChanged, await ctx.runtimeSupervisor.listProjects() as Project[]);
      return project as Project | null;
    },
    () => null
  );
  ctx.safeHandle(
    IPC.projects.touch,
    async (id: string) => {
      const touched = ctx.runtimeSupervisor
        ? await ctx.runtimeSupervisor.touchProject(id) as Project | null
        : store.touchProject(id);
      // Re-point the per-project skills watcher whenever the renderer signals
      // a project switch — `projects.touch` is the canonical "selected" signal.
      ctx.setActiveProjectSkillsWatcher(touched?.path ?? null, touched?.id ?? null);
      if (ctx.runtimeSupervisor && touched) {
        ctx.safeSend(IPC.projects.onChanged, await ctx.runtimeSupervisor.listProjects() as Project[]);
      }
      return touched;
    },
    () => null
  );
  ctx.safeHandle(
    IPC.projects.reorder,
    async (orderedIds: string[]) => {
      if (!ctx.runtimeSupervisor) return store.reorderProjects(orderedIds);
      const projects = await ctx.runtimeSupervisor.reorderProjects(orderedIds);
      ctx.safeSend(IPC.projects.onChanged, projects as Project[]);
      return projects as Project[];
    },
    () => []
  );
  ctx.safeHandle(
    IPC.projects.pickDirectory,
    async () => {
      const win = ctx.mainWindow();
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory']
      });
      return result.canceled ? null : result.filePaths[0];
    },
    () => null
  );
}

