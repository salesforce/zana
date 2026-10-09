import { describe, expect, it } from 'vitest';
import { wantsSecretsOmitted, withoutSecretValues } from './plugin-settings-redaction.js';

const snapshot = {
  descriptors: {
    apiKey: { type: 'string', label: 'API key', secret: true },
    region: { type: 'string', label: 'Region' },
    verbose: { type: 'boolean', label: 'Verbose' }
  },
  values: { apiKey: 'sk-live-x', region: 'eu', verbose: true } as Record<string, unknown>
};

describe('withoutSecretValues', () => {
  it('drops secret values only, keeps every descriptor, and never mutates the input', () => {
    const out = withoutSecretValues(snapshot);
    expect(out.values).toEqual({ region: 'eu', verbose: true });
    expect(out.descriptors).toBe(snapshot.descriptors);
    expect(snapshot.values.apiKey).toBe('sk-live-x');
  });

  it('treats only a literal secret: true as secret', () => {
    const out = withoutSecretValues({
      descriptors: { a: { secret: 'yes' }, b: { secret: false } },
      values: { a: 1, b: 2 }
    });
    expect(out.values).toEqual({ a: 1, b: 2 });
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
