import { z } from 'zod';

/**
 * Serializable identifiers shared across ZCC process boundaries. A caller may
 * carry an id, but only the server can resolve that id into an authorized path
 * or live resource.
 */
export const ProjectIdSchema = z.string().min(1);
export const SessionIdSchema = z.string().min(1);
export const CommandIdSchema = z.string().uuid();

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;

export const ProjectRefSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1)
}).strict();

export type ProjectRef = z.infer<typeof ProjectRefSchema>;

export {
  BUILTIN_NAV_SENTINEL,
  derivePluginId,
  isPluginId
} from './plugin-id.js';
export {
  compareVersions,
  parseVersion,
  satisfiesRange
} from './semver-range.js';
export {
  DEFAULT_PLUGIN_SKILLS_ROOT,
  PLUGIN_EXTRA_MAX_BYTES,
  PLUGIN_EXTRA_MAX_KEYS,
  isExecutableBasename,
  normalizeSkillsRootPaths,
  pluginBrandingSchema,
  pluginExtraSchema,
  pluginMcpServerSchema,
  pluginMcpServersSchema,
  pluginPackageJsonSchema,
  pluginProjectTabSchema,
  pluginZccManifestSchema,
  readPluginManifest,
  type PluginExtra,
  type PluginManifest,
  type PluginMcpServerContribution,
  type PluginPackageJson,
  type PluginZccManifest
} from './plugin-manifest.js';
export {
  DEFAULT_GIT_REF,
  isCommitSha,
  parsePluginSource,
  type ParsedGitSelector,
  type ParsedPluginSource
} from './plugin-source.js';
export {
  marketplaceIndexSchema,
  marketplaceEntrySchema,
  type MarketplaceIndex,
  type MarketplaceEntry
} from './plugin-marketplace.js';
