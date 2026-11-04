import { expect, it } from 'vitest';
import { computerLabel } from './computer-label.js';

it.each([
  ['Work Mac', 'Work Mac'], ['  Personal Mac  ', 'Personal Mac'], ['work-mac.internal.example.com', 'work-mac'],
  ['DEVBOX.local', 'DEVBOX'], ['devbox', 'devbox'], ['Mac v2.1', 'Mac v2.1'], ['', 'Unnamed computer'], ['   ', 'Unnamed computer']
])('displays %s as %s without changing its identity', (name, label) => { expect(computerLabel(name)).toBe(label); });
