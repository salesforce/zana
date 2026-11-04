import { isAbsolute, normalize, parse } from 'node:path';

import { TRUSTED_PREVIEW_FOLDERS_MAX } from '@zana-ai/zcc-domain/product';

export { TRUSTED_PREVIEW_FOLDERS_MAX };
export const TRUSTED_PREVIEW_FOLDER_MAX_PATH = 4096;

export class TrustedPreviewFolderError extends Error {
  constructor(readonly code: 'invalid-path' | 'too-many') {
    super(code === 'too-many'
      ? `At most ${TRUSTED_PREVIEW_FOLDERS_MAX} trusted preview folders are allowed.`
      : 'Trusted preview folders must be canonical absolute paths.');
    this.name = 'TrustedPreviewFolderError';
  }
}

/** Canonical absolute form of one folder, or null when the input is not acceptable. */
export function canonicalTrustedPreviewFolder(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > TRUSTED_PREVIEW_FOLDER_MAX_PATH) return null;
  // Nothing is ever expanded: home, variable and command forms are refused outright.
  if (raw.startsWith('~') || raw.includes('$') || raw.includes('`') || raw.includes('\0')) return null;
  if (!isAbsolute(raw)) return null;
  const canonical = normalize(raw);
  // Never trust a whole filesystem root.
  if (canonical === parse(canonical).root) return null;
  return canonical.length > 1 && /[\\/]$/.test(canonical) ? canonical.slice(0, -1) : canonical;
}

/** Strict: throws on any invalid entry or when the cap is exceeded. */
export function normalizeTrustedPreviewFolders(input: unknown): string[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new TrustedPreviewFolderError('invalid-path');
  const out: string[] = [];
  for (const raw of input) {
    const canonical = canonicalTrustedPreviewFolder(raw);
    if (!canonical) throw new TrustedPreviewFolderError('invalid-path');
    if (!out.includes(canonical)) out.push(canonical);
  }
  if (out.length > TRUSTED_PREVIEW_FOLDERS_MAX) throw new TrustedPreviewFolderError('too-many');
  return out;
}

/** Lenient read of stored config: drop what is invalid, never grow past the cap. */
export function sanitizeStoredTrustedPreviewFolders(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    const canonical = canonicalTrustedPreviewFolder(raw);
    if (canonical && !out.includes(canonical)) out.push(canonical);
    if (out.length >= TRUSTED_PREVIEW_FOLDERS_MAX) break;
  }
  return out;
}

/** Add one chooser result. Over-cap fails closed instead of dropping an existing root. */
export function addTrustedPreviewFolder(current: readonly string[] | undefined, picked: string): string[] {
  const next = normalizeTrustedPreviewFolders([...(current ?? []), picked]);
  return next;
}

export function removeTrustedPreviewFolder(current: readonly string[] | undefined, root: string): string[] {
  const canonical = canonicalTrustedPreviewFolder(root);
  return (current ?? []).filter((entry) => entry !== canonical);
}
