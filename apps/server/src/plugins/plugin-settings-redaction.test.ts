import { describe, expect, it } from 'vitest';
import { wantsSecretsOmitted, withoutSecretValues } from './plugin-settings-redaction.js';

const snapshot = {
  descriptors: {
    apiKey: { type: 'string', label: 'API key', secret: true, default: 'fixture-default-secret' },
    region: { type: 'string', label: 'Region', default: 'us' },
    verbose: { type: 'boolean', label: 'Verbose' }
  },
  values: { apiKey: 'sk-live-x', region: 'eu', verbose: true } as Record<string, unknown>
};

describe('withoutSecretValues', () => {
  it('drops secret values and defaults, keeps public metadata, and never mutates the input', () => {
    const out = withoutSecretValues(snapshot);
    expect(out.values).toEqual({ region: 'eu', verbose: true });
    expect(out.descriptors).toEqual({
      ...snapshot.descriptors,
      apiKey: { type: 'string', label: 'API key', secret: true }
    });
    expect(out.descriptors.region).toBe(snapshot.descriptors.region);
    expect(JSON.stringify(out)).not.toContain('fixture-default-secret');
    expect(snapshot.values.apiKey).toBe('sk-live-x');
    expect(snapshot.descriptors.apiKey.default).toBe('fixture-default-secret');
  });

  it('redacts defaults even when no stored value exists and accepts frozen inputs', () => {
    const input = Object.freeze({
      descriptors: Object.freeze({
        key: Object.freeze({ secret: true, default: { credential: 'fixture-default-only' }, label: 'Key' }),
        noDefault: Object.freeze({ secret: true, label: 'No default' })
      }),
      values: Object.freeze({}),
      pluginId: 'example'
    });
    expect(withoutSecretValues(input)).toEqual({
      descriptors: { key: { secret: true, label: 'Key' }, noDefault: { secret: true, label: 'No default' } },
      values: {},
      pluginId: 'example'
    });
    expect(input.descriptors.key.default).toEqual({ credential: 'fixture-default-only' });
  });

  it('treats only a literal secret: true as secret', () => {
    const out = withoutSecretValues({
      descriptors: { a: { secret: 'yes', default: 1 }, b: { secret: false, default: 2 } },
      values: { a: 1, b: 2 }
    });
    expect(out.values).toEqual({ a: 1, b: 2 });
    expect(out.descriptors).toEqual({ a: { secret: 'yes', default: 1 }, b: { secret: false, default: 2 } });
  });
});

describe('wantsSecretsOmitted', () => {
  it('narrows untrusted renderer options to a literal true', () => {
    expect(wantsSecretsOmitted({ omitSecrets: true })).toBe(true);
    for (const value of [undefined, null, 'x', {}, { omitSecrets: 'true' }, { omitSecrets: 1 }]) {
      expect(wantsSecretsOmitted(value)).toBe(false);
    }
  });
});
