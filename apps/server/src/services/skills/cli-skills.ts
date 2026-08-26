import { createHash } from 'node:crypto';
import { listHosts } from '@zana-ai/zcc-db';
import type {
  CliSkillMachineStatus,
  SystemCliSkillsStatusResponse,
  SystemInstallCliSkillsResponse
} from '@zana-ai/zcc-server-contract';
import type { HostGlobalSkillsStatusResult, HostInstallGlobalSkillsResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from '../../http/product-context.js';
import { HostUnavailableError } from '../../http/host-hub.js';
import {
  readBundledSkillMarkdown,
  ZCC_CLI_SKILL_NAME,
  ZCC_CLI_SKILL_RESOURCE
} from './skill-installer.js';

const STATUS_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 30_000;

export function hashSkillContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function statusFromEntries(
  entries: HostGlobalSkillsStatusResult['entries'],
  expectedHash: string
): CliSkillMachineStatus {
  if (entries.length === 0) return 'missing';
  const hashes = entries.map((row) => row.hash);
  if (hashes.every((hash) => hash === expectedHash)) return 'installed';
  if (hashes.every((hash) => hash === null)) return 'missing';
  return 'outdated';
}

function selectedHosts(ctx: ProductHttpContext, hostIds?: string[]) {
  const all = listHosts(ctx.db);
  if (!hostIds || hostIds.length === 0) return all;
  const wanted = new Set(hostIds);
  return all.filter((host) => wanted.has(host.id));
}

export async function cliSkillsStatus(
  ctx: ProductHttpContext,
  hostIds?: string[]
): Promise<SystemCliSkillsStatusResponse> {
  const content = readBundledSkillMarkdown(ZCC_CLI_SKILL_RESOURCE);
  const expectedHash = content ? hashSkillContent(content) : '';
  const connected = new Set(ctx.hostHub.connectedHostIds());
  const machines = await Promise.all(selectedHosts(ctx, hostIds).map(async (host) => {
    if (!connected.has(host.id) || !expectedHash) {
      return { hostId: host.id, hostName: host.name, status: 'unknown' as const };
    }
    try {
      const result = await ctx.hostHub.callHostOnlineRpc<HostGlobalSkillsStatusResult>({
        hostId: host.id,
        command: { type: 'host.global_skills_status', names: [ZCC_CLI_SKILL_NAME] },
        timeoutMs: STATUS_TIMEOUT_MS
      });
      return {
        hostId: host.id,
        hostName: host.name,
        status: statusFromEntries(result.entries, expectedHash)
      };
    } catch {
      return { hostId: host.id, hostName: host.name, status: 'unknown' as const };
    }
  }));
  return { machines };
}

export async function installCliSkills(
  ctx: ProductHttpContext,
  hostIds: string[]
): Promise<SystemInstallCliSkillsResponse> {
  const content = readBundledSkillMarkdown(ZCC_CLI_SKILL_RESOURCE);
  if (!content) {
    throw new Error('bundled zcc-cli skill was not found');
  }
  const hosts = selectedHosts(ctx, hostIds);
  const results: SystemInstallCliSkillsResponse['results'] = [];
  for (const host of hosts) {
    try {
      ctx.hostHub.ensureHostSessionReady(host.id);
      const result = await ctx.hostHub.callHostOnlineRpc<HostInstallGlobalSkillsResult>({
        hostId: host.id,
        command: {
          type: 'host.install_global_skills',
          skills: [{ name: ZCC_CLI_SKILL_NAME, content }]
        },
        timeoutMs: INSTALL_TIMEOUT_MS
      });
      results.push({
        ok: true,
        hostId: host.id,
        hostName: host.name,
        installations: result.installations
      });
    } catch (error) {
      results.push({
        ok: false,
        hostId: host.id,
        hostName: host.name,
        errorMessage: error instanceof HostUnavailableError
          ? error.message
          : error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { results };
}

export { statusFromEntries };
