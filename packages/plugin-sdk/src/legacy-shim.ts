/**
 * One-release compatibility: an already-installed `extension.json` dir can be
 * projected into the `package.json` `zcc` shape so PluginService can load it.
 */

export interface LegacyExtensionJson {
  id?: string;
  version?: string;
  title?: string;
  icon?: string;
  titleLabel?: string;
  entry?: { renderer?: string; main?: string };
  projectTab?: {
    label?: string;
    icon?: string;
    order?: number;
    global?: boolean;
  };
  skills?: Array<{ path?: string; slug?: string }>;
  mcpServers?: Array<{
    name?: string;
    type?: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    alwaysOn?: boolean;
  }>;
}

function dirnameOf(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash <= 0 ? '' : normalized.slice(0, slash);
}

function skillRootFromPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/\/SKILL\.md$/i.test(normalized)) {
    const skillDir = dirnameOf(normalized);
    return dirnameOf(skillDir) || skillDir;
  }
  return dirnameOf(normalized);
}

export function shimLegacyExtensionManifest(
  manifest: LegacyExtensionJson,
  dirName: string
): {
  name: string;
  version: string;
  engines: { zcc: string; zccPluginSdk: string };
  zcc: {
    name: string;
    description: string;
    branding: { icon: string };
    server?: string;
    app?: string;
    projectTab?: LegacyExtensionJson['projectTab'];
    skills?: string[];
    mcpServers?: Record<
      string,
      {
        type: 'stdio' | 'streamable-http' | 'sse';
        command?: string;
        args?: string[];
        url?: string;
        env?: Record<string, string>;
        alwaysOn?: boolean;
      }
    >;
  };
} {
  const id = (manifest.id ?? dirName).trim();
  if (!id) throw new Error('legacy extension.json is missing id');
  const title = manifest.title?.trim() || id;
  const server = manifest.entry?.main;
  const app = manifest.entry?.renderer;
  if (!server && !app) throw new Error(`legacy extension "${id}" has no entry.main or entry.renderer`);
  const skillRoots = [
    ...new Set(
      (manifest.skills ?? [])
        .map((skill) => skillRootFromPath(skill.path ?? ''))
        .filter((root) => root.length > 0)
    )
  ];
  const mcpServers: NonNullable<ReturnType<typeof shimLegacyExtensionManifest>['zcc']['mcpServers']> = {};
  for (const serverDef of manifest.mcpServers ?? []) {
    const name = serverDef.name?.trim();
    const type = serverDef.type;
    if (!name || (type !== 'stdio' && type !== 'streamable-http' && type !== 'sse')) continue;
    mcpServers[name] = {
      type,
      ...(serverDef.command ? { command: serverDef.command } : {}),
      ...(serverDef.args ? { args: serverDef.args } : {}),
      ...(serverDef.url ? { url: serverDef.url } : {}),
      ...(serverDef.env ? { env: serverDef.env } : {}),
      ...(serverDef.alwaysOn ? { alwaysOn: true } : {})
    };
  }
  return {
    name: `zcc-plugin-${id}`,
    version: manifest.version?.trim() || '0.0.0',
    engines: { zcc: '>=0.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: {
      name: title,
      description: manifest.titleLabel?.trim() || title,
      branding: { icon: manifest.icon?.trim() || 'Puzzle' },
      ...(server ? { server } : {}),
      ...(app ? { app } : {}),
      ...(manifest.projectTab ? { projectTab: manifest.projectTab } : {}),
      ...(skillRoots.length ? { skills: skillRoots } : { skills: [] }),
      ...(Object.keys(mcpServers).length ? { mcpServers } : {})
    }
  };
}
