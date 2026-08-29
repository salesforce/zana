import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MCP startup ordering', () => {
  it('settles session MCP wiring before exposing the first window', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const bootstrap = source.slice(source.indexOf('async function bootstrapNormal()'));
    const start = bootstrap.indexOf('await startMcpServer({');
    const route = bootstrap.indexOf('ptys.setMcpBaseUrl(handle.url);');
    const window = bootstrap.indexOf('if (!unscopedWindow()) createWindow();');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(route).toBeGreaterThan(start);
    expect(window).toBeGreaterThan(route);
  });
});
