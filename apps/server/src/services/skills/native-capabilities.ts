import { dirname } from 'node:path';
import { getPrimaryHost } from '@zana-ai/zcc-db';
import { projectFileRoot, ProjectFsError } from '../../http/project-fs-via-host.js';
import { resolveProjectHost } from '../../http/project-host.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { callPluginHostRpc } from '../../plugins/plugin-host-rpc.js';
import { experimental_nativeRootsHostContract } from '@zana-ai/zcc-plugin-sdk/host';
import {
  EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS,
  normalizeProviderNativeRoots
} from '@zana-ai/zcc-domain/thread-runtime';
import type { HostProviderCommand } from '@zana-ai/zcc-host-daemon-contract';
import type { SkillEntry } from '@zana-ai/zcc-domain/product';
import {
  listThreadProviders,
  canonicalThreadProviderId
} from '../threads/thread-provider-catalog.js';
import { entryId, SKILL_PROVIDERS } from '../skill-providers/registry.js';
import { disabledSkillNames } from './skill-settings.js';

export interface NativeCapabilityOptions {
  projectId?: string;
  providerId?: string;
  hostId?: string;
  environmentId?: string;
}
export interface NativeCapabilityCommand {
  id: string;
  name: string;
  providerId: string;
  description: string;
  source: 'skill' | 'command';
}
export interface NativeCapabilityListing {
  skills: SkillEntry[];
  commands: NativeCapabilityCommand[];
  diagnostics: string[];
}

/** Both product surfaces read the same host scan. No filesystem path from the renderer is accepted. */
export async function listNativeCapabilities(
  ctx: ProductHttpContext,
  options: NativeCapabilityOptions = {}
): Promise<NativeCapabilityListing> {
  let hostId: string;
  let cwd: string | null = null;
  if (options.projectId) {
    const project = ctx.toProjects().find((row) => row.id === options.projectId);
    if (!project) throw new ProjectFsError(404, 'unknown-project', 'Project is not registered');
    if (project.remote && !project.hostId)
      throw new ProjectFsError(
        409,
        'host-unavailable',
        'Connect this remote project’s execution host to discover its skills.'
      );
    // Catalogue uses the project's fixed target; a thread may name its recorded source/environment.
    hostId = resolveProjectHost(ctx, options.hostId ?? project.hostId);
    const target = projectFileRoot(ctx, {
      projectId: project.id,
      hostId,
      ...(options.environmentId ? { environmentId: options.environmentId } : {})
    });
    cwd = target.root;
  } else {
    if (options.hostId || options.environmentId)
      throw new ProjectFsError(400, 'invalid-scope', 'A project is required for a scoped listing');
    hostId = resolveProjectHost(ctx);
  }
  ctx.hostHub.ensureHostSessionReady(hostId);
  const local = hostId === getPrimaryHost(ctx.db)?.id;
  const disabled = local ? await disabledSkillNames() : new Set<string>();
  const result: NativeCapabilityListing = { skills: [], commands: [], diagnostics: [] };
  const providers = listThreadProviders()
    .filter(
      (row) => !options.providerId || row.id === canonicalThreadProviderId(options.providerId)
    )
    .slice(0, 32);
  for (const provider of providers) {
    if (
      !provider.experimental_nativeSkillRoots &&
      !provider.experimental_nativeCommandRoots &&
      !provider.experimental_resolvesNativeRoots
    )
      continue;
    try {
      let resolved = EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS;
      const descriptor = SKILL_PROVIDERS.find(
        (row) => canonicalThreadProviderId(row.id) === provider.id
      );
      let providerDisabled =
        descriptor?.toggle.kind === 'settings-overrides' ? disabled : new Set<string>();
      const deadline = Date.now() + 20_000;
      if (provider.experimental_resolvesNativeRoots) {
        const artifact = ctx.pluginHostArtifacts.get(provider.pluginId);
        if (!artifact)
          result.diagnostics.push(
            `${provider.displayName}: native location resolver is unavailable.`
          );
        else {
          try {
            const answer = await callPluginHostRpc(ctx, {
              pluginId: provider.pluginId,
              artifact,
              method: 'resolveNativeRoots',
              input: { providerId: provider.id, cwd },
              hostId,
              ...(cwd ? { projectRoot: cwd } : {}),
              timeoutMs: 12_000
            });
            const { disabledSkillNames: hostDisabled, ...roots } =
              experimental_nativeRootsHostContract.resolveNativeRoots.output.parse(answer);
            resolved = roots;
            if (hostDisabled) providerDisabled = new Set(hostDisabled);
          } catch (error) {
            result.diagnostics.push(
              `${provider.displayName}: could not resolve native locations (${error instanceof Error ? error.message : String(error)}).`
            );
          }
        }
      }
      const scan = await ctx.hostHub.callHostOnlineRpc<{
        commands: HostProviderCommand[];
        diagnostics?: string[];
      }>({
        hostId,
        timeoutMs: Math.max(1_000, deadline - Date.now()),
        command: {
          type: 'host.list_commands',
          providerId: provider.id,
          cwd,
          nativeRoots: {
            skills: normalizeProviderNativeRoots(provider.experimental_nativeSkillRoots ?? {}),
            commands: normalizeProviderNativeRoots(provider.experimental_nativeCommandRoots ?? {}),
            resolved
          }
        }
      });
      result.diagnostics.push(
        ...(scan.diagnostics ?? []).map((message) => `${provider.displayName}: ${message}`)
      );
      for (const row of scan.commands) {
        if (!row.filePath) continue;
        const plugin = row.namePrefix ? row.namePrefix.slice(0, -1) : undefined;
        const prefixEnd = row.name.indexOf(':');
        const source = plugin ? 'plugin' : row.origin;
        const shortName = plugin ? row.name.slice(prefixEnd + 1) : row.name;
        const qualified = `${plugin ? `${plugin}/` : ''}${row.qualifiedName ?? shortName}`;
        const tool = descriptor?.id ?? provider.id;
        const enabled =
          row.source === 'command' ||
          (!providerDisabled.has(row.name) && !providerDisabled.has(shortName));
        const toggle =
          row.source === 'skill' && descriptor && local
            ? descriptor.toggleState(
                {
                  path: dirname(row.filePath),
                  shortName,
                  qualifiedName: qualified,
                  source,
                  pluginName: plugin,
                  parsed: {}
                },
                providerDisabled
              )
            : {
                supported: false,
                enabled,
                reason:
                  row.source === 'command'
                    ? 'Managed in the command file'
                    : 'Managed by the provider on its execution host'
              };
        toggle.enabled = enabled;
        result.skills.push({
          id:
            row.source === 'command'
              ? `command:${tool}:${source}:${qualified}`
              : entryId(tool, source, qualified),
          name: shortName,
          tool,
          toolLabel: provider.displayName,
          source,
          pluginName: plugin,
          ...(source === 'project' ? { projectId: options.projectId } : {}),
          path: row.source === 'skill' ? dirname(row.filePath) : row.filePath,
          kind: row.source,
          revealable: local && descriptor?.toggle.kind === 'settings-overrides',
          linked: row.linked,
          providerId: provider.id,
          hostId,
          userInvocable: row.userInvocable,
          disableModelInvocation: row.disableModelInvocation,
          description: row.description ?? undefined,
          allowedTools: row.allowedTools,
          toggle,
          enabled: toggle.enabled
        });
        if (toggle.enabled && row.userInvocable !== false)
          result.commands.push({
            id: `${provider.id}:${source}:${row.name}`,
            name: `/${row.name}`,
            providerId: provider.id,
            description: row.description ?? '',
            source: row.source
          });
      }
    } catch (error) {
      result.diagnostics.push(
        `${provider.displayName}: discovery failed (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }
  // Skills take precedence over legacy commands; project roots were scanned before user roots.
  result.commands.sort((a, b) => Number(a.source === 'command') - Number(b.source === 'command'));
  const seen = new Set<string>();
  result.commands = result.commands.filter((row) => {
    const key = `${row.providerId}:${row.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const skillIds = new Set<string>();
  result.skills = result.skills.filter((row) => {
    if (skillIds.has(row.id)) return false;
    skillIds.add(row.id);
    return true;
  });
  return result;
}
