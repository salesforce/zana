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
