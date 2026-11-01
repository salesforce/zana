import { expect, it } from 'vitest';
import { machineProjectPathSchema, machineProjectNameSchema, machineProjectPageSchema } from './machine-projects.js';
import { HostRpcCommandSchema } from './host-rpc.js';

it('accepts absolute machine paths and rejects unsafe or unbounded catalogue input', () => {
  for (const path of ['/srv/api', 'C:\\repos\\api', '\\\\server\\share\\api']) expect(machineProjectPathSchema.safeParse(path).success).toBe(true);
  for (const path of ['relative', '', '/repo\nother', '/repo\x7f', '/' + 'a'.repeat(4096)]) expect(machineProjectPathSchema.safeParse(path).success).toBe(false);
  for (const name of ['', 'a'.repeat(257), 'API\t']) expect(machineProjectNameSchema.safeParse(name).success).toBe(false);
  expect(HostRpcCommandSchema.parse({ type: 'project.catalogue.list' })).toEqual({ type: 'project.catalogue.list', offset: 0, limit: 100 });
  for (const patch of [{ offset: -1 }, { offset: 1000 }, { limit: 101 }, { limit: 0 }, { offset: 1.2 }, { scanHome: true }]) expect(HostRpcCommandSchema.safeParse({ type: 'project.catalogue.list', ...patch }).success).toBe(false);
  expect(HostRpcCommandSchema.safeParse({ type: 'project.catalogue.register', projects: [{ path: '/srv/api' }] }).success).toBe(true);
  for (const projects of [[], Array(101).fill({ path: '/srv/api' }), [{ path: 'relative' }]]) expect(HostRpcCommandSchema.safeParse({ type: 'project.catalogue.register', projects }).success).toBe(false);
  const page = { revision: 'a'.repeat(64), projects: [], nextOffset: null };
  expect(machineProjectPageSchema.safeParse(page).success).toBe(true);
  for (const patch of [{ revision: 'bad' }, { nextOffset: 0 }, { nextOffset: 1001 }, { extra: true }, { projects: [{ id: 'bad', path: '/repo', name: 'API' }] }]) expect(machineProjectPageSchema.safeParse({ ...page, ...patch }).success).toBe(false);
});
