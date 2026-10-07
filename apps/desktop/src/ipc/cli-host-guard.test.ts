import { expect, it } from 'vitest';
import { cliHostProblem, teamHostProblem } from './cli-host-guard.js';
it('preserves default and explicitly primary launches', () => {
  expect(cliHostProblem({}, undefined)).toBeUndefined();
  expect(cliHostProblem({}, {})).toBeUndefined();
  expect(cliHostProblem({ hostId: 'primary' }, {}, 'primary')).toBeUndefined();
  expect(cliHostProblem({}, { hostId: 'primary' }, 'primary')).toBeUndefined();
});
it('allows registered SSH projects with or without a bound daemon', () => {
  for (const hostId of [undefined, 'secondary']) {
    const project = { hostId, remote: { host: 'ssh-box' } };
    expect(cliHostProblem({}, project, 'primary')).toBeUndefined();
    expect(cliHostProblem({}, project)).toBeUndefined();
    expect(cliHostProblem({ hostId: 'primary' }, project, 'primary')).toBeUndefined();
    if (hostId) expect(cliHostProblem({ hostId }, project, 'primary')).toBeUndefined();
    expect(cliHostProblem({ hostId: 'other' }, project, 'primary')).toContain('secondary machines');
    expect(cliHostProblem({ hostId: '' }, project, 'primary')).toContain('valid execution machine');
    expect(teamHostProblem(project, 'primary')).toBe(hostId ? 'Squad/Team execution on secondary machines is not available yet. Choose a project on the primary machine.' : undefined);
  }
});
it('keeps primary and legacy Team projects launchable, and rejects secondary or unresolved owners', () => {
  expect(teamHostProblem({})).toBeUndefined();
  expect(teamHostProblem({}, 'primary')).toBeUndefined();
  expect(teamHostProblem({ hostId: 'primary' }, 'primary')).toBeUndefined();
  expect(teamHostProblem({ hostId: 'remote' }, 'primary')).toContain('Squad/Team');
  expect(teamHostProblem({ hostId: 'primary' })).toContain('primary machine');
});
it('rejects remote or unknown identities before a local filesystem or process can be touched', () => {
  for (const [request, project, local] of [
    [{ hostId: 'remote' }, {}, 'primary'], [{}, { hostId: 'remote' }, 'primary'],
    [{ hostId: 'primary' }, { hostId: 'remote' }, 'primary'], [{ hostId: 'primary' }, {}, undefined],
    [{ hostId: '' }, {}, 'primary'], [{ hostId: 42 }, {}, 'primary']
  ] as const) expect(cliHostProblem(request as any, project, local)).toBeTruthy();
});
