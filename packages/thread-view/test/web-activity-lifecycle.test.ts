import { describe, expect, it } from 'vitest';
import { parseWebActivityLifecycleEvent } from '../src/web-activity-lifecycle.js';
import type { ThreadEvent } from '@zana-ai/zcc-domain/thread-runtime';

describe('parseWebActivityLifecycleEvent', () => {
  it('maps fileRead, search, planSteps, and extension items', () => {
    const fileRead = parseWebActivityLifecycleEvent({
      type: 'item/started',
      item: {
        type: 'fileRead',
        id: 'r1',
        path: 'src/a.ts',
        status: 'pending'
      }
    } as ThreadEvent);
    expect(fileRead).toMatchObject({ itemKind: 'file-read', path: 'src/a.ts', callId: 'r1' });

    const search = parseWebActivityLifecycleEvent({
      type: 'item/completed',
      item: {
        type: 'search',
        id: 's1',
        mode: 'content',
        query: 'foo',
        status: 'completed'
      }
    } as ThreadEvent);
    expect(search).toMatchObject({ itemKind: 'search', query: 'foo', mode: 'content' });

    const plan = parseWebActivityLifecycleEvent({
      type: 'item/started',
      item: {
        type: 'planSteps',
        id: 'p1',
        steps: [{ step: 'One' }],
        status: 'pending'
      }
    } as ThreadEvent);
    expect(plan).toMatchObject({ itemKind: 'plan-steps' });

    const extension = parseWebActivityLifecycleEvent({
      type: 'item/completed',
      item: {
        type: 'extension',
        id: 'e1',
        kind: 'demo/card',
        payload: { ok: true },
        status: 'completed',
        presentation: {
          label: { pending: 'Showing', completed: 'Showed' },
          icon: { glyph: 'Puzzle' }
        }
      }
    } as ThreadEvent);
    expect(extension).toMatchObject({ itemKind: 'extension', extensionKind: 'demo/card' });
  });
});
