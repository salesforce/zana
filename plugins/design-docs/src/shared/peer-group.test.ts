import { describe, expect, it } from 'vitest';
import { MAX_PERMANENT_JOB_ATTEMPTS, NOT_CONNECTED, ownerText, stuckJob, UNREADABLE_REPLY } from './peer-group.js';

describe('owner-facing peer job text', () => {
  it('passes sentences through and replaces JSON-looking dumps', () => {
    expect(ownerText(null)).toBeNull();
    expect(ownerText(undefined)).toBeNull();
    expect(ownerText('')).toBeNull();
    expect(ownerText('peer offline')).toBe('peer offline');
    expect(ownerText('[\n  { "code": "invalid_type", "path": [] }\n]')).toBe(UNREADABLE_REPLY);
    expect(ownerText('  {"roster":null}')).toBe(UNREADABLE_REPLY);
  });

  it('replaces core enrollment jargon with what it means', () => {
    for (const text of ['mutual enrollment unavailable', 'mutual execution enrollment unavailable', 'mutual enrollment missing']) expect(ownerText(text)).toBe(NOT_CONNECTED);
    expect(NOT_CONNECTED).not.toMatch(/enrollment/);
    expect(ownerText('mutual enrollment proof mismatch')).toBe('mutual enrollment proof mismatch');
  });

  it('only failed work or work blocked at the attempt cap counts as stuck', () => {
    expect(stuckJob({ state: 'failed', attempts: 1 })).toBe(true);
    expect(stuckJob({ state: 'blocked', attempts: MAX_PERMANENT_JOB_ATTEMPTS })).toBe(true);
    expect(stuckJob({ state: 'blocked', attempts: MAX_PERMANENT_JOB_ATTEMPTS - 1 })).toBe(false);
    expect(stuckJob({ state: 'pending', attempts: 99 })).toBe(false);
    expect(stuckJob({ state: 'done', attempts: 99 })).toBe(false);
  });
});
