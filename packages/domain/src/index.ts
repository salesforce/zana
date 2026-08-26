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

export type * from './harness.js';
export * from './project.js';
export * from './inbox.js';
export type * from './library.js';
export type * from './agent.js';
export type * from './session.js';
export * from './config.js';
export type * from './settings.js';
export type * from './fs.js';
export type * from './schedule.js';
export type * from './llm.js';
export { titleFromPrompt } from './prompt-title.js';
export type * from './voice.js';
export * from './persona.js';
export type * from './goal.js';
export * from './follow-up.js';
export type * from './feed.js';
export type * from './skills.js';
export type * from './mcp.js';
export type * from './updates.js';
export * from './parse-cron.js';
export * from './parse-every.js';
export * from './schedule-spec.js';
export * from './path-encoding.js';
export * from './project-colors.js';
export * from './terminal-themes.js';
export * from './workflow-args.js';
export * from './authorizations.js';
export * from './telemetry-events.js';
export * from './harness-adapter.js';
export * from './launch-provider.js';
export * from './launch-sanitize.js';
export * from './git-checkout.js';
export * from './workspace-diff.js';
export * from './environment.js';
