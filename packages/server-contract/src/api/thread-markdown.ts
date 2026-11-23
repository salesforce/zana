import { z } from 'zod';

export const threadMarkdownQuerySchema = z.object({ path: z.string().min(1).max(4096), projectId: z.string().min(1).optional() }).strict();
export const threadMarkdownWriteSchema = threadMarkdownQuerySchema.extend({
  content: z.string().max(2_000_000),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type ThreadMarkdownQuery = z.infer<typeof threadMarkdownQuerySchema>;
export type ThreadMarkdownWrite = z.infer<typeof threadMarkdownWriteSchema>;
