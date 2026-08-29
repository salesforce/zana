import { spawn } from 'node:child_process';
import type { HarnessModelTarget } from '@zana-ai/zcc-domain/harness-adapter';

const REQUEST_TIMEOUT_MS = 8_000;
const MODEL_LINE_PATTERN = /^(\S+) - (.+)$/;
const EFFORT_TOKENS = [
  'extra-high',
  'medium',
  'xhigh',
  'high',
  'low',
  'max',
  'none'
] as const;
const FAST_TAIL = '-fast';
const THINKING_TOKEN = 'thinking';
const cache = new Map<string, readonly HarnessModelTarget[]>();

export function cursorModelsFromListOutput(stdout: string): readonly HarnessModelTarget[] {
  const families = new Map<string, Array<{ id: string; label: string; effort: string | undefined }>>();
  for (const line of stdout.split('\n')) {
    const match = MODEL_LINE_PATTERN.exec(line.trim());
    if (!match) continue;
    const [, id, displayName] = match;
    const { familyKey, effort } = splitCursorVariant(id);
    const members = families.get(familyKey) ?? [];
    members.push({ id, label: cleanCursorDisplayName(displayName, effort), effort });
    families.set(familyKey, members);
  }
  return [...families.values()].flatMap((members) => {
    const chosen =
      members.find((member) => member.effort === 'medium')
      ?? members.find((member) => member.effort !== 'none')
      ?? members[0];
    return chosen
      ? [{ id: chosen.id, label: chosen.label, scope: ['local'] as const }]
      : [];
  });
}

export async function discoverCursorModels(binary: string, cacheKey = binary): Promise<readonly HarnessModelTarget[]> {
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const models = await new Promise<readonly HarnessModelTarget[]>((resolve) => {
    const child = spawn(binary, ['--list-models'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    let settled = false;
    const finish = (value: readonly HarnessModelTarget[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolve(value);
    };
    const timeout = setTimeout(() => finish([]), REQUEST_TIMEOUT_MS);
    child.once('error', () => finish([]));
    child.once('exit', () => finish(cursorModelsFromListOutput(stdout)));
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
  });
  if (models.length) cache.set(cacheKey, models);
  return models;
}

function splitCursorVariant(id: string): { familyKey: string; effort: string | undefined } {
  let rest = id;
  if (rest.endsWith(FAST_TAIL)) rest = rest.slice(0, -FAST_TAIL.length);
  if (rest.endsWith(`-${THINKING_TOKEN}`)) {
    rest = rest.slice(0, -(THINKING_TOKEN.length + 1));
  } else if (rest.includes(`-${THINKING_TOKEN}-`)) {
    rest = rest.replace(`-${THINKING_TOKEN}-`, '-');
  }
  for (const token of EFFORT_TOKENS) {
    if (rest.endsWith(`-${token}`)) {
      return { familyKey: rest.slice(0, -(token.length + 1)), effort: token };
    }
  }
  return { familyKey: rest, effort: undefined };
}

function cleanCursorDisplayName(name: string, effort: string | undefined): string {
  const effortWord = effortDisplayWord(effort);
  const stripped = effortWord
    ? name.replace(new RegExp(`(^|\\s)${effortWord}(?=\\s|$)`), '$1')
    : name;
  return stripped
    .replace(/\s*\((?:NO ZDR|default|current)\)/gi, '')
    .replace(/(^|\s)(?:1M|Thinking)(?=\s|$)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function effortDisplayWord(effort: string | undefined): string | undefined {
  if (!effort) return undefined;
  if (effort === 'extra-high' || effort === 'xhigh') return 'Extra High';
  if (effort === 'medium') return 'Medium';
  if (effort === 'high') return 'High';
  if (effort === 'low') return 'Low';
  if (effort === 'max') return 'Max';
  if (effort === 'none') return 'None';
  return undefined;
}
