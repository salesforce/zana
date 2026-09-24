import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectCwd } from '@zana-ai/zcc-domain/path-encoding';
import { NativeConversationIndex, parseNativeTranscript } from './native-conversation-index.js';

let home: string; let project: string; let indexPath: string; let index: NativeConversationIndex;
const id = '12345678-1234-1234-1234-123456789012';
const otherId = '12345678-1234-1234-1234-123456789013';
const lines = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'native-history-')); project = join(home, 'project');
  await mkdir(project); indexPath = join(home, '.zcc', 'history.json'); index = new NativeConversationIndex(home, indexPath);
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
async function claude(cwd = project, uuid = id, extra = '') {
  const path = join(home, '.claude', 'projects', encodeProjectCwd(project), `${uuid}.jsonl`);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, lines({ cwd, message: { role: 'user', content: 'Find the history' } }, { message: { role: 'assistant', content: [{ type: 'text', text: 'Here it is' }, { type: 'tool_use', input: 'secret tool payload' }] } }, { type: 'custom-title', customTitle: 'Saved title' }) + extra);
  return path;
}
async function codex(cwd = project, uuid = id) {
  const path = join(home, '.codex', 'sessions', '2026', '09', '22', `rollout-${uuid}.jsonl`);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, lines({ type: 'session_meta', payload: { id: uuid, cwd } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue my Codex work' }] } }, { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Saved answer' }] } }));
  return path;
}

it('indexes native stores across a restart, preserves titles and reads text without tool/system payloads', async () => {
  await claude(); await codex();
  expect((await index.list('claude', project, 40))[0]).toMatchObject({ id, title: 'Saved title' });
  expect((await index.list('codex', project, 40))[0].title).toBe('Continue my Codex work');
  expect((await index.transcript('claude', project, id)).messages).toEqual([{ role: 'user', text: 'Find the history' }, { role: 'assistant', text: 'Here it is' }]);
  const restarted = new NativeConversationIndex(home, indexPath);
  expect((await restarted.list('codex', project, 40))[0].id).toBe(id);
  expect((await restarted.transcript('codex', project, id)).messages[1].text).toBe('Saved answer');
  expect((await stat(indexPath)).mode & 0o777).toBe(0o600);
  expect(await readFile(indexPath, 'utf8')).not.toContain('Saved answer');
});

it('rejects cross-project transcripts, changed identities, missing files and native-store escapes', async () => {
  const other = join(home, 'other'); await mkdir(other);
  const path = await claude(other);
  expect(await index.list('claude', project, 40)).toEqual([]);
  const codexPath = await codex();
  await index.list('codex', project, 40);
  expect((await index.transcript('codex', other, id)).unavailableReason).toBeTruthy();
  await codex(other);
  expect((await index.transcript('codex', project, id)).unavailableReason).toBeTruthy();
  await rm(codexPath);
  expect((await index.transcript('codex', project, id)).unavailableReason).toBeTruthy();
  await symlink(path, codexPath);
  expect((await index.transcript('codex', project, id)).unavailableReason).toBeTruthy();
});

it('ignores symlink entries, malformed metadata and corrupt indexes, and handles absent native stores', async () => {
  expect(await index.list('codex', project, 40)).toEqual([]);
  await writeFile(indexPath, 'broken');
  const path = await claude();
  await symlink(path, path.replace(id, otherId));
  await writeFile(path.replace(id, 'bad-id'), '{bad json}\n');
  const rebuilt = new NativeConversationIndex(home, indexPath);
  expect(await rebuilt.list('claude', project, 40)).toHaveLength(1);
  expect((await rebuilt.transcript('claude', project, 'missing')).unavailableReason).toBeTruthy();
});

it('serializes concurrent indexing, applies limits and reuses a fresh scan', async () => {
  await claude(); await claude(project, otherId); await codex();
  const [a, b] = await Promise.all([index.list('claude', project, 1), index.list('codex', project, 40)]);
  expect(a).toHaveLength(1); expect(b).toHaveLength(1);
  expect(await index.list('claude', project, 40)).toHaveLength(2);
  expect(JSON.parse(await readFile(indexPath, 'utf8'))).toHaveLength(3);
});

it('bounds large previews, skips malformed lines and caps message text', async () => {
  const path = await claude(project, id, lines({ message: { role: 'assistant', content: 'x'.repeat(80_000) } }) + lines({ unused: 'x'.repeat(4 * 1024 * 1024) }));
  await index.list('claude', project, 40);
  const preview = await index.transcript('claude', project, id);
  expect(preview.truncated).toBe(true); expect(preview.messages[2].text.length).toBe(64_000);
  expect(preview.messages[0].text).toBe('Find the history');
  expect(parseNativeTranscript('codex', 'broken\n' + lines({ type: 'event_msg', payload: { message: 'duplicate' } }, { type: 'response_item', payload: { type: 'message', role: 'system', content: 'hidden' } }))).toEqual({ messages: [], truncated: false });
  expect(parseNativeTranscript('claude', Array.from({ length: 501 }, () => lines({ message: { role: 'user', content: 'text' } })).join('')).messages).toHaveLength(500);
  await rm(path);
});

it('uses human Codex input once and omits injected context from conversation titles', () => {
  const transcript = lines(
    { type: 'response_item', payload: { type: 'message', role: 'user', content: '<environment_context>context</environment_context>' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Actual request' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Actual request' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'Answer' } }
  );
  expect(parseNativeTranscript('codex', transcript).messages).toEqual([{ role: 'user', text: 'Actual request' }, { role: 'assistant', text: 'Answer' }]);
  expect(parseNativeTranscript('codex', lines({ type: 'response_item', payload: { type: 'message', role: 'user', content: '# AGENTS.md instructions for project' } })).messages).toEqual([]);
  expect(parseNativeTranscript('claude', lines({ isMeta: true, message: { role: 'user', content: 'injected context' } })).messages).toEqual([]);
});
