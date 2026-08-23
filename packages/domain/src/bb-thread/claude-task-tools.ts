import { z } from "zod";

export const claudeTaskToolNameValues = [
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
] as const;
export const claudeTaskToolNameSchema = z.enum(claudeTaskToolNameValues);
export type ClaudeTaskToolName = z.infer<typeof claudeTaskToolNameSchema>;

export const claudeTaskStatusValues = [
  "pending",
  "in_progress",
  "completed",
] as const;
export const claudeTaskStatusSchema = z.enum(claudeTaskStatusValues);
export type ClaudeTaskStatus = z.infer<typeof claudeTaskStatusSchema>;

export const claudeTaskUpdateStatusValues = [
  ...claudeTaskStatusValues,
  "deleted",
] as const;
export const claudeTaskUpdateStatusSchema = z.enum(
  claudeTaskUpdateStatusValues,
);
export type ClaudeTaskUpdateStatus = z.infer<
  typeof claudeTaskUpdateStatusSchema
>;

export const claudeTaskListStatusValues = [
  ...claudeTaskStatusValues,
  "deleted",
] as const;
export const claudeTaskListStatusSchema = z.enum(claudeTaskListStatusValues);
export type ClaudeTaskListStatus = z.infer<
  typeof claudeTaskListStatusSchema
>;

export const claudeTaskCreateArgsSchema = z
  .object({
    activeForm: z.string().optional(),
    subject: z.string(),
  })
  .passthrough();
export type ClaudeTaskCreateArgs = z.infer<
  typeof claudeTaskCreateArgsSchema
>;

export const claudeTaskGetArgsSchema = z
  .object({
    taskId: z.string(),
  })
  .passthrough();
export type ClaudeTaskGetArgs = z.infer<typeof claudeTaskGetArgsSchema>;

export const claudeTaskUpdateArgsSchema = z
  .object({
    activeForm: z.string().optional(),
    status: claudeTaskUpdateStatusSchema.optional(),
    subject: z.string().optional(),
    taskId: z.string(),
  })
  .passthrough();
export type ClaudeTaskUpdateArgs = z.infer<
  typeof claudeTaskUpdateArgsSchema
>;

export const claudeTaskCreateOutputSchema = z
  .object({
    task: z
      .object({
        id: z.string(),
        subject: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
export type ClaudeTaskCreateOutput = z.infer<
  typeof claudeTaskCreateOutputSchema
>;

export const claudeTaskGetOutputTaskSchema = z
  .object({
    id: z.string(),
    status: claudeTaskStatusSchema,
    subject: z.string(),
  })
  .passthrough();
export type ClaudeTaskGetOutputTask = z.infer<
  typeof claudeTaskGetOutputTaskSchema
>;

export const claudeTaskGetOutputSchema = z
  .object({
    task: claudeTaskGetOutputTaskSchema.nullable(),
  })
  .passthrough();
export type ClaudeTaskGetOutput = z.infer<typeof claudeTaskGetOutputSchema>;

export const claudeTaskUpdateOutputSchema = z
  .object({
    success: z.boolean(),
    taskId: z.string(),
  })
  .passthrough();
export type ClaudeTaskUpdateOutput = z.infer<
  typeof claudeTaskUpdateOutputSchema
>;

export const claudeTaskListItemSchema = z
  .object({
    id: z.string(),
    status: claudeTaskListStatusSchema,
    subject: z.string(),
  })
  .passthrough();
export type ClaudeTaskListItem = z.infer<typeof claudeTaskListItemSchema>;

export const claudeTaskListOutputSchema = z
  .object({
    tasks: z.array(z.unknown()),
  })
  .passthrough();
export type ClaudeTaskListOutput = z.infer<typeof claudeTaskListOutputSchema>;

export const claudeTaskToolOutputSchema = z.union([
  claudeTaskCreateOutputSchema,
  claudeTaskGetOutputSchema,
  claudeTaskListOutputSchema,
  claudeTaskUpdateOutputSchema,
]);
export type ClaudeTaskToolOutput = z.infer<typeof claudeTaskToolOutputSchema>;
