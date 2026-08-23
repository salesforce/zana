import { z } from 'zod';
import { derivePluginId, isPluginId } from './plugin-id.js';

const requiredManifestString = z.string().trim().min(1).max(256);

export const DEFAULT_PLUGIN_SKILLS_ROOT = 'skills';
export const PLUGIN_EXTRA_MAX_KEYS = 32;
export const PLUGIN_EXTRA_MAX_BYTES = 8 * 1024;
export const PLUGIN_MCP_SERVER_NAME = /^[a-z0-9][a-z0-9-]*$/;
export const PLUGIN_EXTRA_KEY = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export const pluginBrandingSchema = z
  .object({
    icon: requiredManifestString.optional(),
    logo: z
      .object({
        light: requiredManifestString,
        dark: requiredManifestString.optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .refine((branding) => branding.icon !== undefined || branding.logo !== undefined, {
    message: 'must declare at least branding.icon or branding.logo.light'
  });

export const pluginProjectTabSchema = z
  .object({
    label: requiredManifestString.optional(),
    icon: requiredManifestString.optional(),
    order: z.number().int().optional(),
    global: z.boolean().optional()
  })
  .strict();

export function isExecutableBasename(command: string): boolean {
  return (
    command.length > 0 &&
    command.length <= 256 &&
    !command.includes('/') &&
    !command.includes('\\') &&
    command !== '.' &&
    command !== '..'
  );
}

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

export const pluginExtraSchema = z
  .record(z.string(), jsonValueSchema)
  .superRefine((value, ctx) => {
    const keys = Object.keys(value);
    if (keys.length > PLUGIN_EXTRA_MAX_KEYS) {
      ctx.addIssue({
        code: 'custom',
        message: `extra has at most ${PLUGIN_EXTRA_MAX_KEYS} keys`
      });
    }
    for (const key of keys) {
      if (key.length > 64 || !PLUGIN_EXTRA_KEY.test(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'extra keys must match /^[a-zA-Z][a-zA-Z0-9_-]*$/ and be ≤64 chars'
        });
      }
    }
    let serialized = '';
    try {
      serialized = JSON.stringify(value) ?? '';
    } catch {
      ctx.addIssue({ code: 'custom', message: 'extra must be JSON-serializable' });
      return;
    }
    if (new TextEncoder().encode(serialized).length > PLUGIN_EXTRA_MAX_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `extra must be ≤ ${PLUGIN_EXTRA_MAX_BYTES} bytes`
      });
    }
  });

export const pluginMcpServerSchema = z
  .object({
    type: z.enum(['stdio', 'streamable-http', 'sse']),
    command: z.string().min(1).max(256).optional(),
    args: z.array(z.string().max(4096)).max(32).optional(),
    url: z.string().url().max(4096).optional(),
    env: z.record(z.string().min(1).max(256), z.string().max(4096)).optional(),
    alwaysOn: z.boolean().optional()
  })
  .strict()
  .superRefine((server, ctx) => {
    if (server.type === 'stdio') {
      if (!server.command) {
        ctx.addIssue({ code: 'custom', message: 'stdio mcp server requires command', path: ['command'] });
      } else if (!isExecutableBasename(server.command)) {
        ctx.addIssue({
          code: 'custom',
          message: 'command must be a basename (no path or shell string)',
          path: ['command']
        });
      }
    } else if (!server.url) {
      ctx.addIssue({ code: 'custom', message: 'non-stdio mcp server requires url', path: ['url'] });
    }
  });

export const pluginMcpServersSchema = z
  .record(z.string(), pluginMcpServerSchema)
  .superRefine((servers, ctx) => {
    for (const name of Object.keys(servers)) {
      if (name.length > 64 || !PLUGIN_MCP_SERVER_NAME.test(name)) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'mcp server name must match /^[a-z0-9][a-z0-9-]*$/ and be ≤64 chars'
        });
      }
    }
  });

export const pluginZccManifestSchema = z
  .object({
    name: requiredManifestString,
    description: requiredManifestString,
    branding: pluginBrandingSchema,
    server: requiredManifestString.optional(),
    app: requiredManifestString.optional(),
    host: requiredManifestString.optional(),
    skills: z.array(requiredManifestString).optional(),
    mcpServers: pluginMcpServersSchema.optional(),
    extra: pluginExtraSchema.optional(),
    projectTab: pluginProjectTabSchema.optional()
  })
  .strict()
  .refine((block) => block.server !== undefined || block.app !== undefined, {
    message: 'must declare at least zcc.server or zcc.app'
  });

export const pluginPackageJsonSchema = z
  .object({
    name: requiredManifestString,
    version: requiredManifestString,
    engines: z
      .object({
        zcc: requiredManifestString.optional(),
        zccPluginSdk: requiredManifestString.optional()
      })
      .optional(),
    zcc: pluginZccManifestSchema
  })
  .passthrough();

export type PluginPackageJson = z.infer<typeof pluginPackageJsonSchema>;
export type PluginZccManifest = z.infer<typeof pluginZccManifestSchema>;
export type PluginMcpServerContribution = z.infer<typeof pluginMcpServerSchema> & { name: string };
export type PluginExtra = Record<string, unknown>;

/**
 * BB rule: omitted `skills` defaults to `["skills"]`; an empty array opts out.
 * A trailing `/*` is stripped and ignored.
 */
export function normalizeSkillsRootPaths(skills: string[] | undefined): string[] {
  if (skills === undefined) return [DEFAULT_PLUGIN_SKILLS_ROOT];
  return skills.map((entry) => entry.replace(/\/\*$/, '').trim()).filter((entry) => entry.length > 0);
}

export interface PluginManifest {
  id: string;
  packageName: string;
  version: string;
  name: string;
  description: string;
  branding: PluginZccManifest['branding'];
  serverEntry: string | null;
  appEntry: string | null;
  hostEntry: string | null;
  skillsRootPaths: string[];
  skillNames: string[];
  mcpServers: PluginMcpServerContribution[];
  extra: PluginExtra;
  projectTab: PluginZccManifest['projectTab'];
  engines: { zcc?: string; zccPluginSdk?: string };
}

export function readPluginManifest(packageJson: unknown): PluginManifest {
  const parsed = pluginPackageJsonSchema.parse(packageJson);
  const id = derivePluginId(parsed.name);
  if (!isPluginId(id)) {
    throw new Error(`derived plugin id "${id}" is reserved or invalid`);
  }
  const mcpServers: PluginMcpServerContribution[] = Object.entries(parsed.zcc.mcpServers ?? {}).map(
    ([name, server]) => ({ name, ...server })
  );
  return {
    id,
    packageName: parsed.name,
    version: parsed.version,
    name: parsed.zcc.name,
    description: parsed.zcc.description,
    branding: parsed.zcc.branding,
    serverEntry: parsed.zcc.server ?? null,
    appEntry: parsed.zcc.app ?? null,
    hostEntry: parsed.zcc.host ?? null,
    skillsRootPaths: normalizeSkillsRootPaths(parsed.zcc.skills),
    skillNames: [],
    mcpServers,
    extra: parsed.zcc.extra ?? {},
    projectTab: parsed.zcc.projectTab,
    engines: {
      zcc: parsed.engines?.zcc,
      zccPluginSdk: parsed.engines?.zccPluginSdk
    }
  };
}
