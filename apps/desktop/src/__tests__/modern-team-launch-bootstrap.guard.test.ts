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
      /if \(mcpServer\)[\s\S]*?runtimeSupervisor\.setMcpBaseUrl\([\s\S]*?mcpServer\.url[\s\S]*?teamLaunchEnabled[\s\S]*?teamExecutionEnabled/
    );
  });
});

describe('Mobile gateway start ordering', () => {
  it('starts the gateway only after the renderer static host sets the product origin', () => {
    const awaitHost = source.indexOf('await ensureRendererStaticHost();');
    const gatewayStart = source.indexOf('mobileGateway.start().catch');
    expect(awaitHost).toBeGreaterThan(0);
    expect(gatewayStart).toBeGreaterThan(awaitHost);
    expect(source.match(/mobileGateway\.start\(\)\.catch/g)).toHaveLength(1);
    const ensure = source.slice(
      source.indexOf('async function ensureRendererStaticHost'),
      source.indexOf('async function getAuthoritativeProjectSettings')
    );
    expect(ensure).toContain('setProductionRendererOrigin(runtimeSupervisor.rendererUrl)');
  });
});
