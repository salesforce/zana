import { describe, expect, it, vi } from 'vitest';
import { createApi, templateMetaPatch } from './api.js';

describe('templateMetaPatch', () => {
  it('maps title/summary to label/description and keeps entryPath', () => {
    expect(templateMetaPatch({ title: 'T', summary: 'S', entryPath: 'a.md' })).toEqual({ label: 'T', description: 'S', entryPath: 'a.md' });
  });

  it('includes only the fields present, including empty strings', () => {
    expect(templateMetaPatch({ title: 'T' })).toEqual({ label: 'T' });
    expect(templateMetaPatch({ summary: '' })).toEqual({ description: '' });
    expect(templateMetaPatch({ entryPath: 'b.md' })).toEqual({ entryPath: 'b.md' });
  });

  it('drops keys the template RPC rejects', () => {
    expect(templateMetaPatch({ expectedHead: 'h', title: 'T' })).toEqual({ label: 'T' });
    expect(templateMetaPatch({})).toEqual({});
  });

  it('is applied by the templateUpdateMeta adapter', async () => {
    const call = vi.fn().mockResolvedValue({});
    await createApi(call).templateUpdateMeta('tpl', { expectedHead: 'h', title: 'New' });
    expect(call).toHaveBeenCalledWith('templateUpdateMeta', { template: 'tpl', label: 'New' });
  });
});
