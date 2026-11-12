import { z } from 'zod';

const identity = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]+$/u);

/** Page data is context, never an access grant or an instruction override. */
export const pluginPageResourceSchema = z.object({
  title: identity(160),
  resourceId: identity(4096).optional(),
  path: identity(4096).optional(),
  view: identity(500).optional(),
  /** Resolve through this plugin's existing server-side mention provider. */
  mention: z.object({
    providerId: identity(64).refine(value => !value.includes(':'), 'Provider id cannot contain a colon'),
    itemId: identity(4096)
  }).strict().optional()
}).strict();

export type PluginPageResource = z.infer<typeof pluginPageResourceSchema>;

export const pluginPageContextSchema = z.object({
  pluginId: identity(256),
  panel: identity(256),
  projectId: identity(256).optional(),
  view: identity(4096).optional(),
  page: pluginPageResourceSchema.optional()
}).strict();

/** Immutable at submission; kept in the queued message, not thread origin metadata. */
export type PluginPageContext = z.infer<typeof pluginPageContextSchema>;
