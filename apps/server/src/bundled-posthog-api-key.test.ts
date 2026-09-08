import { describe, expect, it } from 'vitest';
import { applyBundledPosthogApiKey, resolvePosthogApiKey } from './bundled-posthog-api-key.js';

describe('resolvePosthogApiKey', () => {
  it('prefers runtime env over a bake', () => {
    expect(resolvePosthogApiKey({
      env: { ZCC_POSTHOG_API_KEY: ' phc_env ' },
      bundledKey: 'phc_baked'
    })).toBe('phc_env');
  });

  it('uses the bake when env is empty', () => {
    expect(resolvePosthogApiKey({ env: {}, bundledKey: ' phc_baked ' })).toBe('phc_baked');
    expect(resolvePosthogApiKey({ env: { ZCC_POSTHOG_API_KEY: '  ' }, bundledKey: 'phc_baked' })).toBe(
      'phc_baked'
    );
  });

  it('returns empty when neither env nor bake is set', () => {
    expect(resolvePosthogApiKey({ env: {}, bundledKey: '' })).toBe('');
  });
});

describe('applyBundledPosthogApiKey', () => {
  it('copies the bake onto env when the key is unset', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(applyBundledPosthogApiKey(env, { bundledKey: 'phc_baked' })).toBe('phc_baked');
    expect(env.ZCC_POSTHOG_API_KEY).toBe('phc_baked');
  });

  it('does not overwrite a runtime env key', () => {
    const env: NodeJS.ProcessEnv = { ZCC_POSTHOG_API_KEY: 'phc_runtime' };
    expect(applyBundledPosthogApiKey(env, { bundledKey: 'phc_baked' })).toBe('phc_runtime');
    expect(env.ZCC_POSTHOG_API_KEY).toBe('phc_runtime');
  });

  it('leaves env unset when there is no key', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(applyBundledPosthogApiKey(env, { bundledKey: '' })).toBe('');
    expect(env.ZCC_POSTHOG_API_KEY).toBeUndefined();
  });
});
