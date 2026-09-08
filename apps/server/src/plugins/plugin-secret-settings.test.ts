import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mergeSecretSettings,
  persistSecretSettings,
  pluginSecretFilePath,
  publicSettingsValues
} from './plugin-secret-settings.js';

describe('plugin secret settings', () => {
  it('stores secret string settings in 0600 files and omits them from the public JSON map', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-secrets-'));
    try {
      const descriptors = {
        token: { type: 'string' as const, label: 'Token', secret: true as const },
        name: { type: 'string' as const, label: 'Name' }
      };
      const values = { token: 'shh', name: 'demo' };
      await persistSecretSettings(dir, descriptors, values);
      const secretPath = pluginSecretFilePath(dir, 'token');
      expect(readFileSync(secretPath, 'utf8').trim()).toBe('shh');
      expect(publicSettingsValues(descriptors, values)).toEqual({ name: 'demo' });
      expect(mergeSecretSettings(dir, descriptors, { name: 'demo' }).token).toBe('shh');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
