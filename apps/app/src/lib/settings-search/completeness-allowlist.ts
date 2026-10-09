import type { SearchSection } from './guard-config';

/**
 * Intentional exclusions from the completeness guard (design §3.5). One reason
 * per entry; an entry without a real reason should not be added.
 */
export interface AllowedString {
  section: SearchSection;
  /** The literal as it appears in source (compared after normalisation). */
  text: string;
  reason: string;
}

export interface AllowedFile {
  /** Path relative to `apps/app/src`. */
  file: string;
  reason: string;
}

export interface AllowedStaleId {
  /** An entry id or anchor whose source id is built dynamically. */
  id: string;
  reason: string;
}

/** Literals that are deliberately not searchable. */
export const ALLOWED_STRINGS: readonly AllowedString[] = [];

/** Whole files that carry no searchable settings rows (exempt from the every-file-is-mapped check). */
export const ALLOWED_FILES: readonly AllowedFile[] = [];

/** Entry ids / anchors with no static `searchId` / `anchorId` literal in source. */
export const ALLOWED_STALE_IDS: readonly AllowedStaleId[] = [];
