import { stripSoqlComments } from './strip-soql-comments.js';

/** Salesforce returns a bare `COUNT()` only in `totalSize`, with no records. */
export function isBareCountQuery(soql: string | null | undefined): boolean {
  return /^\s*select\s+count\s*\(\s*\)\s*from\b/i.test(stripSoqlComments(soql ?? ''));
}
