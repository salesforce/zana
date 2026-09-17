import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('product-client marketplaces', () => {
  it('lists catalogs from desktop IPC and keeps mutations on product HTTP', () => {
    const source = readFileSync(new URL('../product-client.ts', import.meta.url), 'utf8');
    expect(source).toContain("apiJson<{ catalogs?: Awaited<ReturnType<CcApi['marketplaces']['list']>> }>('/marketplaces')");
    expect(source).toContain("'/marketplaces/refresh'");
    expect(source).toContain("'/marketplaces/remove'");
    const start = source.indexOf("if (name === 'marketplaces')");
    const next = source.indexOf("if (name === 'threads'", start);
    const block = source.slice(start, next);
    expect(block).toContain('hasDesktopBridge()');
    expect(block).toContain('desktop?.list');
    expect(block).toContain('rows.length > 0');
    expect(block).toContain('return http.list()');
    expect(block).toContain('add: http.add');
    expect(block).toContain('refresh: http.refresh');
    expect(block).toContain('remove: http.remove');
  });
});
