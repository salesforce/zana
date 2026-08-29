import { describe, expect, it } from 'vitest';
import { defaultFetchJson } from './plugin-process.js';

describe('defaultFetchJson', () => {
  it('refuses non-https marketplace URLs', async () => {
    await expect(defaultFetchJson('http://example.test/mp.json')).rejects.toThrow(/must be https/);
    await expect(defaultFetchJson('file:///tmp/mp.json')).rejects.toThrow(/must be https/);
  });
});
