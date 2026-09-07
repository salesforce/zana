import type {
  PluginProviderDeclaration,
  PluginProviderHandle,
  PluginSettingValue,
  ZccPluginApi
} from '@zana-ai/zcc-plugin-sdk';

export const RESERVED_ACP_PROVIDER_IDS = [
  'acp-cursor',
  'acp-opencode',
  'acp-omp',
  'acp-grok',
  'acp-hermes-agent',
  'claude-code',
  'codex',
  'pi',
  'fake'
] as const;

export const CUSTOM_ACP_AGENTS_SETTING = 'customAgents';

export interface CustomAcpAgentConfig {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return null;
  return value;
}

function stringMap(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null;
    next[key] = entry;
  }
  return next;
}

export function parseCustomAcpAgents(raw: PluginSettingValue | undefined): {
  agents: CustomAcpAgentConfig[];
  rejectedIds: string[];
} {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { agents: [], rejectedIds: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { agents: [], rejectedIds: [] };
  }
  const listed = Array.isArray(parsed) ? parsed : [parsed];
  const agents: CustomAcpAgentConfig[] = [];
  const rejectedIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of listed) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const displayName = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
    const command = typeof entry.command === 'string' ? entry.command.trim() : '';
    const args = stringArray(entry.args);
    const env = stringMap(entry.env);
    if (!id || !PROVIDER_ID_PATTERN.test(id) || !displayName || !command || args === null || env === null) {
      continue;
    }
    if (
      (RESERVED_ACP_PROVIDER_IDS as readonly string[]).includes(id)
      || seen.has(id)
    ) {
      rejectedIds.push(id);
      continue;
    }
    seen.add(id);
    agents.push({ id, displayName, command, args, env });
  }
  return { agents, rejectedIds };
}

export function customAcpProviderDeclaration(
  agent: CustomAcpAgentConfig
): PluginProviderDeclaration {
  return {
    id: agent.id,
    displayName: agent.displayName,
    visibility: 'installed',
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: 'tip',
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ['accept-edits', 'full']
    },
    composerActions: [],
    deriveProviderOptions() {
      return {
        acpLaunchSpec: {
          displayName: agent.displayName,
          command: agent.command,
          args: agent.args,
          env: agent.env
        }
      };
    }
  };
}

export function syncCustomAcpAgents(
  zcc: Pick<ZccPluginApi, 'agents' | 'log'>,
  raw: PluginSettingValue | undefined,
  previous: PluginProviderHandle[]
): PluginProviderHandle[] {
  for (const handle of previous) handle.unregister();
  const { agents, rejectedIds } = parseCustomAcpAgents(raw);
  for (const id of rejectedIds) {
    zcc.log.warn(`Ignoring reserved or duplicate custom ACP agent id "${id}".`);
  }
  return agents.map((agent) => zcc.agents.experimental_registerProvider(customAcpProviderDeclaration(agent)));
}

export const ACP_CUSTOM_AGENTS_SETTING = {
  [CUSTOM_ACP_AGENTS_SETTING]: {
    type: 'string' as const,
    multiline: true as const,
    label: 'Custom ACP agents',
    description:
      'JSON array of { id, displayName, command, args?, env? }. Ids must be unique and cannot reuse built-in providers.',
    default: '[]'
  }
};
