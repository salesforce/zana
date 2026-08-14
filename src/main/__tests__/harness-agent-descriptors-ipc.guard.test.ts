import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../../preload/index.ts', import.meta.url), 'utf8');

describe('project-authorized harness agent descriptor IPC', () => {
  it('passes project id plus a bounded refresh boolean through preload', () => {
    expect(preloadSource).toContain(
      'agentDescriptors: (projectId, refresh = false) =>\n      ipcRenderer.invoke(IPC.harness.agentDescriptors, projectId, refresh === true)'
    );
  });

  it('rejects invalid, unknown, and remote projects before provider discovery', () => {
    const handler = mainSource.slice(
      mainSource.indexOf('IPC.harness.agentDescriptors'),
      mainSource.indexOf('IPC.harness.effectiveDefault')
    );
    expect(handler).toContain("typeof projectId !== 'string'");
    expect(handler).toContain('store.listProjects().find((entry) => entry.id === projectId)');
    expect(handler).toMatch(/if \(!project \|\| project\.remote\) return \{ status: 'failure' \};/);
    expect(handler).toContain("providerFor('opencode')");
    expect(handler).toContain('cwd: project.path');
    expect(handler).toContain('config: store.getConfig()');
    expect(handler).toContain('bypassCache: refresh === true');
    expect(handler.indexOf("if (!project || project.remote) return { status: 'failure' };"))
      .toBeLessThan(handler.indexOf('bypassCache: refresh === true'));
    expect(handler).not.toContain('projectPath');
  });
});
