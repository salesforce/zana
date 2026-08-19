import { z } from 'zod';
import { TerminalHostCommandSchema, TerminalHostEventSchema } from './terminal-execution.js';

const RequestIdSchema = z.string().uuid();
const DeadlineSchema = z.string().datetime();

export const ServerRuntimeStartSchema = z.object({
  type: z.literal('start'),
  rendererRoot: z.string().min(1),
  dataDir: z.string().min(1),
  hostUrl: z.string().url(),
  hostToken: z.string().min(32),
  hostSigningKey: z.string().min(32),
  version: z.string()
}).strict();

export const ServerRuntimeRequestSchema = z.object({
  type: z.literal('request'),
  id: RequestIdSchema,
  operation: z.enum(['app-version', 'projects-list', 'terminal-execute']),
  deadlineAt: DeadlineSchema,
  command: TerminalHostCommandSchema.optional()
}).strict();

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
