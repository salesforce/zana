import { describe, expect, it } from 'vitest';
import { headersToPairs, pairsToObject } from './headers.mjs';

describe('pairing header filter', () => {
  it('drops hop-by-hop, Host, and Origin so the last hop can use loopback', () => {
    expect(headersToPairs({
      authorization: 'Bearer zcde_x',
      host: 'zcc.herokuapp.com',
      origin: 'https://evil.example',
      connection: 'keep-alive',
      'content-length': '18',
      'x-zcc-host-id': 'abc'
    })).toEqual([
      ['authorization', 'Bearer zcde_x'],
      ['content-length', '18'],
      ['x-zcc-host-id', 'abc']
    ]);
    expect(pairsToObject([
      ['content-type', 'application/json'],
      ['content-length', '18']
    ])).toEqual({
      'content-type': 'application/json',
      'content-length': '18'
    });
  });
});
