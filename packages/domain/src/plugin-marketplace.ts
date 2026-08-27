import { z } from 'zod';

export const marketplaceSourceNpmSchema = z
  .object({
    package: z.string().min(1),
    range: z.string().min(1)
  })
  .strict();

export const marketplaceSourceGitSchema = z
  .object({
    url: z.string().min(1),
    subdir: z.string().min(1).optional(),
    range: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    tagPrefix: z.string().max(128).optional()
  })
  .strict();

const marketplaceIconObjectSchema = z
  .object({
    url: z.string().min(1).optional(),
    lucide: z.string().min(1).optional()
  })
  .strict();

/** Lucide name string (BB) or `{ url?, lucide? }`. */
export const marketplaceIconSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.length > 0 ? { lucide: value } : value),
  marketplaceIconObjectSchema.optional()
);

export const marketplaceEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    displayName: z.string().min(1),
    description: z.string().min(1),
    icon: marketplaceIconSchema,
    tags: z.array(z.string().min(1).max(64)).max(24).optional(),
    author: z
      .object({
        name: z.string().min(1),
        github: z.string().min(1).optional(),
        url: z.string().url().optional()
      })
      .strict(),
    source: z
      .object({
        npm: marketplaceSourceNpmSchema.optional(),
        git: marketplaceSourceGitSchema.optional()
      })
      .strict()
      .refine((source) => source.npm !== undefined || source.git !== undefined, {
        message: 'entry source must declare npm or git'
      })
  })
  .strict();

export const marketplaceIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    $schema: z.string().min(1).optional(),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    displayName: z.string().min(1),
    description: z.string().min(1).optional(),
    plugins: z.array(marketplaceEntrySchema)
  })
  .strict();

export type MarketplaceIndex = z.infer<typeof marketplaceIndexSchema>;
export type MarketplaceEntry = z.infer<typeof marketplaceEntrySchema>;

export const marketplaceCatalogRowSchema = z
  .object({
    source: z.string().min(1),
    sourceKind: z.enum(['https', 'git', 'path']),
    name: z.string().min(1),
    displayName: z.string().min(1),
    addedAt: z.number(),
    entryCount: z.number().int().nonnegative(),
    lastRefreshAt: z.number().nullable(),
    lastAttemptAt: z.number().nullable(),
    lastError: z.string().nullable(),
    official: z.boolean()
  })
  .strict();
export type MarketplaceCatalogRow = z.infer<typeof marketplaceCatalogRowSchema>;
