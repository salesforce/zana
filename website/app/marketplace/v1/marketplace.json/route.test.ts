import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../../lib/live-marketplace', () => ({ loadOfficialMarketplace: vi.fn() }));
import { loadOfficialMarketplace } from '../../../../lib/live-marketplace';
import { GET } from './route';

afterEach(() => vi.resetAllMocks());

describe('official marketplace feed', () => {
  it('serves the live catalog with public CORS and revalidation headers', async () => {
    const catalog = { schemaVersion: 1, name: 'official', displayName: 'Zana Official', plugins: [] };
    vi.mocked(loadOfficialMarketplace).mockResolvedValue(catalog);
    const response = await GET();
    expect(loadOfficialMarketplace).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
  });
});
