import { isRetryableApiErrorKind } from '@zcc/harness-sdk';
import { describe, expect, it } from 'vitest';
import { classifyApiError } from '../api-error-kind.js';

describe('classifyApiError', () => {
  it.each([
    [{ status: 429, text: 'slow down' }, 'rate_limit', true],
    [{ status: 429, text: 'You exceeded your current quota, check billing' }, 'quota_exceeded', false],
    [{ status: 529 }, 'overloaded', true],
    [{ status: 503 }, 'server_error', true],
    [{ status: 500 }, 'server_error', true],
    [{ status: '502' }, 'server_error', true],
    [{ status: 401 }, 'authentication_failed', false],
    [{ status: 403 }, 'authentication_failed', false],
    [{ status: 400 }, 'invalid_request', false],
    [{ status: ' 422 ' }, 'invalid_request', false],
    [{ text: 'litellm.ServiceUnavailableError: BedrockException' }, 'server_error', true],
    [{ text: 'Rate limit reached' }, 'rate_limit', true],
    [{ text: 'Overloaded' }, 'overloaded', true],
    [{ text: 'Invalid API key' }, 'authentication_failed', false],
    [{ text: 'maximum context length exceeded' }, 'invalid_request', false],
    [{ text: 'insufficient_quota' }, 'quota_exceeded', false],
    [{ text: '' }, 'unknown', true],
    [{}, 'unknown', true],
    [{ status: 'abc', text: 'weird' }, 'unknown', true],
    [{ status: 418, text: 'teapot' }, 'unknown', true]
  ])('%j -> %s', (input, kind, retryable) => {
    expect(classifyApiError(input)).toBe(kind);
    expect(isRetryableApiErrorKind(kind)).toBe(retryable);
  });

  it('handles oversize text without throwing', () => {
    expect(classifyApiError({ text: 'x'.repeat(100_000) })).toBe('unknown');
  });

  it('does not let status text hidden past the cap change the result', () => {
    expect(classifyApiError({ text: `${'x'.repeat(5000)} rate limit` })).toBe('unknown');
  });
});
