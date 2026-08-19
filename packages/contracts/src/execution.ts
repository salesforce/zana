import { CommandIdSchema, ProjectIdSchema, SessionIdSchema } from '@zana-ai/zcc-domain';
import { z } from 'zod';

/**
 * The server sends an already-authorized launch plan to a host daemon. Paths,
 * profile selection, and executable policy are deliberately absent: they are
 * resolved by the trusted server before this command is created.
 */
export const ExecutionCommandSchema = z.object({
  kind: z.literal('launch'),
  commandId: CommandIdSchema,
  projectId: ProjectIdSchema,
  sessionId: SessionIdSchema,
  deadlineAt: z.string().datetime(),
  launch: z.object({
    argv: z.array(z.string()),
    cwd: z.string().min(1),
    env: z.record(z.string(), z.string())
  }).strict()
}).strict();

export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;

export const ExecutionEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('accepted'),
    commandId: CommandIdSchema,
    sessionId: SessionIdSchema
  }).strict(),
  z.object({
    kind: z.literal('output'),
    commandId: CommandIdSchema,
    sessionId: SessionIdSchema,
    data: z.string(),
    sequence: z.number().int().nonnegative()
  }).strict(),
  z.object({
    kind: z.literal('exited'),
    commandId: CommandIdSchema,
    sessionId: SessionIdSchema,
    code: z.number().int().nullable()
  }).strict(),
  z.object({
    kind: z.literal('rejected'),
    commandId: CommandIdSchema,
    reason: z.string().min(1)
  }).strict()
]);

export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

/** The daemon proves possession of the per-launch secret before receiving work. */
export const HostRegistrationSchema = z.object({
  token: z.string().min(32).max(512)
}).strict();

/** A server-issued command carries an expiry and integrity proof for the host. */
export const SignedExecutionCommandSchema = z.object({
  command: ExecutionCommandSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export type SignedExecutionCommand = z.infer<typeof SignedExecutionCommandSchema>;
