import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { liveEnabled, isSkip, preflightOrSkip } from '../src/matrix.js';
import { Zcc } from '../src/client.js';

const enabled = liveEnabled();
const TOOL_NAME = 'ask_user_question';
const BRIDGE_NAME = `mcp__bb-bridge__${TOOL_NAME}`;
const PLUGIN_ID = 'ask-user-question';
const TIMEOUT_MS = 120_000;

function isPluginAskInteraction(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const origin = (value as { origin?: { kind?: unknown; pluginId?: unknown; rendererId?: unknown } }).origin;
  return origin?.kind === 'plugin'
    && (origin.pluginId === PLUGIN_ID || origin.rendererId === PLUGIN_ID);
}

function isRegisterToolCall(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  const item = rec.item && typeof rec.item === 'object' ? rec.item as Record<string, unknown> : rec;
  const type = String(item.type ?? rec.type ?? rec.itemType ?? rec.kind ?? '');
  const tool = String(item.tool ?? item.name ?? rec.tool ?? rec.toolName ?? '');
  const title = String(item.title ?? rec.title ?? '');
  const isTool = /toolcall/i.test(type) || type === 'tool';
  if (!isTool) return false;
  return tool === TOOL_NAME
    || tool === BRIDGE_NAME
    || tool.endsWith(`__${TOOL_NAME}`)
    || title.includes('bb-bridge MCP Server');
}

function mentionsRegisterTool(value: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    if (isPluginAskInteraction(node) || isRegisterToolCall(node)) return true;
    if (Array.isArray(node)) return node.some(walk);
    return Object.values(node).some(walk);
  };
  return walk(value);
}

async function loadPlugins(zcc: Zcc): Promise<Array<{ id?: string; status?: string }>> {
  const listed = await zcc.http.request<{ plugins?: Array<{ id?: string; status?: string }> } | Array<{ id?: string; status?: string }>>(
    'GET',
    '/api/v1/plugins'
  );
  return Array.isArray(listed) ? listed : listed.plugins ?? [];
}

describe.skipIf(!enabled)('live registerTool via bb-bridge', () => {
  it('spawns a conversation thread that calls ask_user_question', async () => {
    const zcc = await Zcc.connect();
    try {
      const plugins = await loadPlugins(zcc);
      const plugin = plugins.find((row) => row.id === PLUGIN_ID);
      if (plugin?.status !== 'running') {
        console.warn(
          `[live] skip registerTool: plugin "${PLUGIN_ID}" is ${plugin?.status ?? 'missing'}`
        );
        return;
      }
      const pre = await preflightOrSkip(zcc, { surface: 'thread', providerId: 'claude-code' });
      if (isSkip(pre)) {
        console.warn(`[live] skip registerTool: ${pre.reason}`);
        return;
      }
      const project = await zcc.projects.ensureLiveSandbox();
      const thread = await zcc.threads.spawn({
        projectId: project.id,
        prompt: [
          `You must call the tool named ${TOOL_NAME} exactly once.`,
          'Ask one multiple-choice question with options ping and pong.',
          'Do not guess. Do not answer in prose. Do not call any other tool first.'
        ].join(' '),
        providerId: 'claude-code',
        permissionMode: 'accept-edits',
        visibility: 'hidden'
      });
      const deadline = Date.now() + TIMEOUT_MS;
      let seen: unknown = null;
      while (Date.now() < deadline) {
        const row = await thread.refresh();
        if (row.status === 'error') {
          throw new ControlError('UNHEALTHY', `thread ${thread.id} entered error before ${TOOL_NAME}`, {
            details: row
          });
        }
        const [timeline, interactions, events] = await Promise.all([
          thread.timeline().catch(() => null),
          thread.interactions().catch(() => []),
          zcc.http.request('GET', `/api/v1/threads/${encodeURIComponent(thread.id)}/events`).catch(() => null)
        ]);
        const snapshot = { timeline, interactions, events };
        if (mentionsRegisterTool(snapshot)) {
          seen = snapshot;
          break;
        }
        await zcc.http.sleep(1_000);
      }
      expect(seen, `thread ${thread.id} never invoked ${TOOL_NAME} / ${BRIDGE_NAME}`).toBeTruthy();
      await thread.stop();
    } finally {
      await zcc.close();
    }
  });
});

describe.skipIf(enabled)('live registerTool via bb-bridge (gated)', () => {
  it('does not run without ZCC_LIVE_CONTROL=1', () => {
    expect(liveEnabled()).toBe(false);
  });
});
