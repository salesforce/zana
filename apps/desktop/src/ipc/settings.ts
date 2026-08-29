// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { trustedProjectRoot } from './shared.js';
import { claudeProjectFilePath, readClaudeProjectSettings, writeClaudeProjectSettings } from '@zana-ai/zcc-server/services/projects/claude-settings';
import { readCodexProjectSettings, readOpenCodeProjectSettings, writeCodexProjectSettings, writeOpenCodeProjectSettings } from '@zana-ai/zcc-server/services/misc/harness-settings';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import { dialog, shell } from 'electron';
import type { ClaudeProjectFileId, ClaudeProjectSettings, ClaudeSettingsResult, ClaudeSettingsScope, CodexProjectSettings, CodexSettingsResult, OpenCodeProjectSettings, OpenCodeSettingsResult, OpenResult } from '@zana-ai/zcc-domain/product';

export function registerSettingsIpc(): void {
  
  ctx.safeHandleFromWindow<[string, ClaudeSettingsScope], ClaudeSettingsResult>(
    IPC.claudeSettings.read,
    async (win, projectId: string, scope: ClaudeSettingsScope) => {
      if (win !== ctx.mainWindow()) return { state: 'io-error' as const, message: 'Claude settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      if (!project) return { state: 'io-error' as const, message: 'Project is unavailable' };
      const root = await trustedProjectRoot(project.path);
      return root
        ? readClaudeProjectSettings(root, scope)
        : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'Claude settings read failed' })
  );
  ctx.safeHandleFromWindow<[string, ClaudeSettingsScope, ClaudeProjectSettings, string | null], ClaudeSettingsResult>(
    IPC.claudeSettings.write,
    async (
      win,
      projectId: string,
      scope: ClaudeSettingsScope,
      patch: ClaudeProjectSettings,
      expectedHash: string | null
    ) => {
      if (win !== ctx.mainWindow()) return { state: 'io-error' as const, message: 'Claude settings are unavailable from this window' };
      const permissions = patch?.permissions;
      const widensPermissions =
        permissions?.defaultMode === 'bypassPermissions' ||
        !!permissions?.allow?.length ||
        !!permissions?.additionalDirectories?.length;
      if (widensPermissions) {
        const confirmation = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Cancel', 'Allow change'],
          defaultId: 0,
          cancelId: 0,
          title: 'Allow Claude permission change?',
          message: 'This change can expand Claude access or disable permission prompts for this project.',
          detail: 'Review the project settings before allowing this change.'
        });
        if (confirmation.response !== 1) {
          return { state: 'io-error' as const, message: 'Claude permission change was not allowed' };
        }
      }
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      if (!project) return { state: 'io-error' as const, message: 'Project is unavailable' };
      const root = await trustedProjectRoot(project.path);
      return root
        ? writeClaudeProjectSettings(root, scope, patch, expectedHash)
        : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'Claude settings write failed' })
  );
  ctx.safeHandleFromWindow<[string, ClaudeProjectFileId], OpenResult>(
    IPC.claudeSettings.openFile,
    async (win, projectId: string, fileId: ClaudeProjectFileId): Promise<OpenResult> => {
      if (win !== ctx.mainWindow()) return { ok: false, message: 'Claude project files are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      if (!project) return { ok: false, message: 'Project is unavailable' };
      const root = await trustedProjectRoot(project.path);
      const path = root ? await claudeProjectFilePath(root, fileId) : null;
      if (!path) return { ok: false, message: 'Claude project file is unavailable' };
      const error = await shell.openPath(path);
      return error ? { ok: false, message: error } : { ok: true };
    },
    () => ({ ok: false, message: 'Could not open Claude project file' })
  );
  ctx.safeHandleFromWindow<[string], CodexSettingsResult>(
    IPC.codexSettings.read,
    async (win, projectId) => {
      if (win !== ctx.mainWindow()) return { state: 'io-error' as const, message: 'Codex settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      const root = project && await trustedProjectRoot(project.path);
      return root ? readCodexProjectSettings(root) : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'Codex settings read failed' })
  );
  ctx.safeHandleFromWindow<[string, CodexProjectSettings, string | null], CodexSettingsResult>(
    IPC.codexSettings.write,
    async (win, projectId, patch, expectedHash) => {
      if (win !== ctx.mainWindow()) return { state: 'io-error' as const, message: 'Codex settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      const root = project && await trustedProjectRoot(project.path);
      return root ? writeCodexProjectSettings(root, patch, expectedHash) : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'Codex settings write failed' })
  );
  ctx.safeHandleFromWindow<[string], OpenCodeSettingsResult>(
    IPC.openCodeSettings.read,
    async (win, projectId) => {
      if (win !== ctx.mainWindow()) return { state: 'io-error' as const, message: 'OpenCode settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      const root = project && await trustedProjectRoot(project.path);
      return root ? readOpenCodeProjectSettings(root) : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'OpenCode settings read failed' })
  );
  ctx.safeHandleFromWindow<[string, OpenCodeProjectSettings, string | null], OpenCodeSettingsResult>(
    IPC.openCodeSettings.write,
    async (win, projectId, patch, expectedHash) => {
      if (win !== ctx.mainWindow()) return { state: 'io-error' as const, message: 'OpenCode settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      const root = project && await trustedProjectRoot(project.path);
      return root ? writeOpenCodeProjectSettings(root, patch, expectedHash) : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'OpenCode settings write failed' })
  );
}

