import { expect, it } from 'vitest';
import { fixtureProcessState } from '../e2e/fixtures/process-state.js';

it.each(['R', 'S', 'D', 'T', 't', 'I', '?', 'z', 'x'])('rejects a surviving Linux process in state %s', state => {
  expect(fixtureProcessState(123, { platform: 'linux', signal: () => {}, readStat: () => `123 (fixture (child)) ${state} 42 0` }))
    .toEqual({ pid: 123, running: true, state, parentPid: 42, command: 'fixture (child)' });
});

it.each(['Z', 'X'])('accepts only terminated Linux state %s while preserving proof', state => {
  expect(fixtureProcessState(123, { platform: 'linux', signal: () => {}, readStat: () => `123 (fixture) ${state} 1 0` }))
    .toEqual({ pid: 123, running: false, state, parentPid: 1, command: 'fixture' });
});

it('recognizes a reaped process and an exit racing the stat read', () => {
  expect(fixtureProcessState(123, { signal: () => { throw Object.assign(new Error(), { code: 'ESRCH' }); } }))
    .toEqual({ pid: 123, running: false, state: 'missing' });
  expect(fixtureProcessState(123, { platform: 'linux', signal: () => {}, readStat: path => {
    expect(path).toBe('/proc/123/stat');
    throw Object.assign(new Error(), { code: 'ENOENT' });
  } })).toEqual({ pid: 123, running: false, state: 'missing' });
});

it.each(['EPERM', 'EACCES', 'EINVAL'])('keeps signal error %s fail closed', code => {
  let readStat = false;
  expect(fixtureProcessState(123, { platform: 'linux', signal: () => { throw Object.assign(new Error(), { code }); }, readStat: () => {
    readStat = true;
    return '123 (fixture) Z 1 0';
  } })).toEqual({ pid: 123, running: true, state: 'unknown' });
  expect(readStat).toBe(false);
});

it.each(['malformed', '123 ) Z 1', '124 (fixture) Z 1', '123 (fixture Z 1', '123 (fixture) Z invalid',
  '123 (fixture) Z 9007199254740992', '123 (fixture) ZZ 1', '123 (fixture)'])('keeps malformed stat fail closed: %s', stat => {
  expect(fixtureProcessState(123, { platform: 'linux', signal: () => {}, readStat: () => stat }))
    .toEqual({ pid: 123, running: true, state: 'unknown' });
});

it.each(['EACCES', undefined])('keeps unreadable process state fail closed: %s', code => {
  expect(fixtureProcessState(123, { platform: 'linux', signal: () => {}, readStat: () => { throw Object.assign(new Error('unreadable'), { code }); } }))
    .toEqual({ pid: 123, running: true, state: 'unknown' });
});

it('does not read Linux process state on another platform', () => {
  let readStat = false;
  expect(fixtureProcessState(123, { platform: 'darwin', signal: () => {}, readStat: () => {
    readStat = true;
    return '123 (fixture) Z 1 0';
  } })).toEqual({ pid: 123, running: true, state: 'unknown' });
  expect(readStat).toBe(false);
});

it('reads the current process through the real platform boundary', () => {
  expect(fixtureProcessState(process.pid)).toMatchObject({ pid: process.pid, running: true });
});

it('recognizes a missing process stat through the real filesystem boundary', () => {
  expect(fixtureProcessState(Number.MAX_SAFE_INTEGER, { platform: 'linux', signal: () => {} }))
    .toEqual({ pid: Number.MAX_SAFE_INTEGER, running: false, state: 'missing' });
});
