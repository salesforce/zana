import { z } from 'zod';
import { ProjectIdSchema, SessionIdSchema } from '@zana-ai/zcc-domain';
import { TerminalRequestCommandSchema, TerminalHostEventSchema } from './terminal-execution.js';
import { ProjectSettingsPatchSchema } from './project-settings.js';

/**
 * Bump when any desktop-to-server utility-process message changes shape or
 * meaning. Both endpoints reject a mismatched version before dispatching it.
 */
export const SERVER_RUNTIME_PROTOCOL_VERSION = 1;
const ServerRuntimeProtocolVersionSchema = z.literal(SERVER_RUNTIME_PROTOCOL_VERSION);
const RequestIdSchema = z.string().uuid();
const DeadlineSchema = z.string().datetime();
const ProjectPathSchema = z.string().min(1).max(32_768);
const ProjectNameSchema = z.string().min(1).max(256).refine(
  (value) => !/[\x00-\x1f\x7f]/.test(value),
  'project name must not contain control characters'
);
const ProjectColorSchema = z.enum([
  '#2f81f7', '#3fb950', '#d4a017', '#bc8cff', '#39c5cf', '#f85149', '#ff7b72', '#8b949e'
]);
const PluginIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128);

export const ProjectMutationPatchSchema = z.object({
  name: ProjectNameSchema.optional(),
  color: ProjectColorSchema.optional(),
  category: z.literal('Extensions').optional()
}).strict().refine((patch) => Object.keys(patch).length > 0, 'project patch must not be empty');

export const ProjectRecordSchema = z.object({
  id: ProjectIdSchema,
  name: ProjectNameSchema,
  path: ProjectPathSchema,
  color: ProjectColorSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative(),
  tag: z.string().min(1).max(33).optional(),
  category: z.literal('Extensions').optional()
}).passthrough();

export const ServerRuntimeStartSchema = z.object({
  type: z.literal('start'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  rendererRoot: z.string().min(1),
  dataDir: z.string().min(1),
  hostUrl: z.string().url(),
  hostToken: z.string().min(32),
  hostSigningKey: z.string().min(32),
  hostBinding: z.object({
    hostId: z.string().uuid(),
    instanceId: z.string().uuid()
  }).strict(),
  bundledPluginsRoot: z.string().min(1).optional(),
  version: z.string()
}).strict();

const ServerRuntimeRequestBaseSchema = z.object({
  type: z.literal('request'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  id: RequestIdSchema,
  deadlineAt: DeadlineSchema
}).strict();

export const ServerRuntimeRequestSchema = z.discriminatedUnion('operation', [
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('app-version') }).strict(),
  ServerRuntimeRequestBaseSchema.extend({ operation: z.literal('projects-list') }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-add'),
    path: ProjectPathSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-update'),
    projectId: ProjectIdSchema,
    patch: ProjectMutationPatchSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-reorder'),
    orderedIds: z.array(ProjectIdSchema).max(10_000)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-touch'),
    projectId: ProjectIdSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('projects-remove'),
    projectId: ProjectIdSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('project-settings-get'),
    projectId: ProjectIdSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('project-settings-set'),
    projectId: ProjectIdSchema,
    patch: ProjectSettingsPatchSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('terminal-execute'),
    command: TerminalRequestCommandSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('terminal-record'),
    event: TerminalHostEventSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('terminal-events-since'),
    sessionId: SessionIdSchema,
    afterSequence: z.number().int().min(-1).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-list')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-install'),
    source: z.string().min(1).max(4096)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-enable'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-disable'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-remove'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-reload'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-logs'),
    pluginId: z.string().min(1).max(128),
    n: z.number().int().min(1).max(10_000).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-snapshot')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-search'),
    query: z.string().max(256).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-outdated')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-update'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-call-rpc'),
    pluginId: z.string().min(1).max(128),
    method: z.string().min(1).max(128),
    args: z.unknown().optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-settings-get'),
    pluginId: z.string().min(1).max(128)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-settings-set'),
    pluginId: z.string().min(1).max(128),
    values: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-cli-contributions')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('plugins-cli-run'),
    pluginId: z.string().min(1).max(128),
    argv: z.array(z.string().max(16_384)).max(256).optional()
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('marketplace-list')
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('marketplace-add'),
    url: z.string().min(1).max(4096)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('marketplace-refresh'),
    url: z.string().min(1).max(4096)
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('marketplace-remove'),
    url: z.string().min(1).max(4096)
  }).strict()
]);

export const RuntimeStopSchema = z.object({
  type: z.literal('stop'),
  protocolVersion: ServerRuntimeProtocolVersionSchema
}).strict();

export const ServerRuntimeInboundSchema = z.discriminatedUnion('type', [
  ServerRuntimeStartSchema,
  ServerRuntimeRequestSchema,
  RuntimeStopSchema
]);

export const RuntimeReadySchema = z.object({
  type: z.literal('ready'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  url: z.string().url()
}).strict();
export const RuntimeResultSchema = z.object({
  type: z.literal('result'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  id: RequestIdSchema,
  value: z.unknown()
}).strict();
export const RuntimeErrorSchema = z.object({
  type: z.literal('error'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  message: z.string().min(1),
  id: RequestIdSchema.optional()
}).strict();
export const RuntimeStoppedSchema = z.object({
  type: z.literal('stopped'),
  protocolVersion: ServerRuntimeProtocolVersionSchema
}).strict();
export const HostTerminalEventMessageSchema = z.object({
  type: z.literal('terminal-event'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  event: TerminalHostEventSchema
}).strict();
export const ProjectSettingsChangedMessageSchema = z.object({
  type: z.literal('project-settings-changed'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  projectId: ProjectIdSchema
}).strict();

const PluginCapabilityMcpServerSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.string().min(1).max(32),
  command: z.string().max(256).optional(),
  args: z.array(z.string().max(4096)).max(32).optional(),
  url: z.string().max(4096).optional(),
  env: z.record(z.string().max(256), z.string().max(4096)).optional(),
  alwaysOn: z.boolean().optional()
}).strict();

export const PluginAgentContributionSchema = z.object({
  id: z.string().min(1).max(128),
  enabled: z.boolean(),
  rootDir: z.string().min(1).max(32_768),
  skillsRootPaths: z.array(z.string().max(1024)).max(20),
  skillNames: z.array(z.string().max(64)).max(20),
  mcpServers: z.array(PluginCapabilityMcpServerSchema).max(32),
  extra: z.record(z.string(), z.unknown()).optional()
}).strict();

export const PluginCapabilitiesChangedMessageSchema = z.object({
  type: z.literal('plugin-capabilities'),
  contributors: z.array(PluginAgentContributionSchema).max(256)
}).strict();

const PluginAppProjectTabSchema = z.object({
  label: z.string().min(1).max(256).optional(),
  icon: z.string().min(1).max(256).optional(),
  order: z.number().int().optional(),
  global: z.boolean().optional()
}).strict();

export const PluginAppSnapshotSchema = z.object({
  id: PluginIdSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(4096),
  icon: z.string().min(1).max(256),
  enabled: z.boolean(),
  provenance: z.enum(['builtin', 'direct', 'catalog']),
  status: z.enum(['running', 'disabled', 'degraded', 'needs-configuration']),
  appUrl: z.string().max(4096).nullable(),
  projectTab: PluginAppProjectTabSchema.optional()
}).strict();

export const PluginAppsChangedMessageSchema = z.object({
  type: z.literal('plugin-apps-changed'),
  protocolVersion: ServerRuntimeProtocolVersionSchema,
  apps: z.array(PluginAppSnapshotSchema).max(256)
}).strict();

export const RuntimeOutboundSchema = z.discriminatedUnion('type', [
  RuntimeReadySchema,
  RuntimeResultSchema,
  RuntimeErrorSchema,
  RuntimeStoppedSchema,
  HostTerminalEventMessageSchema,
  ProjectSettingsChangedMessageSchema,
  PluginCapabilitiesChangedMessageSchema,
  PluginAppsChangedMessageSchema
]);

export type ServerRuntimeInbound = z.infer<typeof ServerRuntimeInboundSchema>;
export type RuntimeOutbound = z.infer<typeof RuntimeOutboundSchema>;
