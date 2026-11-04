import { z } from 'zod';

const pathValue = z.string().min(1).max(1024).refine((value) =>
  !value.includes('\0') && !value.split(/[/\\]/u).some((segment) => segment === '..'));

const hintValue = z.string().min(1).max(1024).refine((value) => !value.includes('\0'));

export const previewPathRequestSchema = z.object({
  path: pathValue,
  hints: z.array(hintValue).max(50).optional(),
  projectId: z.string().min(1).max(256).optional()
}).strict();

export const previewPathResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resolved'), path: pathValue }).strict(),
  z.object({ kind: z.literal('ambiguous'), paths: z.array(pathValue).max(50) }).strict(),
  z.object({ kind: z.literal('incomplete'), paths: z.array(pathValue).max(50) }).strict(),
  z.object({
    kind: z.literal('not_found'),
    path: pathValue,
    checkedPath: z.string().min(1).max(4096).optional()
  }).strict()
]);

export type PreviewPathRequest = z.infer<typeof previewPathRequestSchema>;
export type PreviewPathResult = z.infer<typeof previewPathResultSchema>;
