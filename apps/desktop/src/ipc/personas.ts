// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { buildSquadBundle, validateSquadBundle } from '@zana-ai/zcc-server/services/agents/squad-bundle';
import { BrowserWindow, dialog } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import type { CancelTeamLaunchResult, LaunchTeamResult, LlmPromptEntry, LlmProviderId, LlmRunResult, Persona, PersonaInput, QuickPrompt, Result, SquadBundle, Team, TeamInput } from '@zana-ai/zcc-domain/product';

export function registerPersonasIpc(): void {
  

  ctx.safeHandle(IPC.personas.list, () => ctx.personas.list(), () => []);
  ctx.safeHandle(
    IPC.personas.revealDir,
    () => ctx.personas.revealDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal ctx.personas directory' })
  );
  // Create / overwrite a user persona (the editor's save). Built-in ids write a
  // user shadow; an absent id mints a new slug. Validation lives in the store
  // (shared with the disk loader) — the renderer is untrusted, so a bad payload
  // comes back as a clean Result error rather than a thrown handler.
  ipcMain.handle(
    IPC.personas.save,
    async (_e, input: PersonaInput): Promise<Result<Persona>> => {
      try {
        if (!input || typeof input.name !== 'string' || !input.name.trim()) {
          return { ok: false, code: 'INVALID', message: 'name is required' };
        }
        return { ok: true, value: ctx.personas.saveUser(input) };
      } catch (err) {
        return { ok: false, code: 'PERSONA_SAVE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.personas.duplicate,
    async (_e, id: string): Promise<Result<Persona>> => {
      try {
        if (typeof id !== 'string' || !id.trim()) {
          return { ok: false, code: 'INVALID', message: 'id is required' };
        }
        return { ok: true, value: ctx.personas.duplicateUser(id) };
      } catch (err) {
        return { ok: false, code: 'PERSONA_DUPLICATE_FAILED', message: String(err) };
      }
    }
  );
  // Delete a user persona file. For a shadowed built-in this resets it to the
  // shipped default; for a user persona it removes it. Project ctx.personas are
  // read-only here (their files live under the repo, not the user dir).
  ipcMain.handle(
    IPC.personas.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        if (typeof id !== 'string' || !id.trim()) {
          return { ok: false, code: 'INVALID', message: 'id is required' };
        }
        const removed = ctx.personas.deleteUser(id);
        if (!removed) {
          return { ok: false, code: 'NOT_FOUND', message: `no user persona: ${id}` };
        }
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'PERSONA_DELETE_FAILED', message: String(err) };
      }
    }
  );
  ctx.personas.on('changed', () => {
    ctx.safeSend(IPC.personas.onChanged, ctx.personas.list());
  });

  ctx.safeHandle(IPC.teams.list, () => ctx.teams.list(), () => []);
  ctx.safeHandle(
    IPC.teams.revealDir,
    () => ctx.teams.revealDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal ctx.teams directory' })
  );
  // Create / overwrite a user team. Validation lives in the store (shared with
  // the disk loader); a bad payload comes back as a clean Result error.
  ipcMain.handle(
    IPC.teams.save,
    async (_e, input: TeamInput): Promise<Result<Team>> => {
      try {
        if (!input || typeof input.name !== 'string' || !input.name.trim()) {
          return { ok: false, code: 'INVALID', message: 'name is required' };
        }
        return { ok: true, value: ctx.teams.saveUser(input) };
      } catch (err) {
        return { ok: false, code: 'TEAM_SAVE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.teams.duplicate,
    async (_e, id: string): Promise<Result<Team>> => {
      try {
        if (typeof id !== 'string' || !id.trim()) {
          return { ok: false, code: 'INVALID', message: 'id is required' };
        }
        return { ok: true, value: ctx.teams.duplicateUser(id) };
      } catch (err) {
        return { ok: false, code: 'TEAM_DUPLICATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.teams.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        if (typeof id !== 'string' || !id.trim()) {
          return { ok: false, code: 'INVALID', message: 'id is required' };
        }
        const removed = ctx.teams.deleteUser(id);
        if (!removed) {
          return { ok: false, code: 'NOT_FOUND', message: `no user team: ${id}` };
        }
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'TEAM_DELETE_FAILED', message: String(err) };
      }
    }
  );
  // Launch a team into a project. main authorizes (team + project + personaId
  // existence are all re-checked main-side); unknown persona slots are skipped.
  ipcMain.handle(
    IPC.teams.launch,
    async (
      _e,
      teamId: string,
      projectId?: string
    ): Promise<Result<LaunchTeamResult>> => {
      try {
        if (typeof teamId !== 'string' || !teamId.trim()) {
          return { ok: false, code: 'INVALID', message: 'teamId is required' };
        }
        return await ctx.launchTeam(
          teamId,
          typeof projectId === 'string' ? projectId : undefined,
          { callerPrincipalId: 'interactive:local' }
        );
      } catch (err) {
        return { ok: false, code: 'TEAM_LAUNCH_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.teams.cancel,
    async (_e, launchRequestId: string): Promise<Result<CancelTeamLaunchResult>> => {
      if (typeof launchRequestId !== 'string' || !launchRequestId.trim()) {
        return { ok: false, code: 'INVALID', message: 'launchRequestId is required' };
      }
      return ctx.cancelTeamLaunch('interactive:local', launchRequestId);
    }
  );
  // Launch a team as an autonomous run / stop one. Bodies live in the exported
  // ctx.launchAutonomousTeam / ctx.stopAutonomousRun functions (unit-tested end-to-end).
  ipcMain.handle(
    IPC.teams.launchAutonomous,
    async (_e, teamId: string, projectId: string, goal: string): Promise<Result<{ runId: string }>> =>
      ctx.launchAutonomousTeam(teamId, projectId, goal)
  );
  ipcMain.handle(
    IPC.teams.stopAutonomous,
    async (_e, runId: string): Promise<Result<true>> => ctx.stopAutonomousRun(runId)
  );
  ctx.safeHandle(IPC.autonomousRuns.list, () => ctx.autonomousRuns.list(), () => []);
  // Export a team + its referenced ctx.personas as one bundle file. Main owns the
  // save dialog (Rule 1 — never a renderer-supplied path); a dismissed dialog
  // resolves `canceled: true`, not an error.
  ipcMain.handle(
    IPC.teams.exportBundle,
    async (_e, teamId: string): Promise<Result<{ path: string; canceled?: boolean }>> => {
      try {
        if (typeof teamId !== 'string' || !teamId.trim()) {
          return { ok: false, code: 'INVALID', message: 'teamId is required' };
        }
        const team = ctx.teams.list().find((t) => t.id === teamId);
        if (!team) return { ok: false, code: 'NOT_FOUND', message: `no team: ${teamId}` };
        const win = BrowserWindow.getFocusedWindow() ?? ctx.mainWindow();
        if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
        const bundle: SquadBundle = buildSquadBundle(team, ctx.personas.list());
        const slug = team.id.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const result = await dialog.showSaveDialog(win, {
          title: `Export "${team.name}" squad bundle`,
          defaultPath: `${slug}.squad.json`,
          filters: [{ name: 'Squad bundle', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) {
          return { ok: true, value: { path: '', canceled: true } };
        }
        writeFileSync(result.filePath, JSON.stringify(bundle, null, 2));
        return { ok: true, value: { path: result.filePath } };
      } catch (err) {
        return { ok: false, code: 'BUNDLE_EXPORT_FAILED', message: String(err) };
      }
    }
  );
  // Import a bundle file picked via a main-owned open dialog: each persona is
  // written through ctx.personas.saveUser, then the team through ctx.teams.saveUser —
  // the same validation gates a hand-edited persona/team file goes through.
  ipcMain.handle(
    IPC.teams.importBundle,
    async (): Promise<Result<{ team?: Team; personaCount: number; canceled?: boolean }>> => {
      try {
        const win = BrowserWindow.getFocusedWindow() ?? ctx.mainWindow();
        if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
        const pick = await dialog.showOpenDialog(win, {
          title: 'Import squad bundle',
          properties: ['openFile'],
          filters: [{ name: 'Squad bundle', extensions: ['json'] }]
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: true, value: { personaCount: 0, canceled: true } };
        }
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(pick.filePaths[0], 'utf8'));
        } catch (err) {
          return { ok: false, code: 'INVALID_JSON', message: `Unreadable bundle file: ${String(err)}` };
        }
        const validated = validateSquadBundle(raw);
        if ('error' in validated) {
          return { ok: false, code: 'INVALID_BUNDLE', message: validated.error };
        }
        for (const persona of validated.personas) ctx.personas.saveUser(persona);
        const savedTeam = ctx.teams.saveUser(validated.team);
        return { ok: true, value: { team: savedTeam, personaCount: validated.personas.length } };
      } catch (err) {
        return { ok: false, code: 'BUNDLE_IMPORT_FAILED', message: String(err) };
      }
    }
  );
  ctx.teams.on('changed', () => {
    ctx.safeSend(IPC.teams.onChanged, ctx.teams.list());
  });

  ctx.safeHandle(IPC.quickPrompts.list, () => ctx.quickPrompts.list(), () => []);
  // Editor write path (Agents launcher → "New / Edit quick prompt"). save
  // validates + persists a user file (shadows a builtin by id); delete removes
  // the user file (resetting a shadowed builtin to its shipped default).
  ctx.safeHandle<[QuickPrompt], QuickPrompt>(
    IPC.quickPrompts.save,
    (entry) => ctx.quickPrompts.saveUser(entry),
    // Re-throw so a write-time validation failure rejects the renderer's invoke
    // and surfaces as a UI error rather than silently reporting success.
    (err) => {
      throw err;
    }
  );
  ctx.safeHandle<[string], void>(
    IPC.quickPrompts.delete,
    (id) => ctx.quickPrompts.deleteUser(id),
    () => undefined
  );
  ctx.safeHandle(
    IPC.quickPrompts.revealDir,
    () => ctx.quickPrompts.revealUserDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal quick-prompts directory' })
  );
  ctx.quickPrompts.on('changed', () => {
    ctx.safeSend(IPC.quickPrompts.onChanged, ctx.quickPrompts.list());
  });

  // LLM micro-call prompt registry (Settings → Prompts). list/save/delete back
  // the editor; test runs a prompt and returns the result.
  ctx.safeHandle(IPC.llmPrompts.list, () => ctx.promptRegistry.list(), () => []);
  ctx.safeHandle<[LlmPromptEntry], LlmPromptEntry>(
    IPC.llmPrompts.save,
    (entry) => ctx.promptRegistry.saveUser(entry),
    // Re-throw so a write-time validation failure (e.g. an unusable model)
    // rejects the renderer's invoke and surfaces as a UI error, rather than
    // silently reporting success on a rejected write.
    (err) => {
      throw err;
    }
  );
  ctx.safeHandle<[string], void>(
    IPC.llmPrompts.delete,
    (id) => ctx.promptRegistry.deleteUser(id),
    () => undefined
  );
  ctx.safeHandle<[string, Record<string, string>], LlmRunResult>(
    IPC.llmPrompts.test,
    async (id, vars) => {
      const entry = ctx.promptRegistry.get(id);
      if (!entry) {
        return {
          ok: false,
          text: '',
          error: `no prompt with id '${id}'`,
          provider: 'claude-cli',
          ms: 0
        };
      }
      return ctx.llmService.run(entry, vars ?? {});
    },
    (err) => ({
      ok: false,
      text: '',
      error: err instanceof Error ? err.message : String(err),
      provider: 'claude-cli',
      ms: 0
    })
  );
  ctx.safeHandle(
    IPC.llmPrompts.revealDir,
    () => ctx.promptRegistry.revealUserDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal llm-prompts directory' })
  );
  // Which LLM providers are usable right now (registered AND their key/binary is
  // in place). The Prompts picker offers only these so a user can't select a
  // provider that would silently return `ok:false 'no API key'`. Degrades to the
  // always-available claude-cli on any failure.
  ctx.safeHandle(
    IPC.llmPrompts.availableProviders,
    () => ctx.llmService.availableProviders(),
    () => ['claude-cli'] as LlmProviderId[]
  );
  ctx.promptRegistry.on('changed', () => {
    ctx.safeSend(IPC.llmPrompts.onChanged, ctx.promptRegistry.list());
  });
}

