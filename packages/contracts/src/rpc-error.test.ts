import { describe, expect, it } from 'vitest';
import {
  classifyExpectedRpcError,
  EXPECTED_RPC_ERROR_CODES,
  parseRpcErrorEnvelope,
  rpcErrorFrom,
  toRpcErrorEnvelope
} from './rpc-error.js';

describe('classifyExpectedRpcError', () => {
  it('treats the generic domain codes as expected with a stable status', () => {
    const statuses = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409, limit: 413 };
    for (const code of EXPECTED_RPC_ERROR_CODES) {
      const err = Object.assign(new Error(`bad ${code}`), { code });
      expect(classifyExpectedRpcError(err)).toEqual({ message: `bad ${code}`, code, status: statuses[code] });
    }
  });

  it('treats 4xx numeric statuses as expected and derives a generic code', () => {
    const cases: Array<[number, string]> = [[400, 'invalid'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [413, 'limit'], [429, 'limit'], [422, 'invalid'], [499, 'invalid']];
    for (const [status, code] of cases) {
      expect(classifyExpectedRpcError({ message: 'x', status, code: 'CUSTOM' })).toEqual({ message: 'x', code, status });
    }
  });

  it('rejects unexpected shapes', () => {
    for (const value of [null, undefined, 'str', 7, new Error('plain'), { code: 'ENOENT' }, { code: 4 }, { status: 500 }, { status: 399 }, { status: 404.5 }, { status: '404' }]) {
      expect(classifyExpectedRpcError(value)).toBeNull();
    }
  });

  it('falls back to a generic, bounded message', () => {
    expect(classifyExpectedRpcError({ code: 'invalid' })?.message).toBe('request failed');
    expect(classifyExpectedRpcError({ code: 'invalid', message: '' })?.message).toBe('request failed');
    expect(classifyExpectedRpcError({ code: 'invalid', message: 'x'.repeat(9000) })?.message).toHaveLength(8192);
  });
});

describe('rpc error envelope', () => {
  it('round-trips an expected error', () => {
    const expected = classifyExpectedRpcError(Object.assign(new Error('keep one file'), { code: 'invalid' }))!;
    const envelope = toRpcErrorEnvelope(expected);
    expect(envelope).toEqual({ __zccRpcError: { message: 'keep one file', code: 'invalid' } });
    expect(parseRpcErrorEnvelope(envelope)).toEqual({ message: 'keep one file', code: 'invalid' });
  });

  it('parses strictly', () => {
    for (const value of [null, undefined, 'x', [], {}, { __zccRpcError: null }, { __zccRpcError: [] }, { __zccRpcError: { message: 3 } }, { __zccRpcError: { message: 'm', code: 3 } }, { value: 1 }]) {
      expect(parseRpcErrorEnvelope(value)).toBeNull();
    }
    expect(parseRpcErrorEnvelope({ __zccRpcError: { message: 'm' } })).toEqual({ message: 'm' });
    expect(parseRpcErrorEnvelope({ __zccRpcError: { message: 'm', code: '' } })).toEqual({ message: 'm' });
    expect(parseRpcErrorEnvelope({ __zccRpcError: { message: 'm', code: 'c'.repeat(65) } })).toEqual({ message: 'm' });
    expect(parseRpcErrorEnvelope({ __zccRpcError: { message: 'x'.repeat(9000) } })?.message).toHaveLength(8192);
  });
});

describe('rpcErrorFrom', () => {
  it('attaches only valid code and status', () => {
    const err = rpcErrorFrom('msg', 'invalid', 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ message: 'msg', code: 'invalid', status: 400 });
    const bare = rpcErrorFrom('msg', 5, 'x');
    expect(bare.message).toBe('msg');
    expect(bare).not.toHaveProperty('code');
    expect(bare).not.toHaveProperty('status');
    expect(rpcErrorFrom('m', 'c'.repeat(65))).not.toHaveProperty('code');
  });
});
