import { describe, expect, it } from 'vitest';
import { API_ERROR_RETRYABLE_KINDS, isRetryableApiErrorKind } from '../status.js';

// REQ-3: one shared API-error vocabulary.
describe('shared API-error vocabulary', () => {
  it('lists the temporary kinds', () => {
    expect([...API_ERROR_RETRYABLE_KINDS]).toEqual(['rate_limit', 'overloaded', 'server_error', 'unknown']);
  });

  it.each(['rate_limit', 'overloaded', 'server_error', 'unknown'])('treats %s as retryable', (kind) => {
    expect(isRetryableApiErrorKind(kind)).toBe(true);
  });

  it.each(['invalid_request', 'authentication', 'permission', 'billing'])('treats the permanent kind %s as not retryable', (kind) => {
    expect(isRetryableApiErrorKind(kind)).toBe(false);
  });

  it.each(['something_new', '', 'Rate_Limit'])('treats the unrecognised kind %j as not retryable', (kind) => {
    expect(isRetryableApiErrorKind(kind)).toBe(false);
  });
});
