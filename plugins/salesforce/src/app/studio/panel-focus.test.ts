import { expect, it } from 'vitest';
import { focusKey, parseStudioFocus } from './panel-focus.js';

it('reads path, line, apiName, tool and readOnly defensively', () => {
  expect(parseStudioFocus({ path: ' a/b.agent ', line: 12 })).toEqual({ path: 'a/b.agent', line: 12 });
  expect(parseStudioFocus({ apiName: 'Refund_Flow', tool: 'actions' })).toEqual({ apiName: 'Refund_Flow', tool: 'actions' });
  expect(parseStudioFocus({ apiName: 'Order.lookup', tool: 'actions', readOnly: '1' })).toEqual({ apiName: 'Order.lookup', tool: 'actions', readOnly: true });
  expect(parseStudioFocus({ line: '7', readOnly: true })).toEqual({ line: 7, readOnly: true });
  expect(parseStudioFocus({ readOnly: 'true' }).readOnly).toBe(true);
  expect(parseStudioFocus({ path: 'a.agent', nonce: 3 })).toEqual({ path: 'a.agent', nonce: 3 });
});

it('ignores malformed params', () => {
  for (const params of [null, undefined, 'x', 4, [], { path: '' }, { path: 'x'.repeat(501) }, { line: 0 }, { line: -3 }, { line: 'abc' }, { line: 1.5 }, { apiName: '1bad' }, { apiName: 'a;b' }, { tool: 'nope' }, { readOnly: '0' }, { nonce: 0 }, { nonce: '2' }, { nonce: 1.5 }]) {
    expect(parseStudioFocus(params)).toEqual({});
  }
});

it('keys focus by every field', () => {
  expect(focusKey({})).toBe(focusKey({}));
  expect(focusKey({ path: 'a' })).not.toBe(focusKey({ path: 'b' }));
  expect(focusKey({ line: 2 })).not.toBe(focusKey({ line: 3 }));
  expect(focusKey({ readOnly: true })).not.toBe(focusKey({}));
  expect(focusKey({ path: 'a', nonce: 1 })).not.toBe(focusKey({ path: 'a', nonce: 2 }));
});
