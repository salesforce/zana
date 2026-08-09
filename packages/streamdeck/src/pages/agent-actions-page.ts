/**
 * Per-agent action overlay, pushed when an agent tile is pressed. Each key is an
 * explicit control-plane intent addressed at THIS agent — the "click to interact"
 * the showcase did with synthetic keystrokes, done here as a typed RPC.
 *
 * Approve/Deny/Continue use `term.reply` (inject text at the agent's prompt —
 * the path for answering a blocked permission prompt). "Ping" uses `agent.send`
 * (a peer message). "Open" uses `agent.focus` — pure UI, it reveals this agent's
 * modal in the desktop app so a press pulls your eyes to the session. Back pops
 * the overlay.
 *
 * The action set is STATE-AWARE: a key is offered only when it would actually do
 * something for the agent's current state, so the overlay never shows a button
 * that's a no-op (or worse, mis-injects) right now:
 *  - Approve / Deny / Continue answer a prompt → only when the agent is `blocked`.
 *  - Ping is a peer poke → only for a live agent (`working` / `idle`); pointless
 *    for `done`/`unknown`, and skipped when `blocked` so "status?" can't land as
 *    the answer to the pending prompt.
 *  - Open in app is pure presentation and always valid, so it's always shown.
 */

import { type Page } from '../deck/page.js';
import { XL, type Geometry } from '../deck/device.js';
import { buildOverlay, type TileSpec } from '../deck/layout.js';
import { composeTile } from '../deck/renderer.js';
import { agentLabel, stateToDeckStatus, type AgentListItem } from '../lib/types.js';
import type { GlyphName } from '../deck/glyphs.js';
import type { ActionQueue } from '../lib/actions.js';

export interface AgentActionsDeps {
  queue: ActionQueue;
  back: () => void;
  geom?: Geometry;
}

export function buildAgentActionsPage(agent: AgentListItem, deps: AgentActionsDeps): Page {
  const { queue, back } = deps;
  const geom = deps.geom ?? XL;
  const size = geom.keyPx; // native key px (undefined → renderer defaults to 96)
  const status = stateToDeckStatus(agent.state);

  const reply = (label: string, text: string, icon: GlyphName): TileSpec => ({
    render: () => composeTile({ status: 'idle', caption: label, icon, size }),
    onPress: () => queue.enqueue({ kind: 'reply' as const, sessionId: agent.sessionId, text })
  });

  // Reply primitives only mean something at a prompt → gate on `blocked`.
  const canReply = agent.state === 'blocked';
  // Ping is a live poke: skip it when the agent is at a prompt (`blocked`) or no
  // longer live (`done`/`unknown`).
  const canPing = agent.state === 'working' || agent.state === 'idle';

  const actions: TileSpec[] = [];
  if (canReply) {
    actions.push(
      reply('Approve', 'y\n', 'approve'),
      reply('Deny', 'n\n', 'deny'),
      reply('Continue', '\n', 'continue')
    );
  }
  if (canPing) {
    actions.push({
      render: () => composeTile({ status: 'idle', caption: 'Ping', icon: 'ping', size }),
      onPress: () =>
        queue.enqueue({ kind: 'send', to: agent.handle ?? agent.sessionId, message: 'status?' })
    });
  }
  // Reveal this agent's modal in the desktop app (bring window forward) — always
  // valid, so always offered.
  actions.push({
    render: () => composeTile({ status: 'idle', caption: 'Open in app', icon: 'open', size }),
    onPress: () =>
      queue.enqueue({ kind: 'focus', sessionId: agent.sessionId, projectId: agent.projectId })
  });

  return buildOverlay({
    name: 'agent_actions',
    geom,
    // Header: the agent this overlay targets — the robot mark (same glyph the
    // grid tile wears) + label + live status. Static tile.
    header: { render: () => composeTile({ status, caption: agentLabel(agent), icon: 'agents', pressable: false, size }) },
    // Actions flow from row 1, offered per the agent's current state (see above).
    actions,
    back: { render: () => composeTile({ status: 'idle', caption: 'Back', icon: 'back', size }), onPress: back }
  });
}
