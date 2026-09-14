import { z } from "zod";

export const workspaceProcessRowSchema = z
  .object({
    pid: z.number().int().positive(),
    cwd: z.string().min(1),
    command: z.string().max(200),
  })
  .strict();
export type WorkspaceProcessRow = z.infer<typeof workspaceProcessRowSchema>;

export const workspaceProcessesListResponseSchema = z
  .object({
    processes: z.array(workspaceProcessRowSchema),
    truncated: z.boolean(),
    supported: z.boolean(),
  })
  .strict();
export type WorkspaceProcessesListResponse = z.infer<
  typeof workspaceProcessesListResponseSchema
>;

export const workspaceProcessesKillRequestSchema = z
  .object({
    pids: z.array(z.number().int().positive()).min(1).max(200),
  })
  .strict();
export type WorkspaceProcessesKillRequest = z.infer<
  typeof workspaceProcessesKillRequestSchema
>;

export const workspaceProcessesKillResponseSchema = z
  .object({
    killed: z.array(workspaceProcessRowSchema),
  })
  .strict();
export type WorkspaceProcessesKillResponse = z.infer<
  typeof workspaceProcessesKillResponseSchema
>;
