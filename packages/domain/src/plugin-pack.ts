import { z } from 'zod';
import type { MarketplaceEntry } from './plugin-marketplace.js';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128);

/** Optional packs.json sidecar. marketplace.json deliberately remains strict v1. */
export const pluginPackEntrySchema = z.object({
  id,
  displayName: z.string().min(1).max(160),
  description: z.string().min(1).max(2000),
  icon: z.string().min(1).max(128).optional(),
  members: z.array(z.object({ pluginId: id, required: z.boolean().optional() }).strict())
    .min(1).max(32)
    .refine((members) => new Set(members.map((member) => member.pluginId)).size === members.length,
      'pack members must have unique plugin IDs')
}).strict();

export const pluginPackIndexSchema = z.object({
  schemaVersion: z.literal(1),
  packs: z.array(pluginPackEntrySchema).max(64)
    .refine((packs) => new Set(packs.map((pack) => pack.id)).size === packs.length,
      'packs must have unique IDs')
}).strict();

export const pluginPackIdentitySchema = z.object({
  marketplaceSource: z.string().min(1).max(4096),
  packId: id
}).strict();

export const pluginPackInstallRequestSchema = z.object({
  identity: pluginPackIdentitySchema,
  planId: z.string().uuid(),
  pluginIds: z.array(id).min(1).max(32)
    .refine((ids) => new Set(ids).size === ids.length, 'selected plugin IDs must be unique')
}).strict();

export type PluginPackEntry = z.infer<typeof pluginPackEntrySchema>;
export type PluginPackIndex = z.infer<typeof pluginPackIndexSchema>;
export type PluginPackIdentity = z.infer<typeof pluginPackIdentitySchema>;
export type PluginPackInstallRequest = z.infer<typeof pluginPackInstallRequestSchema>;

export interface PluginPackCatalogEntry {
  identity: PluginPackIdentity;
  marketplaceName: string;
  marketplaceDisplayName: string;
  pack: PluginPackEntry;
}

export interface PluginPackPlanMember {
  pluginId: string;
  displayName: string;
  description: string;
  required: boolean;
  status: 'installed' | 'available' | 'unavailable';
  installedVersion?: string;
  installedSource?: string;
  sourceLabel?: string;
  targetVersion?: string;
  reason?: string;
}

export interface PluginPackPlan {
  identity: PluginPackIdentity;
  planId: string;
  displayName: string;
  description: string;
  members: PluginPackPlanMember[];
}

export interface PluginPackInstallationMember {
  pluginId: string;
  displayName: string;
  selected: boolean;
  status: 'pending' | 'installed' | 'failed' | 'skipped';
  version?: string;
  source?: string;
  error?: string;
}

export interface PluginPackInstallation {
  identity: PluginPackIdentity;
  displayName: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  members: PluginPackInstallationMember[];
}

/** Main-only adapter input: never accept an entry or arbitrary source from a renderer. */
export interface PluginPackInstallMember {
  entry: MarketplaceEntry;
  marketplaceSource: string;
  marketplaceName: string;
  pluginId: string;
}
