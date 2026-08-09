/**
 * State-aware agent overlay: the action keys offered depend on the agent's live
 * state, so a button never shows when it'd be a no-op (or mis-inject) right now.
 *  - Approve / Deny / Continue answer a prompt → only when `blocked`.
 *  - Ping is a live poke → only for `working` / `idle`.
 *  - Open in app is pure presentation → always shown.
 * We inspect the rendered tiles' `label` hint (set by composeTile) to read the
 * action set off the built Page without a device.
 */

import { describe, it, expect } from 'vitest';

import { buildAgentActionsPage } from '../pages/agent-actions-page.js';
import { XL } from '../deck/device.js';
import type { AgentListItem, AgentState } from '../lib/types.js';
import type { ActionQueue } from '../lib/actions.js';

const base: AgentListItem = {
  sessionId: 's-1',
  projectId: 'p-1',
  handle: 'reviewer',
  cwd: '/tmp/proj',
  state: 'idle'
};

// The overlay only enqueues on press; a no-op queue is enough to build the page.
const queue = { enqueue: () => {} } as unknown as ActionQueue;

/** The visible action labels (rows 1..lastRow-1), excluding the header + Back. */
function actionLabels(state: AgentState): string[] {
  const page = buildAgentActionsPage({ ...base, state }, { queue, back: () => {}, geom: XL });
  const labels: string[] = [];
  for (let row = 1; row < XL.rows - 1; row += 1) {
    for (let col = 0; col < XL.cols; col += 1) {
      const key = page.get(col, row);
      if (key) labels.push(key.render().label ?? '');
    }
  }
  return labels;
}

describe('agent actions overlay — header', () => {
  it('wears the robot (agents) glyph so the overlay is identifiably an agent', () => {
    const page = buildAgentActionsPage({ ...base, state: 'blocked' }, { queue, back: () => {}, geom: XL });
    const header = page.get(0, 0)!.render();
    expect(header.icon).toBe('agents');
    expect(header.label).toBe('reviewer');
  });
});

describe('agent actions overlay — state-gated keys', () => {
  it('offers Approve/Deny/Continue only when blocked', () => {
    expect(actionLabels('blocked')).toEqual(['Approve', 'Deny', 'Continue', 'Open in app']);
  });

  it('offers Ping (not the reply keys) for a live working agent', () => {
    expect(actionLabels('working')).toEqual(['Ping', 'Open in app']);
  });

  it('offers Ping for an idle agent', () => {
    expect(actionLabels('idle')).toEqual(['Ping', 'Open in app']);
  });

  it('offers only Open in app when done (no reply, no ping)', () => {
    expect(actionLabels('done')).toEqual(['Open in app']);
  });

  it('offers only Open in app when unknown/stale', () => {
    expect(actionLabels('unknown')).toEqual(['Open in app']);
  });
});
