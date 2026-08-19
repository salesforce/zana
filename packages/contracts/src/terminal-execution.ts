import { z } from 'zod';
import { CommandIdSchema, ProjectIdSchema, SessionIdSchema } from '@zana-ai/zcc-domain';

const DeadlineSchema = z.string().datetime();
const LaunchEpochSchema = z.number().int().nonnegative();
const TerminalModeSchema = z.enum(['local-pty', 'remote-ssh', 'execution-environment']);

const CommandBaseSchema = z.object({
  commandId: CommandIdSchema,
  sessionId: SessionIdSchema,
  launchEpoch: LaunchEpochSchema,
  deadlineAt: DeadlineSchema
}).strict();

export const TerminalStartCommandSchema = CommandBaseSchema.extend({
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

export const TerminalWriteCommandSchema = CommandBaseSchema.extend({
  kind: z.literal('write'),
  data: z.string().max(64 * 1024)
}).strict();

export const TerminalResizeCommandSchema = CommandBaseSchema.extend({
  kind: z.literal('resize'),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000)
}).strict();

export const TerminalTerminateCommandSchema = CommandBaseSchema.extend({
  kind: z.literal('terminate'),
  expected: z.boolean()
}).strict();

export const TerminalBacklogCommandSchema = CommandBaseSchema.extend({
  kind: z.literal('get-backlog'),
  afterSequence: z.number().int().nonnegative().optional()
}).strict();

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
    commandId: CommandIdSchema,
    sessionId: SessionIdSchema.optional(),
    reason: z.string().min(1)
  }).strict()
]);

export type TerminalHostEvent = z.infer<typeof TerminalHostEventSchema>;
