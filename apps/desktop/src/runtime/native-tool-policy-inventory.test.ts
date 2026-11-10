import { describe, it, expect } from 'vitest';
import { inventoryDemandsVeto } from './native-tool-policy.js';

describe('inventoryDemandsVeto', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a number', 3],
    ['an empty object', {}],
    ['required: null', { required: null }],
    ['required: object', { required: {} }],
    ['required: string', { required: 'x' }]
  ])('fails closed for a torn inventory (%s)', (_name, inventory) => {
    expect(inventoryDemandsVeto(inventory)).toBe(true);
  });

  it('demands the veto when a plugin is required', () => {
    expect(inventoryDemandsVeto({ required: ['p'] })).toBe(true);
  });

  it('demands nothing only for a well-formed empty list', () => {
    expect(inventoryDemandsVeto({ required: [] })).toBe(false);
  });
});
