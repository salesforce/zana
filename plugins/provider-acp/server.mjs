const RESERVED = new Set([
  'acp-cursor',
  'acp-opencode',
  'acp-omp',
  'acp-grok',
  'acp-mastracode',
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
    const cwd = entry.cwd;
    if (!id || !/^[a-z][a-z0-9-]*$/u.test(id) || !displayName || !command || /[\0\r\n]/u.test(command)) continue;
    if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) continue;
    if (!env || typeof env !== 'object' || Array.isArray(env)
      || Object.entries(env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof value !== 'string' || value.includes('\0'))) continue;
    if (cwd !== undefined && (typeof cwd !== 'string' || !cwd.trim() || cwd.includes('\0'))) continue;
    if (RESERVED.has(id) || seen.has(id)) {
      rejectedIds.push(id);
      continue;
    }
    seen.add(id);
    agents.push({ id, displayName, command, args, env, ...(cwd === undefined ? {} : { cwd }) });
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
        'JSON array of { id, displayName, command, args?, env?, cwd? }. Ids must be unique and cannot reuse built-in providers.',
      default: '[]'
    }
  });
  zcc.agents.experimental_registerProvider({
    id: "acp-cursor",
    ...{
      "experimental_nativeSkillRoots": {
        "user": [
          {
            "path": ".cursor/skills",
            "recursive": true
          },
          {
            "path": ".agents/skills",
            "recursive": true
          },
          {
            "path": ".claude/skills",
            "skipIfManifest": ".claude-plugin/plugin.json",
            "recursive": true
          },
          {
            "path": ".codex/skills",
            "recursive": true
          }
        ],
        "project": [
          {
            "path": ".cursor/skills",
            "recursive": true,
            "ancestors": true
          },
          {
            "path": ".agents/skills",
            "recursive": true,
            "ancestors": true
          },
          {
            "path": ".claude/skills",
            "skipIfManifest": ".claude-plugin/plugin.json",
            "recursive": true,
            "ancestors": true
          },
          {
            "path": ".codex/skills",
            "recursive": true,
            "ancestors": true
          }
        ]
      },
      "experimental_resolvesNativeRoots": true
    },
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
    id: "acp-opencode",
    ...{
      "experimental_nativeSkillRoots": {
        "user": [
          {
            "path": ".claude/skills",
            "skipIfManifest": ".claude-plugin/plugin.json"
          },
          ".agents/skills"
        ],
        "project": [
          {
            "path": ".opencode/skills",
            "ancestors": true
          },
          {
            "path": ".claude/skills",
            "skipIfManifest": ".claude-plugin/plugin.json",
            "ancestors": true
          },
          {
            "path": ".agents/skills",
            "ancestors": true
          }
        ]
      },
      "experimental_resolvesNativeRoots": true
    },
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
    id: "acp-omp",
    ...{
      "experimental_nativeSkillRoots": {
        "user": [
          {
            "path": ".agent/skills"
          },
          {
            "path": ".agents/skills"
          },
          {
            "path": ".claude/skills",
            "skipIfManifest": ".claude-plugin/plugin.json"
          }
        ],
        "project": [
          {
            "path": ".omp/skills",
            "ancestors": true
          },
          {
            "path": ".pi/skills",
            "ancestors": true
          },
          {
            "path": ".agent/skills",
            "ancestors": true
          },
          {
            "path": ".agents/skills",
            "ancestors": true
          },
          {
            "path": ".claude/skills",
            "skipIfManifest": ".claude-plugin/plugin.json",
            "ancestors": true
          },
          {
            "path": ".codex/skills",
            "ancestors": true
          },
          {
            "path": ".opencode/skills",
            "ancestors": true
          }
        ]
      },
      "experimental_resolvesNativeRoots": true
    },
    displayName: 'OMP',
    icon: './icons/omp.svg',
    visibility: 'installed',
    capabilities: extraCapabilities,
    composerActions: []
  });
  zcc.agents.experimental_registerProvider({
    id: "acp-grok",
    ...{
      "experimental_nativeSkillRoots": {
        "user": [
          {
            "path": ".agents/skills",
            "recursive": true
          }
        ],
        "project": [
          {
            "path": ".grok/skills",
            "recursive": true,
            "ancestors": true
          },
          {
            "path": ".agents/skills",
            "recursive": true,
            "ancestors": true
          }
        ]
      },
      "experimental_resolvesNativeRoots": true
    },
    displayName: 'Grok Build',
    icon: './icons/grok.svg',
    visibility: 'installed',
    capabilities: extraCapabilities,
    composerActions: []
  });
  zcc.agents.experimental_registerProvider({
    id: "acp-mastracode",
    ...{
      "experimental_nativeSkillRoots": {
        "user": [
          {
            "path": ".agents/skills",
            "recursive": true
          }
        ],
        "project": [
          {
            "path": ".agents/skills",
            "recursive": true,
            "ancestors": true
          }
        ]
      }
    },
    displayName: 'Mastra Code',
    icon: './icons/mastracode.svg',
    visibility: 'installed',
    capabilities: extraCapabilities,
    composerActions: []
  });
  zcc.agents.experimental_registerProvider({
    id: "acp-hermes-agent",
    ...{
      "experimental_resolvesNativeRoots": true
    },
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
    customHandles = agents.map((agent) => {
      const acpLaunchSpec = {
        displayName: agent.displayName,
        command: agent.command,
        args: agent.args,
        env: agent.env,
        ...(agent.cwd === undefined ? {} : { cwd: agent.cwd })
      };
      return zcc.agents.experimental_registerProvider({
        id: agent.id,
        displayName: agent.displayName,
        visibility: 'installed',
        experimental_bridgeOptions: { acpLaunchSpec },
        capabilities: extraCapabilities,
        composerActions: [],
        deriveProviderOptions() {
          return {
            acpLaunchSpec
          };
        }
      });
    });
  };
  void settings.get().then((values) => applyCustom(values.customAgents));
  settings.onChange((values) => applyCustom(values.customAgents));
}
