import { supportedThreadPermissionDefault, type PermissionMode } from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import { canonicalThreadProviderId, getThreadProvider, permissionModeForLaunchProfile } from './thread-provider-catalog.js';

export function permissionModeForNewThread(
  providerId: string,
  explicit: PermissionMode | undefined,
  configured: PermissionMode | null | undefined
): PermissionMode {
  if (explicit) return explicit;
  // A named YOLO launch profile is itself an explicit permission choice.
  if (configured == null || (providerId.endsWith('-yolo') && canonicalThreadProviderId(providerId) !== providerId)) return permissionModeForLaunchProfile(providerId);
  const provider = getThreadProvider(providerId);
  if (!provider) throw new ThreadCreateError(400, 'invalid-provider', `unknown thread provider: ${providerId}`);
  const mode = supportedThreadPermissionDefault(configured, provider.capabilities.permissionModes ?? []);
  if (mode) return mode;
  throw new ThreadCreateError(400, 'unsupported-default-permissions',
    'This provider cannot use the default permission policy. Choose permissions for this launch or change Default permissions in Settings → Composer.');
}
