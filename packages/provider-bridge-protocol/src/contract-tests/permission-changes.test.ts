import { expect, it } from 'vitest';
import { permissionChangeCases, runPermissionChangeCase, type PermissionChangeDriver } from './permission-changes.js';

const modes = ['accept-edits', 'auto', 'full'] as const;
it('covers every distinct permission transition for start and steer', () => {
  const cases = permissionChangeCases(modes);
  expect(cases).toHaveLength(12);
  expect(new Set(cases.map(value => JSON.stringify(value))).size).toBe(12);
  expect(cases.every(value => value.before !== value.after)).toBe(true);
  expect(permissionChangeCases(['full'])).toEqual([]);
});

it.each(permissionChangeCases(modes))('checks $before → $after with $method and reconciles the full policy', async scenario => {
  const policies = {
    'accept-edits': { permissionMode: 'accept-edits', permissionScope: 'workspace', approvalReviewer: 'user', permissionEscalation: 'ask' },
    auto: { permissionMode: 'auto', permissionScope: 'workspace', approvalReviewer: 'automatic', permissionEscalation: 'ask' },
    full: { permissionMode: 'full', permissionScope: 'full', approvalReviewer: null, permissionEscalation: null }
  } as const;
  let current = policies[scenario.before!];
  const calls: unknown[] = [];
  const driver: PermissionChangeDriver = {
    start: async options => { expect(options).toEqual(current); },
    dispatch: async (method, options, hold) => {
      calls.push([method, options, hold]);
      current = policies[options.permissionMode!];
    },
    observe: async () => ({ mode: current.permissionMode, sandbox: current.permissionMode !== 'full' })
  };
  await runPermissionChangeCase(driver, scenario);
  expect(calls).toEqual([
    ['turn/start', policies[scenario.before!], scenario.method === 'turn/steer'],
    [scenario.method, policies[scenario.after!], false]
  ]);
});

it('rejects a driver that keeps the old policy', async () => {
  const driver: PermissionChangeDriver = {
    start: async () => {}, dispatch: async () => {},
    observe: async () => ({ mode: 'full', sandbox: false })
  };
  await expect(runPermissionChangeCase(driver, { before: 'full', after: 'auto', method: 'turn/steer' })).rejects.toThrow();
});
