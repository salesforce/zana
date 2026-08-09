/**
 * Project spawn overlay: one spawn button per profile the app reports via
 * `harness.list`, a yolo variant styled as an "attention" tile, and a
 * claude/claude-yolo fallback when no profiles are supplied (an app too old to
 * know the op). We read the built Page's tiles without a device.
 */

import { describe, it, expect, vi } from 'vitest';

import { buildProjectActionsPage } from '../pages/project-actions-page.js';
import { XL } from '../deck/device.js';
import { ActionQueue } from '../lib/actions.js';
import { FALLBACK_SPAWN_PROFILES, type ProjectItem, type SpawnProfileInfo } from '../lib/types.js';

const PROJECT: ProjectItem = { id: 'p-1', name: 'demo', path: '/tmp/p', tag: 'demo' };

// A queue whose source records the spawn intent instead of hitting a socket.
const makeQueue = () => {
  const spawned: { projectId: string; profile: string }[] = [];
  const source = {
    spawnAgent: (projectId: string, profile: string) => {
      spawned.push({ projectId, profile });
      return Promise.resolve({ ok: true as const });
    }
  };
  const queue = new ActionQueue(source as never, () => {});
  return { queue, spawned };
};

// Overlay actions flow row-major from row 1; index i → (i % cols, 1 + …).
const actionKey = (page: ReturnType<typeof buildProjectActionsPage>, i: number) => {
  const col = i % XL.cols;
  const row = 1 + Math.floor(i / XL.cols);
  return page.get(col, row)!;
};

describe('project spawn overlay', () => {
  it('renders one spawn button per supplied profile, yolo as attention', () => {
    const profiles: SpawnProfileInfo[] = [
      { id: 'claude', family: 'claude', label: 'Claude', yolo: false },
      { id: 'claude-yolo', family: 'claude', label: 'Claude Yolo', yolo: true },
      { id: 'codex', family: 'codex', label: 'Codex', yolo: false }
    ];
    const { queue } = makeQueue();
    const page = buildProjectActionsPage(PROJECT, { queue, back: () => {}, geom: XL, profiles });

    expect(actionKey(page, 0).render().label).toBe('+ Claude');
    expect(actionKey(page, 0).render().status).toBe('idle');
    expect(actionKey(page, 1).render().label).toBe('+ Claude Yolo');
    expect(actionKey(page, 1).render().status).toBe('attention'); // yolo stands out
    expect(actionKey(page, 2).render().label).toBe('+ Codex');
  });

  it('falls back to claude/claude-yolo when no profiles are supplied', () => {
    const { queue } = makeQueue();
    const page = buildProjectActionsPage(PROJECT, { queue, back: () => {}, geom: XL });
    expect(FALLBACK_SPAWN_PROFILES.map((p) => p.id)).toEqual(['claude', 'claude-yolo']);
    expect(actionKey(page, 0).render().label).toBe('+ Claude');
    expect(actionKey(page, 1).render().label).toBe('+ Claude Yolo');
    expect(actionKey(page, 2)).toBeUndefined(); // only the two fallbacks
  });

  it('a spawn press enqueues term.create with that profile id', async () => {
    const profiles: SpawnProfileInfo[] = [
      { id: 'claude', family: 'claude', label: 'Claude', yolo: false },
      { id: 'codex', family: 'codex', label: 'Codex', yolo: false }
    ];
    const { queue, spawned } = makeQueue();
    const page = buildProjectActionsPage(PROJECT, { queue, back: () => {}, geom: XL, profiles });

    actionKey(page, 1).onPress!(); // press "+ Codex"
    await vi.waitFor(() => {
      expect(spawned).toContainEqual({ projectId: 'p-1', profile: 'codex' });
    });
  });
});
