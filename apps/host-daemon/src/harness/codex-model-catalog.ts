import { spawn } from 'node:child_process';
import type { HarnessModelTarget } from '@zana-ai/zcc-domain/harness-adapter';

interface CodexModelListResult {
  data?: Array<{ id?: unknown; displayName?: unknown; hidden?: unknown; isDefault?: unknown }>;
}

const REQUEST_TIMEOUT_MS = 8_000;
const cache = new Map<string, readonly HarnessModelTarget[]>();

export function codexModelsFromResponse(result: CodexModelListResult): readonly HarnessModelTarget[] {
  const candidates: Array<HarnessModelTarget & { isDefault: boolean }> = (result.data ?? []).flatMap((model) =>
    typeof model.id === 'string' && model.id && model.hidden !== true
      ? [{
          id: model.id,
          label: typeof model.displayName === 'string' ? model.displayName : model.id,
          scope: ['local'] as HarnessModelTarget['scope'],
          isDefault: model.isDefault === true
        }]
      : []
  );
  return candidates
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
    .map(({ isDefault: _, ...model }) => model);
}

export async function discoverCodexModels(binary: string, cacheKey = binary): Promise<readonly HarnessModelTarget[]> {
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const models = await new Promise<readonly HarnessModelTarget[]>((resolve) => {
    const child = spawn(binary, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    let settled = false;
    const finish = (value: readonly HarnessModelTarget[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolve(value);
    };
    const send = (id: number, method: string, params: object) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    };
    const timeout = setTimeout(() => finish([]), REQUEST_TIMEOUT_MS);
    child.once('error', () => finish([]));
    child.once('exit', () => finish([]));
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line) as { id?: number; result?: CodexModelListResult };
          if (message.id === 1) {
            send(2, 'model/list', { includeHidden: false, limit: 100 });
          } else if (message.id === 2) {
            finish(codexModelsFromResponse(message.result ?? {}));
          }
        } catch {
          // Ignore non-protocol output. Only a valid response can populate the catalog.
        }
      }
    });
    send(1, 'initialize', { clientInfo: { name: 'zana-command-center', version: '1.0' }, capabilities: {} });
  });
  if (models.length) cache.set(cacheKey, models);
  return models;
}
