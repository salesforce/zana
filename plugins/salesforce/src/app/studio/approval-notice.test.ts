import { expect, it } from 'vitest';
import { declined } from './approval-notice.js';

it('explains each way an approval was not signed', () => {
  expect(declined('unavailable', 'ask')).toMatchObject({ tone: 'error', ask: 'ask' });
  expect(declined('unavailable')).not.toHaveProperty('ask');
  expect(declined('busy').text).toContain('Another approval');
  expect(declined('invalid').tone).toBe('error');
  expect(declined('cancelled')).toEqual({ tone: 'muted', text: 'Cancelled. Nothing changed.' });
});
