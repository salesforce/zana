import { describe, expect, it } from 'vitest';
import { applyBrowseHeroOpenRequest } from './browse-hero-archetypes.js';

describe('applyBrowseHeroOpenRequest', () => {
  it('enters compose for a new nonce and keeps the seed', () => {
    expect(applyBrowseHeroOpenRequest({ nonce: 2, seed: 'Create a kanban' }, null)).toEqual({
      enterCompose: true,
      nonce: 2,
      seed: 'Create a kanban'
    });
  });

  it('does not re-enter compose when the same request is seen again', () => {
    expect(applyBrowseHeroOpenRequest({ nonce: 2, seed: 'Create a kanban' }, 2)).toEqual({
      enterCompose: false,
      nonce: 2
    });
  });

  it('does not re-enter compose after Back clears the request', () => {
    expect(applyBrowseHeroOpenRequest(null, 2)).toEqual({
      enterCompose: false,
      nonce: null
    });
  });

  it('re-enters compose when Create mints a later nonce', () => {
    expect(applyBrowseHeroOpenRequest({ nonce: 3, seed: 'Create a dashboard' }, null)).toEqual({
      enterCompose: true,
      nonce: 3,
      seed: 'Create a dashboard'
    });
  });
});
