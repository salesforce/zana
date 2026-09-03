import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../ipc/execution.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../preload.ts', import.meta.url), 'utf8');

describe('project-authorized harness agent descriptor IPC', () => {
  it('passes project id, selected profile, and a bounded refresh boolean through preload', () => {
    expect(preloadSource).toContain(
      'agentDescriptors: (projectId, profile, refresh = false) =>\n      ipcRenderer.invoke(IPC.harness.agentDescriptors, projectId, profile, refresh === true)'
    );
  });

  it('rejects invalid, unknown, remote, and unsupported profiles before registered discovery', () => {
    const handler = mainSource.slice(
      mainSource.indexOf('IPC.harness.agentDescriptors'),
      mainSource.indexOf('IPC.harness.effectiveDefault')
    );
    expect(handler).toContain("typeof projectId !== 'string' || typeof profile !== 'string'");
    expect(handler).toContain('store.listProjects().find((entry) => entry.id === projectId)');
    expect(handler).toMatch(/if \(!project \|\| project\.remote\) return \{ status: 'failure' \};/);
    expect(handler).toContain('registrationFor(profile as LaunchProfileId)');
    expect(handler).toContain('registration?.discoverAgentDescriptors');
    expect(handler).toContain('verifiedHarnesses()');
    expect(handler).toContain('verified?.enabled || !verified.installed');
    expect(handler).toContain('cwd: project.path');
    expect(handler).toContain('config: store.getConfig()');
    expect(handler).toContain('profile: profile as LaunchProfileId');
    expect(handler).toContain('refresh: refresh === true');
    expect(handler.indexOf("if (!project || project.remote) return { status: 'failure' };"))
      .toBeLessThan(handler.indexOf('refresh: refresh === true'));
    expect(handler).not.toContain('projectPath');
    expect(handler).not.toContain("providerFor('opencode')");
  });

  it('keeps browser product discovery behind server project authorization and host RPC', () => {
    const serverSource = readFileSync(new URL('../../../server/src/http/product-api.ts', import.meta.url), 'utf8');
    const bridgeSource = readFileSync(new URL('../../../server/src/http/harness-via-rpc.ts', import.meta.url), 'utf8');
    expect(serverSource).toContain("'/api/v1/harness/agent-descriptors'");
    expect(serverSource).toContain("ctx.toProjects().find((row) => row.id === projectId)");
    expect(bridgeSource).toContain("type: 'provider.agent_descriptors'");
    expect(bridgeSource).toContain('cwd: input.project.path');
    expect(bridgeSource).toContain('input.project.remote');
  });
});
