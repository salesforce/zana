const RESERVED = new Set([
  'acp-cursor',
  'acp-opencode',
  'acp-omp',
  'acp-grok',
  'acp-hermes-agent',
  'claude-code',
  'codex',
  'pi',
  'fake'
]);

function parseCustomAgents(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return { agents: [], rejectedIds: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { agents: [], rejectedIds: [] };
  }
  const listed = Array.isArray(parsed) ? parsed : [parsed];
  const agents = [];
  const rejectedIds = [];
  const seen = new Set();
  for (const entry of listed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const displayName = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
    const command = typeof entry.command === 'string' ? entry.command.trim() : '';
    const args = entry.args === undefined ? [] : entry.args;
    const env = entry.env === undefined ? {} : entry.env;
    if (!id || !/^[a-z][a-z0-9-]*$/u.test(id) || !displayName || !command) continue;
    if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) continue;
    if (!env || typeof env !== 'object' || Array.isArray(env) || Object.values(env).some((value) => typeof value !== 'string')) continue;
    if (RESERVED.has(id) || seen.has(id)) {
      rejectedIds.push(id);
      continue;
    }
    seen.add(id);
    agents.push({ id, displayName, command, args, env });
  }
  return { agents, rejectedIds };
}

const extraCapabilities = {
  supportsServiceTier: false,
  supportsNativeUserQuestion: false,
  fork: 'tip',
  supportsManualCompaction: false,
  supportsThreadArchive: false,
  supportsThreadRename: false,
  supportsWorkflows: false,
  permissionModes: ['accept-edits', 'full']
};

/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  const settings = zcc.settings.define({
    customAgents: {
      type: 'string',
      multiline: true,
      label: 'Custom ACP agents',
      description:
        'JSON array of { id, displayName, command, args?, env? }. Ids must be unique and cannot reuse built-in providers.',
      default: '[]'
    }
  });
  zcc.agents.experimental_registerProvider({
    id: 'acp-cursor',
    displayName: 'Cursor',
    icon: './icons/cursor.svg',
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: 'tip',
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ['accept-edits', 'full'],
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max']
    },
    composerActions: []
  });
  zcc.agents.experimental_registerProvider({
    id: 'acp-opencode',
    displayName: 'OpenCode',
    icon: './icons/opencode.svg',
    visibility: 'installed',
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: 'tip',
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ['accept-edits', 'full'],
      reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max']
    },
    composerActions: []
  });
  zcc.agents.experimental_registerProvider({
    id: 'acp-omp',
    displayName: 'OMP',
    icon: './icons/omp.svg',
    visibility: 'installed',
    capabilities: extraCapabilities,
    composerActions: []
  });
  zcc.agents.experimental_registerProvider({
    id: 'acp-grok',
    displayName: 'Grok Build',
    icon: './icons/grok.svg',
    visibility: 'installed',
    capabilities: extraCapabilities,
    composerActions: []
  });
  zcc.agents.experimental_registerProvider({
    id: 'acp-hermes-agent',
    displayName: 'Hermes Agent',
    icon: './icons/hermes.svg',
    visibility: 'installed',
    capabilities: extraCapabilities,
    composerActions: []
  });

  let customHandles = [];
  const applyCustom = (raw) => {
    for (const handle of customHandles) handle.unregister();
    const { agents, rejectedIds } = parseCustomAgents(raw);
    for (const id of rejectedIds) {
      zcc.log.warn(`Ignoring reserved or duplicate custom ACP agent id "${id}".`);
    }
    customHandles = agents.map((agent) =>
      zcc.agents.experimental_registerProvider({
        id: agent.id,
        displayName: agent.displayName,
        visibility: 'installed',
        capabilities: extraCapabilities,
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
      })
    );
  };
  void settings.get().then((values) => applyCustom(values.customAgents));
  settings.onChange((values) => applyCustom(values.customAgents));
}
