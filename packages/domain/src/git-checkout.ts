import { z } from 'zod';

const gitBranchForbiddenCharacterPattern = /[\u0000-\u001f\u007f\\:~^?*\[]/u;
const gitBranchWhitespacePattern = /[ \t]/u;
const gitReservedBranchNames = new Set([
  'AUTO_MERGE',
  'BISECT_HEAD',
  'CHERRY_PICK_HEAD',
  'FETCH_HEAD',
  'HEAD',
  'MERGE_HEAD',
  'ORIG_HEAD',
  'REVERT_HEAD'
]);

export function isValidGitBranchName(name: string): boolean {
  const components = name.split('/');
  return (
    name.length > 0 &&
    name.trim().length === name.length &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    name !== '@' &&
    !gitReservedBranchNames.has(name) &&
    !gitBranchForbiddenCharacterPattern.test(name) &&
    !gitBranchWhitespacePattern.test(name) &&
    !name.includes('..') &&
    !name.includes('@{') &&
    !name.includes('//') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    components.every(
      (component) =>
        component.length > 0 &&
        !component.startsWith('.') &&
        !component.endsWith('.lock')
    )
  );
}

export const gitBranchNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(isValidGitBranchName, { message: 'Invalid git branch name' });
export type GitBranchName = z.infer<typeof gitBranchNameSchema>;

export const gitCheckoutRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('branch'),
    branchName: z.string().min(1),
    headSha: z.string().min(1).nullable()
  }).strict(),
  z.object({
    kind: z.literal('detached'),
    headSha: z.string().min(1).nullable()
  }).strict(),
  z.object({
    kind: z.literal('unborn'),
    branchName: z.string().min(1).nullable()
  }).strict(),
  z.object({
    kind: z.literal('unknown'),
    reason: z.string().min(1)
  }).strict()
]);
export type GitCheckoutRef = z.infer<typeof gitCheckoutRefSchema>;

export const workspaceGitOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('merge'), hasConflicts: z.boolean() }).strict(),
  z.object({ kind: z.literal('rebase'), hasConflicts: z.boolean() }).strict(),
  z.object({ kind: z.literal('cherry-pick'), hasConflicts: z.boolean() }).strict(),
  z.object({ kind: z.literal('revert'), hasConflicts: z.boolean() }).strict(),
  z.object({
    kind: z.literal('unknown'),
    reason: z.string().min(1),
    hasConflicts: z.boolean()
  }).strict()
]);
export type WorkspaceGitOperation = z.infer<typeof workspaceGitOperationSchema>;

export const defaultBranchRelationSchema = z.enum([
  'equal',
  'local-behind',
  'local-ahead',
  'diverged',
  'unknown'
]);
export type DefaultBranchRelation = z.infer<typeof defaultBranchRelationSchema>;
