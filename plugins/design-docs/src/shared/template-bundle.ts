import { z } from 'zod';
import { MAX_FILES_PER_DOC } from './limits.js';

export const templateInputSchema = z.object({
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  entryPath: z.string(),
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
    encoding: z.enum(['utf8', 'base64']).optional()
  })).min(1).max(MAX_FILES_PER_DOC)
});

export type TemplateInput = z.infer<typeof templateInputSchema>;

export const templateBundleSchema = z.object({
  kind: z.literal('zcc-design-doc-templates'),
  version: z.literal(1),
  templates: z.array(templateInputSchema).max(1000)
}).superRefine((bundle, ctx) => {
  const keys = new Set<string>();
  for (const template of bundle.templates) {
    if (keys.has(template.key)) ctx.addIssue({ code: 'custom', message: `duplicate template key ${template.key}` });
    keys.add(template.key);
  }
});
