import { describe, expect, it } from 'vitest';
import {
  BUNDLED_PRODUCT_SKILL_IDS,
  isBundledProductSkillId
} from './bundled-product-skills.js';

describe('bundled product skills', () => {
  it('recognizes shipped skill ids and rejects unknown names', () => {
    expect(BUNDLED_PRODUCT_SKILL_IDS).toContain('zcc-cli');
    expect(isBundledProductSkillId('zcc-cli')).toBe(true);
    expect(isBundledProductSkillId('not-a-shipped-skill')).toBe(false);
  });
});
