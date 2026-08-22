import { z } from 'zod';

export const workspaceDiffTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('uncommitted') }).strict(),
  z.object({
    type: z.literal('branch_committed'),
    mergeBaseBranch: z.string().min(1)
  }).strict(),
  z.object({
    type: z.literal('all'),
    mergeBaseBranch: z.string().min(1)
  }).strict(),
  z.object({
    type: z.literal('commit'),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/iu)
  }).strict()
]);
export type WorkspaceDiffTarget = z.infer<typeof workspaceDiffTargetSchema>;

export const rawDiffFileStatSchema = z.object({
  path: z.string().min(1),
  previousPath: z.string().nullable(),
  statusLetter: z.enum(['A', 'M', 'D', 'R', 'C', 'T']),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  origin: z.enum(['tracked', 'untracked'])
}).strict();
export type RawDiffFileStat = z.infer<typeof rawDiffFileStatSchema>;

export const workspaceDiffResponseSchema = z.object({
  diff: z.string(),
  truncated: z.boolean(),
  shortstat: z.string(),
  files: z.string(),
  mergeBaseRef: z.string().nullable()
}).strict();
export type WorkspaceDiffResponse = z.infer<typeof workspaceDiffResponseSchema>;

export const workspaceFileStatusSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['untracked', 'added', 'modified', 'deleted', 'renamed', 'copied', 'typechange']),
  staged: z.boolean(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable()
}).strict();
export type WorkspaceFileStatus = z.infer<typeof workspaceFileStatusSchema>;
