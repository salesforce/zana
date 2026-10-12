import type { SkillEntry } from '@zana-ai/zcc-domain/product';
import { apiJson } from './fetch-with-app-surface.js';
export interface NativeCapabilityListing {
  skills: SkillEntry[];
  commands: Array<{
    id: string;
    name: string;
    description: string;
    providerId: string;
    source: 'skill' | 'command';
  }>;
  diagnostics: string[];
}
export function nativeCapabilities(options: {
  projectId?: string;
  providerId?: string;
  hostId?: string;
  environmentId?: string;
}): Promise<NativeCapabilityListing> {
  const query = new URLSearchParams();
  for (const key of ['providerId', 'hostId', 'environmentId'] as const)
    if (options[key]) query.set(key, options[key]!);
  const path = options.projectId
    ? `/projects/${encodeURIComponent(options.projectId)}/native-capabilities`
    : '/skills/native-capabilities';
  return apiJson(`${path}${query.size ? `?${query}` : ''}`);
}
