import type { AgentScriptDialect } from '../../lib/types.js';

const STORAGE = 'salesforce.agent-drafts.v1';
const SELECTIONS = 'salesforce.agent-selections.v1';
// Recovery lives in localStorage (a few MB per origin), so it stays well below AGENT_SOURCE_MAX.
export const MAX_AGENT_DRAFT = 1_000_000;
// UTF-16 storage plus JSON escaping must fit the shared origin's quota. Keep
// newest drafts in a single bounded write, without ever trimming their content.
export const MAX_AGENT_DRAFT_STORAGE = 2_000_000;
export type AgentDraft = { key: string; content: string; baseSha?: string; dialect: AgentScriptDialect };
// The shared origin lets the iframe save synchronously on each edit, including
// the last keystroke before its parent is unmounted. Never persist a truncated draft.
function drafts(): AgentDraft[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    return Array.isArray(value) ? value.filter(row => row && typeof row.key === 'string' && typeof row.content === 'string' && row.content.length <= MAX_AGENT_DRAFT && ['agentforce', 'agentscript'].includes(row.dialect) && (row.baseSha === undefined || typeof row.baseSha === 'string')).slice(0, 12) : [];
  } catch { return []; }
}
export function agentDraftKey(project: string, identity: string) { return `${project}:${identity}`; }
export function readAgentDraft(key: string) { return drafts().find(row => row.key === key); }
export function writeAgentDraft(draft: AgentDraft): boolean {
  if (draft.content.length > MAX_AGENT_DRAFT) return false;
  try {
    const next = [draft];
    if (JSON.stringify(next).length > MAX_AGENT_DRAFT_STORAGE) return false;
    for (const prior of drafts().filter(row => row.key !== draft.key)) {
      if (next.length >= 12) break;
      if (JSON.stringify([...next, prior]).length <= MAX_AGENT_DRAFT_STORAGE) next.push(prior);
    }
    localStorage.setItem(STORAGE, JSON.stringify(next));
    return true;
  }
  catch { return false; }
}
export function clearAgentDraft(key: string) {
  try { localStorage.setItem(STORAGE, JSON.stringify(drafts().filter(row => row.key !== key))); } catch { /* Keep editing available. */ }
}
export function rememberAgentSelection(project: string, identity: string) {
  try {
    const prior: unknown = JSON.parse(localStorage.getItem(SELECTIONS) || '[]');
    const valid = Array.isArray(prior) ? prior.filter(row => typeof row?.project === 'string' && typeof row?.identity === 'string' && row.project !== project) : [];
    localStorage.setItem(SELECTIONS, JSON.stringify([{ project, identity }, ...valid].slice(0, 30)));
  } catch { /* Selection is advisory. */ }
}
export function recalledAgentSelection(project: string): string | undefined {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(SELECTIONS) || '[]');
    const identity = Array.isArray(rows) ? rows.find(row => row?.project === project)?.identity : undefined;
    return typeof identity === 'string' ? identity : undefined;
  } catch { return undefined; }
}
