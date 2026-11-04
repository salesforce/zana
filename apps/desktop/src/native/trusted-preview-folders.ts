import { realpath, stat } from 'node:fs/promises';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import {
  addTrustedPreviewFolder,
  canonicalTrustedPreviewFolder,
  removeTrustedPreviewFolder
} from '@zana-ai/zcc-server/services/config/trusted-preview-folders';

export interface TrustedPreviewFolderDeps {
  getConfig(): AppConfig;
  setConfig(patch: Partial<AppConfig>): AppConfig;
}

/**
 * Persist a folder the user just picked in the native chooser. The chooser
 * result is resolved to its real directory first, so a symlinked pick trusts
 * what it points to and nothing else. Over-cap and non-directory picks throw
 * without changing the stored list.
 */
export async function addPickedTrustedPreviewFolder(picked: string, deps: TrustedPreviewFolderDeps): Promise<AppConfig> {
  const real = await realpath(picked);
  if (!(await stat(real)).isDirectory()) throw new Error('Choose a folder.');
  const next = addTrustedPreviewFolder(deps.getConfig().trustedPreviewFolders, real);
  return deps.setConfig({ trustedPreviewFolders: next });
}

/** Removes one entry from the list only; files on disk are never touched. */
export function removeStoredTrustedPreviewFolder(root: unknown, deps: TrustedPreviewFolderDeps): AppConfig {
  if (!canonicalTrustedPreviewFolder(root)) throw new Error('Unknown trusted folder.');
  const current = deps.getConfig().trustedPreviewFolders;
  return deps.setConfig({ trustedPreviewFolders: removeTrustedPreviewFolder(current, root as string) });
}
