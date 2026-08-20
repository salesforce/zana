import { z } from 'zod';
import { CommandIdSchema, ProjectIdSchema, SessionIdSchema } from '@zana-ai/zcc-domain';

/**
 * Bump when any server-to-host terminal command or host event changes shape or
 * meaning. The host rejects incompatible commands before touching a PTY.
 */
export const TERMINAL_HOST_PROTOCOL_VERSION = 1;
const TerminalHostProtocolVersionSchema = z.literal(TERMINAL_HOST_PROTOCOL_VERSION);
const DeadlineSchema = z.string().datetime();
const LaunchEpochSchema = z.number().int().nonnegative();
const TerminalModeSchema = z.enum(['local-pty', 'remote-ssh', 'execution-environment']);

/**
 * A stable host installation, one daemon lifetime, and one server-issued lease
 * are distinct identities. Binding every terminal message prevents a delayed
 * event from a replaced daemon from mutating the current terminal session.
 */
export const TerminalHostBindingSchema = z.object({
  hostId: z.string().uuid(),
  instanceId: z.string().uuid(),
  hostConnectionId: z.string().uuid()
}).strict();
export type TerminalHostBinding = z.infer<typeof TerminalHostBindingSchema>;

export const HOST_CONNECTION_PROTOCOL_VERSION = 1;
const HostConnectionProtocolVersionSchema = z.literal(HOST_CONNECTION_PROTOCOL_VERSION);

export const HostConnectionHelloSchema = z.object({
  protocolVersion: HostConnectionProtocolVersionSchema,
  binding: TerminalHostBindingSchema,
  deadlineAt: DeadlineSchema
}).strict();
export type HostConnectionHello = z.infer<typeof HostConnectionHelloSchema>;

export const SignedHostConnectionHelloSchema = z.object({
  hello: HostConnectionHelloSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type SignedHostConnectionHello = z.infer<typeof SignedHostConnectionHelloSchema>;

export const HostConnectionAckSchema = z.object({
  protocolVersion: HostConnectionProtocolVersionSchema,
  binding: TerminalHostBindingSchema,
  leaseExpiresAt: z.number().int().positive()
}).strict();
export type HostConnectionAck = z.infer<typeof HostConnectionAckSchema>;

const TerminalRequestBaseSchema = z.object({
  protocolVersion: TerminalHostProtocolVersionSchema,
  commandId: CommandIdSchema,
  sessionId: SessionIdSchema,
  launchEpoch: LaunchEpochSchema,
  deadlineAt: DeadlineSchema
}).strict();

const TerminalRequestStartCommandSchema = TerminalRequestBaseSchema.extend({
  kind: z.literal('start'),
  projectId: ProjectIdSchema,
  launch: z.object({
    argv: z.array(z.string()).min(1),
    cwd: z.string().min(1),
    env: z.record(z.string(), z.string()),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
    mode: TerminalModeSchema
  }).strict()
}).strict();

const TerminalRequestWriteCommandSchema = TerminalRequestBaseSchema.extend({
  kind: z.literal('write'),
  data: z.string().max(64 * 1024)
}).strict();

const TerminalRequestResizeCommandSchema = TerminalRequestBaseSchema.extend({
  kind: z.literal('resize'),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000)
}).strict();

const TerminalRequestTerminateCommandSchema = TerminalRequestBaseSchema.extend({
  kind: z.literal('terminate'),
  expected: z.boolean()
}).strict();

const TerminalRequestBacklogCommandSchema = TerminalRequestBaseSchema.extend({
  kind: z.literal('get-backlog'),
  afterSequence: z.number().int().nonnegative().optional()
}).strict();

export const TerminalRequestCommandSchema = z.discriminatedUnion('kind', [
  TerminalRequestStartCommandSchema,
  TerminalRequestWriteCommandSchema,
  TerminalRequestResizeCommandSchema,
  TerminalRequestTerminateCommandSchema,
  TerminalRequestBacklogCommandSchema
]);
export type TerminalRequestCommand = z.infer<typeof TerminalRequestCommandSchema>;

const TerminalHostCommandBaseSchema = TerminalRequestBaseSchema.extend({
  binding: TerminalHostBindingSchema
});
const TerminalStartCommandSchema = TerminalRequestStartCommandSchema.extend({ binding: TerminalHostBindingSchema });
const TerminalWriteCommandSchema = TerminalRequestWriteCommandSchema.extend({ binding: TerminalHostBindingSchema });
const TerminalResizeCommandSchema = TerminalRequestResizeCommandSchema.extend({ binding: TerminalHostBindingSchema });
const TerminalTerminateCommandSchema = TerminalRequestTerminateCommandSchema.extend({ binding: TerminalHostBindingSchema });
const TerminalBacklogCommandSchema = TerminalRequestBacklogCommandSchema.extend({ binding: TerminalHostBindingSchema });

export const TerminalHostCommandSchema = z.discriminatedUnion('kind', [
  TerminalStartCommandSchema,
  TerminalWriteCommandSchema,
  TerminalResizeCommandSchema,
  TerminalTerminateCommandSchema,
  TerminalBacklogCommandSchema
]);

export type TerminalHostCommand = z.infer<typeof TerminalHostCommandSchema>;

export const SignedTerminalHostCommandSchema = z.object({
  command: TerminalHostCommandSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export type SignedTerminalHostCommand = z.infer<typeof SignedTerminalHostCommandSchema>;

const EventBaseSchema = z.object({
  protocolVersion: TerminalHostProtocolVersionSchema,
  binding: TerminalHostBindingSchema,
  sessionId: SessionIdSchema,
  launchEpoch: LaunchEpochSchema
}).strict();

export const TerminalHostEventSchema = z.discriminatedUnion('kind', [
  EventBaseSchema.extend({
    kind: z.literal('accepted'),
    commandId: CommandIdSchema,
    hostSessionId: z.string().min(1)
  }).strict(),
  EventBaseSchema.extend({
    kind: z.literal('started'),
    pid: z.number().int().positive().optional()
  }).strict(),
  EventBaseSchema.extend({
    kind: z.literal('output'),
    sequence: z.number().int().nonnegative(),
    data: z.string().max(64 * 1024)
  }).strict(),
  EventBaseSchema.extend({
    kind: z.literal('exited'),
    sequence: z.number().int().nonnegative(),
    code: z.number().int().nullable(),
    expected: z.boolean()
  }).strict(),
  z.object({
    kind: z.literal('rejected'),
    protocolVersion: TerminalHostProtocolVersionSchema,
    binding: TerminalHostBindingSchema,
    commandId: CommandIdSchema,
    sessionId: SessionIdSchema.optional(),
    launchEpoch: LaunchEpochSchema.optional(),
    reason: z.string().min(1)
  }).strict()
]);

export type TerminalHostEvent = z.infer<typeof TerminalHostEventSchema>;
