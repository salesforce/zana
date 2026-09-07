import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');

describe('Modern team-launch bootstrap', () => {
  it('replays an already-ready MCP endpoint after the runtime supervisor starts', () => {
    const bootstrap = source.slice(
      source.indexOf('async function ensureRendererStaticHost'),
      source.indexOf('async function getAuthoritativeProjectSettings')
    );
    expect(bootstrap).toMatch(
      /if \(mcpServer\)[\s\S]*?runtimeSupervisor\.setMcpBaseUrl\([\s\S]*?mcpServer\.url[\s\S]*?teamLaunchEnabled[\s\S]*?teamJobLaunchEnabled/
    );
  });
});
