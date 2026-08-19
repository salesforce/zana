import { z } from 'zod';
import { ProjectIdSchema } from '@zana-ai/zcc-domain';
import { TerminalHostCommandSchema, TerminalHostEventSchema } from './terminal-execution.js';

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
  rendererRoot: z.string().min(1),
  dataDir: z.string().min(1),
  hostUrl: z.string().url(),
  hostToken: z.string().min(32),
  hostSigningKey: z.string().min(32),
  version: z.string()
}).strict();

const ServerRuntimeRequestBaseSchema = z.object({
  type: z.literal('request'),
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
    operation: z.literal('terminal-execute'),
    command: TerminalHostCommandSchema
  }).strict(),
  ServerRuntimeRequestBaseSchema.extend({
    operation: z.literal('terminal-record'),
    event: TerminalHostEventSchema
  }).strict()
]);

export const RuntimeStopSchema = z.object({ type: z.literal('stop') }).strict();

export const ServerRuntimeInboundSchema = z.discriminatedUnion('type', [
  ServerRuntimeStartSchema,
  ServerRuntimeRequestSchema,
  RuntimeStopSchema
]);

export const RuntimeReadySchema = z.object({ type: z.literal('ready'), url: z.string().url() }).strict();
export const RuntimeResultSchema = z.object({
  type: z.literal('result'),
  id: RequestIdSchema,
  value: z.unknown()
}).strict();
export const RuntimeErrorSchema = z.object({
  type: z.literal('error'),
  message: z.string().min(1),
  id: RequestIdSchema.optional()
}).strict();
export const RuntimeStoppedSchema = z.object({ type: z.literal('stopped') }).strict();
export const HostTerminalEventMessageSchema = z.object({
  type: z.literal('terminal-event'),
  event: TerminalHostEventSchema
}).strict();

export const RuntimeOutboundSchema = z.discriminatedUnion('type', [
  RuntimeReadySchema,
  RuntimeResultSchema,
  RuntimeErrorSchema,
  RuntimeStoppedSchema,
  HostTerminalEventMessageSchema
]);

export type ServerRuntimeInbound = z.infer<typeof ServerRuntimeInboundSchema>;
export type RuntimeOutbound = z.infer<typeof RuntimeOutboundSchema>;
