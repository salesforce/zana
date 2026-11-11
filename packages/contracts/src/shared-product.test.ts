import { expect, it } from 'vitest';
import { SHARED_PRODUCT_METHODS, validSharedProductCall } from './shared-product.js';

it('allows exact teams.preview route through shared owner surface, not arbitrary IPC aliases', () => {
  expect(validSharedProductCall({ method: 'teams.preview', args: [{ projectId: 'p', teamId: 't', goal: 'go' }] })).toBe(true);
  expect(SHARED_PRODUCT_METHODS.get('teams.preview')).toBe('teams:preview');
  expect(validSharedProductCall({ method: 'teams:preview', args: [] })).toBe(false);
  expect(validSharedProductCall({ method: 'executionSources.inspect', args: [] })).toBe(false);
  expect(validSharedProductCall({ method: 'teams.preview', args: [], caller: 'owner' })).toBe(false);
});
