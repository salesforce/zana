import { z } from 'zod';

// This public projection deliberately strips unknown bridge fields (including credentials).
export const providerReadinessResultSchema = z.discriminatedUnion('supported', [
  z.object({ supported: z.literal(false) }),
  z.object({ supported: z.literal(true), health: z.object({
    status: z.enum(['ready', 'not_installed', 'unauthenticated', 'expired', 'unsupported_version', 'unknown']),
    statusMessage: z.string().max(2048).nullable().optional(),
    accountEmail: z.string().max(320).nullable().optional(),
    planLabel: z.string().max(256).nullable().optional(),
    loginCommand: z.string().min(1).max(10_000).nullable(),
    localLoginCommand: z.string().min(1).max(10_000).nullable().optional(),
  }) }),
]);
export type ProviderReadinessResult = z.infer<typeof providerReadinessResultSchema>;
export interface ProviderReadinessResponse {
  providerId: string;
  hostId: string;
  result: ProviderReadinessResult;
}
export const providerSignInRequestSchema = z.object({
  hostId: z.string().min(1).max(256),
  localBrowser: z.boolean().optional(),
}).strict();
