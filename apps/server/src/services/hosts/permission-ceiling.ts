import {
  clampPermissionModeToCeiling,
  type PermissionMode
} from '@zana-ai/zcc-domain/thread-runtime';
import { getHost, type ZccDatabase } from '@zana-ai/zcc-db';

export function clampPermissionModeToHost(
  db: ZccDatabase,
  hostId: string,
  permissionMode: PermissionMode,
  permissionModes?: readonly PermissionMode[]
): PermissionMode | null {
  const host = getHost(db, hostId);
  const ceiling = host?.maxPermissionMode ?? 'full';
  return clampPermissionModeToCeiling({
    ceiling,
    permissionMode,
    permissionModes
  });
}
