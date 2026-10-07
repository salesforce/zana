/** Hard caps (Rule 5): every growing collection in the store is bounded. */

export const MAX_TITLE_LENGTH = 140;
export const MAX_SUMMARY_LENGTH = 600;
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 32;

export const MAX_FILES_PER_DOC = 150;
export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_BINARY_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_DOC_BYTES = 8 * 1024 * 1024;

/** Revisions kept per file; older ones are pruned on write. */
export const MAX_TEXT_REVISIONS_PER_FILE = 25;
export const MAX_BINARY_REVISIONS_PER_FILE = 3;
/** Total snapshot bytes kept per doc; the oldest revisions go first. */
export const MAX_HISTORY_BYTES_PER_DOC = 24 * 1024 * 1024;

export const MAX_COMMENT_LENGTH = 8000;
export const MAX_QUOTE_LENGTH = 500;
export const MAX_COMMENTS_PER_DOC = 500;
export const MAX_THREAD_LINKS_PER_DOC = 50;
export const MAX_NOTE_LENGTH = 200;
export const MAX_EDITS_PER_CALL = 50;

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
export const MAX_HISTORY_LIMIT = 100;
