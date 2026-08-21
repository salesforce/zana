// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { harnessVerifyState } from './shared.js';
import { getHarnessAuthStatus, setHarnessAuth } from '@zana-ai/zcc-host-daemon/harness-auth';
import { resolveEffectiveHarnessDefault } from '@zana-ai/zcc-host-daemon/harness/effective-default';
import { verifyHarnesses } from '@zana-ai/zcc-host-daemon/harness/harness-verify';
import { harnessAdapterDescriptorsFromVerify, refreshDynamicHarnessCatalogs, registrationFor } from '@zana-ai/zcc-host-daemon/harness/registry';
import { store } from '@zana-ai/zcc-server/services/projects/store';
import type { HarnessAuthKey, HarnessAuthStatusInfo, LaunchProfileId } from '@zana-ai/zcc-domain/product';

export function registerExecutionIpc(): void {
  
  const verifiedHarnesses = () => {
    if (harnessVerifyState.cache && harnessVerifyState.cache.expiresAt > Date.now()) return harnessVerifyState.cache.result;
    const result = verifyHarnesses(store.getConfig());
    harnessVerifyState.cache = { expiresAt: Date.now() + 30_000, result };
    return result;
  };
  ipcMain.handle(IPC.executionConsent.listProject, (_event, projectId: string) =>
    ctx.executionConsentManagement.listProjectGrants(projectId)
  );
  ipcMain.handle(IPC.executionConsent.revokeProject, (_event, projectId: string, grantId: string) =>
    ctx.executionConsentManagement.revokeProjectGrant(projectId, grantId)
  );

  // Per-harness auth (Settings → Harness). Read main's own encrypted store (Rule 1
  // — never a renderer-supplied secret round-trip): `status` returns base URL +
  // hasToken per family; `set` stores/clears a family's base URL and/or token and
  // returns the refreshed status so the UI reflects the write without a second call.
  ctx.safeHandle(
    IPC.harnessAuth.status,
    () => getHarnessAuthStatus() as HarnessAuthStatusInfo[],
    () => []
  );
  ctx.safeHandle<[HarnessAuthKey, { baseUrl?: string | null; token?: string | null }], HarnessAuthStatusInfo[]>(
    IPC.harnessAuth.set,
    (key, patch) => {
      setHarnessAuth(key, patch);
      return getHarnessAuthStatus() as HarnessAuthStatusInfo[];
    },
    () => getHarnessAuthStatus() as HarnessAuthStatusInfo[]
  );

  // Code-harness verification (Settings → Code Harness). Probes each family's
  // `<binary> --version` best-effort against main's own config (Rule 1 — the
  // binary is resolved through the provider, never a renderer-supplied path).
  ctx.safeHandle(
    IPC.harness.verify,
    () => verifiedHarnesses(),
    () => []
  );
  ctx.safeHandle(
    IPC.harness.descriptors,
    async () => {
      const results = await verifiedHarnesses();
      await refreshDynamicHarnessCatalogs(results);
      return harnessAdapterDescriptorsFromVerify(results);
    },
    () => []
  );
  ctx.safeHandle(
    IPC.harness.agentDescriptors,
    async (projectId: unknown, profile: unknown, refresh: unknown) => {
      if (typeof projectId !== 'string' || typeof profile !== 'string') return { status: 'failure' };
      const project = store.listProjects().find((entry) => entry.id === projectId);
      if (!project || project.remote) return { status: 'failure' };
      const registration = registrationFor(profile as LaunchProfileId);
      if (!registration?.discoverAgentDescriptors) return { status: 'failure' };
      const verified = (await verifiedHarnesses()).find((result) => result.family === registration.id);
      if (!verified?.enabled || !verified.installed) return { status: 'failure' };
      return registration.discoverAgentDescriptors({
        profile: profile as LaunchProfileId,
        cwd: project.path,
        config: store.getConfig(),
        refresh: refresh === true
      });
    },
    () => ({ status: 'failure' as const })
  );
  ctx.safeHandle(
    IPC.harness.effectiveDefault,
    async (projectId: unknown) => {
      if (typeof projectId !== 'string') {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Project not found' };
      }
      return resolveEffectiveHarnessDefault({
        project: store.listProjects().find((entry) => entry.id === projectId),
        config: store.getConfig(),
        personas: ctx.personas.list(),
        availability: await verifiedHarnesses()
      });
    },
    () => ({ ok: false as const, code: 'UNAVAILABLE_DEFAULT' as const, message: 'Default harness unavailable' })
  );
}

