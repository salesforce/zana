import { expect, it } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { cliAgentCatalogScope } from './cli-agent-catalog-scope.js';

const primary = { id: 'primary', isPrimary: true, status: 'connected' } as Host;
const remote = { id: 'remote', status: 'connected' } as Host;
const project = { id: 'p', hostId: 'remote', remote: { host: 'ssh-box' } } as Project;

it('always discovers remote harnesses on the bound daemon while SSH execution stays primary', () => {
  expect(cliAgentCatalogScope(project, [primary, remote])).toEqual({
    hostId: 'remote', executionHostId: 'primary', projectId: 'p', ready: true
  });
  expect(cliAgentCatalogScope(project, [remote]).executionHostId).toBeUndefined();
});

it('never substitutes the local catalog when the remote daemon is missing, disconnected or unbound', () => {
  for (const hosts of [[], [primary], [primary, { ...remote, status: 'disconnected' } as Host]]) {
    expect(cliAgentCatalogScope(project, hosts)).toMatchObject({ hostId: 'remote', projectId: 'p', ready: false });
  }
  expect(cliAgentCatalogScope({ ...project, hostId: undefined }, [primary, remote])).toEqual({
    hostId: undefined, executionHostId: 'primary', projectId: 'p', ready: false
  });
});

it('discovers local projects on their bound host, else the primary host', () => {
  expect(cliAgentCatalogScope({ ...project, remote: undefined }, [primary])).toEqual({
    hostId: 'remote', executionHostId: 'primary', projectId: 'p', ready: true
  });
  expect(cliAgentCatalogScope({ ...project, remote: undefined, hostId: undefined }, [primary])).toEqual({
    hostId: 'primary', executionHostId: 'primary', projectId: 'p', ready: true
  });
  expect(cliAgentCatalogScope(undefined, [])).toEqual({
    hostId: undefined, executionHostId: undefined, projectId: undefined, ready: true
  });
});
