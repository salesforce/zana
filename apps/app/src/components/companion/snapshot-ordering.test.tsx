// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CompanionSnapshot } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ request: vi.fn(), onSnapshot: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { companion: h } }));
import { EMPTY_SNAPSHOT, useCompanion } from './useCompanion.js';

afterEach(cleanup);

it('audit regression: an older initial snapshot cannot overwrite a newer push', async () => {
  let resolve!: (snapshot: CompanionSnapshot) => void;
  let push!: (snapshot: CompanionSnapshot) => void;
  h.request.mockReturnValue(new Promise(r => { resolve = r; }));
  h.onSnapshot.mockImplementation(cb => { push = cb; return () => {}; });
  const { result } = renderHook(() => useCompanion());
  act(() => push({ ...EMPTY_SNAPSHOT, userInitials: 'NEW' }));
  await act(async () => resolve({ ...EMPTY_SNAPSHOT, userInitials: 'OLD' }));
  expect(result.current.snapshot.userInitials).toBe('NEW');
});
