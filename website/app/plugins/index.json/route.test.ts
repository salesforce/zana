import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/live-marketplace', () => ({ loadOfficialMarketplace: vi.fn() }));
import { loadOfficialMarketplace } from '../../../lib/live-marketplace';
import { GET } from './route';

afterEach(() => vi.resetAllMocks());

describe('legacy plugins index alias', () => {
  it('serves the live catalog and points at the canonical feed', async () => {
    const catalog = { schemaVersion: 1, name: 'official', displayName: 'Zana Official', plugins: [] };
    vi.mocked(loadOfficialMarketplace).mockResolvedValue(catalog);
    const response = await GET();
    expect(await response.json()).toEqual(catalog);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Link')).toBe('</marketplace/v1/marketplace.json>; rel="canonical"');
  });
});
