import { describe, expect, it } from 'vitest';
import { stableDraftJson } from './stable-draft-json.js';

describe('stableDraftJson', () => {
  it('sorts nested object keys but preserves array order', () => {
    expect(stableDraftJson({ z: { b: 2, a: 1 }, slots: [{ second: 2, first: 1 }, 'later'] }))
      .toBe(stableDraftJson({ slots: [{ first: 1, second: 2 }, 'later'], z: { a: 1, b: 2 } }));
    expect(stableDraftJson({ slots: ['first', 'second'] })).not.toBe(stableDraftJson({ slots: ['second', 'first'] }));
  });

  it('omits undefined object fields and preserves meaningful primitive values', () => {
    expect(stableDraftJson({ name: 'Draft', ignored: undefined, nested: { skipped: undefined, kept: '' } }))
      .toBe('{"name":"Draft","nested":{"kept":""}}');
    expect(stableDraftJson({ enabled: false, empty: '', value: null }))
      .toBe('{"empty":"","enabled":false,"value":null}');
    expect(stableDraftJson([undefined, false, null, ''])).toBe('[null,false,null,""]');
  });
});
