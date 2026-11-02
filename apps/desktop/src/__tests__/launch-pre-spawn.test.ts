import { describe, expect, it } from 'vitest';
import { isPreSpawnRefusal } from '../launch-pre-spawn.js';

describe('isPreSpawnRefusal', () => {
  it('is true only for preSpawn === true', () => {
    expect(isPreSpawnRefusal(Object.assign(new Error('x'), { preSpawn: true }))).toBe(true);
  });
  it.each([[new Error('x')], [Object.assign(new Error('x'), { preSpawn: false })], [Object.assign(new Error('x'), { preSpawn: 'true' })], [null], [undefined], ['str'], [42]])(
    'is false for %s',
    (value) => expect(isPreSpawnRefusal(value)).toBe(false)
  );
});
