// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { listCommands } from '@zana-ai/zcc-server/services/skills/commands';
import { listSkills, readHooks, revealSkillDir, setManyEnabled as setManySkillsEnabled, setSkillEnabled } from '@zana-ai/zcc-server/services/skills/skills';
import type { SkillBundleApplyMode, SkillBundleInput } from '@zana-ai/zcc-domain/product';

export function registerSkillsIpc(): void {
  
  ctx.safeHandle(
    IPC.skills.list,
    (projectPath?: string) => listSkills(ctx.projectPathToOptions(projectPath)),
    () => []
  );
  ctx.safeHandle(
    IPC.skills.setEnabled,
    (name: string, enabled: boolean) => setSkillEnabled(name, enabled),
    () => undefined
  );
  ctx.safeHandle(
    IPC.skills.setManyEnabled,
    (updates: Array<{ name: string; enabled: boolean }>) => setManySkillsEnabled(updates),
    () => undefined
  );
  ctx.safeHandle(IPC.skills.readHooks, () => readHooks(), () => null);
  ctx.safeHandle(
    IPC.skills.reveal,
    (skillId: string, projectPath?: string) =>
      revealSkillDir(skillId, ctx.projectPathToOptions(projectPath)),
    () => ({ ok: false, path: '', message: 'reveal failed' })
  );
  ctx.safeHandle(
    IPC.commands.list,
    (projectPath?: string) => listCommands(ctx.projectPathToOptions(projectPath)),
    () => []
  );
  ctx.safeHandle(IPC.skills.bundles.list, () => ctx.skillBundles.list(), () => []);
  ctx.safeHandle(
    IPC.skills.bundles.create,
    (input: SkillBundleInput) => ctx.skillBundles.create(input),
    () => null
  );
  ctx.safeHandle(
    IPC.skills.bundles.update,
    (id: string, patch: Partial<SkillBundleInput>) => ctx.skillBundles.update(id, patch),
    () => null
  );
  ctx.safeHandle(
    IPC.skills.bundles.delete,
    (id: string) => ctx.skillBundles.delete(id),
    () => false
  );
  ctx.safeHandle(
    IPC.skills.bundles.apply,
    (id: string, mode: SkillBundleApplyMode, projectPath?: string) =>
      ctx.skillBundles.apply(id, mode, ctx.projectPathToOptions(projectPath)),
    () => ({ ok: false, applied: 0, skippedPlugin: 0, message: 'apply failed' })
  );
  ctx.skillBundles.on('changed', (bundles) => {
    ctx.safeSend(IPC.skills.bundles.onChanged, bundles);
  });
}

