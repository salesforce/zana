import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { promptInputSchema, type PromptInput } from '@zana-ai/zcc-domain/thread-runtime';
export interface SavedPrompt { id: string; title: string; input: PromptInput[]; createdAt: number; threadId?: string; projectId?: string; hostId?: string }
const KEY = 'starred-prompts-v1';
export function validatedPrompt(value: unknown): SavedPrompt {
  if (!value || typeof value !== 'object') throw new Error('Invalid prompt');
  const row = value as SavedPrompt;
  if (typeof row.id !== 'string' || !row.id || row.id.length > 100 || !Array.isArray(row.input) || row.input.length > 100) throw new Error('Invalid prompt');
  const input = row.input.map(part => promptInputSchema.parse(part));
  const text = input.filter(part => part.type === 'text').map(part => part.text).join('\n');
  if (!input.length || JSON.stringify(input).length > 32000) throw new Error('Prompt is empty or too large');
  return { id: row.id, title: text.slice(0, 160) || 'Attachments', input, createdAt: Number.isSafeInteger(row.createdAt) ? row.createdAt : Date.now(),
    ...Object.fromEntries(['threadId', 'projectId', 'hostId'].flatMap(key => typeof row[key as keyof SavedPrompt] === 'string' ? [[key, String(row[key as keyof SavedPrompt]).slice(0,100)]] : [])) };
}
export default function plugin(api: ZccPluginApi) {
  let writes = Promise.resolve();
  const read = async (): Promise<SavedPrompt[]> => {
    const rows = await api.storage.kv.get<unknown>(KEY);
    return Array.isArray(rows) ? rows.slice(0,100).flatMap(row => { try { return [validatedPrompt(row)]; } catch { return []; } }) : [];
  };
  const mutate = (change: (rows: SavedPrompt[]) => SavedPrompt[]) => {
    const next = writes.then(async () => {
      const rows = change(await read());
      while (rows.length > 100 || new TextEncoder().encode(JSON.stringify(rows)).byteLength > 240000) rows.pop();
      await api.storage.kv.set(KEY, rows);
      return { entries: rows };
    });
    writes = next.then(() => {}, () => {});
    return next;
  };
  api.rpc.register({ methods: ['list', 'star', 'remove', 'history'] }, {
    async list() { await writes; return { entries: await read() }; },
    star(args: unknown) { const row = validatedPrompt(args); return mutate(rows => [row, ...rows.filter(item => item.id !== row.id)]); },
    remove(args: unknown) { const id = (args as { id?: unknown })?.id; if (typeof id !== 'string') throw new Error('Invalid prompt id'); return mutate(rows => rows.filter(row => row.id !== id)); },
    async history(args: unknown) {
      const request = args as { scope: 'thread' | 'project' | 'all'; threadId?: string; projectId?: string; cursor?: string; query?: string };
      const history = api.sdk.experimental_promptHistory as { list(args: typeof request): Promise<unknown> };
      const threads = api.sdk.threads as { get(args: {threadId:string}): Promise<{projectId:string}> };
      if (request.scope === 'project' && !request.projectId && request.threadId) request.projectId = (await threads.get({threadId:request.threadId})).projectId;
      return history.list(request);
    }
  });
}
