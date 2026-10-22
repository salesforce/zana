import type { PlaygroundView } from '../../lib/agent-script-chrome.js';
import type { AgentScriptDialect, PublicOrgView } from '../../lib/types.js';
import type { AgentScriptExample } from '../../lib/agent-script-model.js';
import type { AgentAction } from '../../lib/agent-action-model.js';
import { COVERAGE_LIMITS, readGraphCoverage, type GraphCoverage } from '../../lib/graph-coverage.js';
import {
  isProposalOutcome,
  isStudioComment,
  isStudioDiagnostics,
  AGENT_SOURCE_MAX,
  STUDIO_LIMITS,
  type ProposalOutcome,
  type StudioComment,
  type StudioDiagnostic
} from '../../lib/studio-contract.js';

export const PLAYGROUND_BRIDGE_SOURCE = 'zcc-salesforce-agentscript';

export interface PlaygroundFileRef {
  apiName: string;
  path: string;
  lines: number;
}

/** Languages the read-only reference editor (`?reference`) shows. */
export const REFERENCE_LANGUAGES = ['apex', 'xml', 'json', 'agentscript'] as const;
export type ReferenceLanguage = typeof REFERENCE_LANGUAGES[number];

export type PlaygroundToHost =
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'ready' }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'dirty'; dirty: boolean; draftKey?: string; baseSha?: string; persisted?: boolean }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'snapshot'; draftKey?: string; content: string; issues: number; actions?: AgentAction[]; diagnostics?: StudioDiagnostic[] }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'openAction'; id: string }
  /** "Draft cases for gaps" on the map: node labels no case reaches. */
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'draftCases'; labels: string[] }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'requestOpen'; path: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'persist'; path: string; content: string; draftKey?: string; create?: boolean }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'cursor'; line: number; column: number; selection?: { startLine: number; endLine: number; text: string } }
  | ({ source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'proposalResolved'; proposalId: string; content: string } & ProposalOutcome)
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'commentAction'; kind: 'open' | 'submit' | 'update' | 'delete'; id?: string; line: number; endLine: number; quote: string; body?: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'askSelection'; action: string; startLine: number; endLine: number; text: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'saveRequest' };

export type HostToPlayground =
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'graph'; content: string; visible: boolean; theme: 'light' | 'dark'; compact?: boolean; focus?: string; focusSeq?: number; coverage?: GraphCoverage | null; focusCase?: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'revealLine'; line: number }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'reference'; content: string; language: ReferenceLanguage; line?: number; theme: 'light' | 'dark' }
  | {
      source: typeof PLAYGROUND_BRIDGE_SOURCE;
      type: 'init';
      dialect: AgentScriptDialect;
      theme: 'light' | 'dark';
      examples: readonly AgentScriptExample[];
      files: PlaygroundFileRef[];
      saveEnabled: boolean;
      view?: PlaygroundView;
      org?: PublicOrgView | null;
    }
  | {
      source: typeof PLAYGROUND_BRIDGE_SOURCE;
      type: 'setFile';
      draftKey?: string;
      path: string | null;
      content: string;
      dialect: AgentScriptDialect;
      readOnly: boolean;
      sha256?: string;
    }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setTheme'; theme: 'light' | 'dark' }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setDialect'; dialect: AgentScriptDialect }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setView'; view: PlaygroundView }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setFiles'; files: PlaygroundFileRef[] }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setOrg'; org: PublicOrgView | null }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'saved'; sha256: string; draftKey?: string; content?: string }
  /** The open file changed on disk (an agent or another tool wrote it). */
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'fileChanged'; draftKey: string; content: string; sha256: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'flushSave'; path?: string; create?: boolean }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'proposeEdit'; proposalId: string; content: string; summary: string; actor: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'clearProposal'; proposalId: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setComments'; comments: StudioComment[] }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setHits'; lines: number[] }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setLayout'; compact: boolean }
  /**
   * Read-only follower mode (another Studio holds the edit lease). `content` is the holder's live text: shown without
   * touching this window's draft. Leaving read-only with `content` replaces the buffer as one undoable edit.
   */
  /**
   * Locks (a follower) or unlocks the editor. `content` replaces the text; `baseline` + `baseSha` re-baseline the draft on the shared
   * document's saved version (on unlock or take-over), so a later save is checked against the version that text is based on.
   */
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setReadOnly'; readOnly: boolean; content?: string; baseline?: string; baseSha?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function isPlaygroundToHost(value: unknown): value is PlaygroundToHost {
  if (!isRecord(value) || value.source !== PLAYGROUND_BRIDGE_SOURCE || typeof value.type !== 'string') {
    return false;
  }
  if (value.draftKey !== undefined && (typeof value.draftKey !== 'string' || value.draftKey.length > 2000)) return false;
  if (value.baseSha !== undefined && typeof value.baseSha !== 'string') return false;
  if (value.create !== undefined && typeof value.create !== 'boolean') return false;
  if (value.persisted !== undefined && typeof value.persisted !== 'boolean') return false;
  if (value.type === 'ready') return true;
  if (value.type === 'openAction') return typeof value.id === 'string';
  if (value.type === 'draftCases') return Array.isArray(value.labels) && value.labels.length > 0 && value.labels.length <= COVERAGE_LIMITS.names && value.labels.every(label => typeof label === 'string' && label.length > 0 && label.length <= COVERAGE_LIMITS.text);
  if (value.type === 'dirty') return typeof value.dirty === 'boolean';
  if (value.type === 'snapshot') return typeof value.content === 'string' && value.content.length <= AGENT_SOURCE_MAX && typeof value.issues === 'number' && Number.isFinite(value.issues) && (value.actions === undefined || (Array.isArray(value.actions) && value.actions.length <= 250 && value.actions.every(isAction))) && (value.diagnostics === undefined || isStudioDiagnostics(value.diagnostics, 200));
  if (value.type === 'cursor') return isPositive(value.line) && isPositive(value.column) && (value.selection === undefined || isSelection(value.selection));
  if (value.type === 'proposalResolved') return isProposalId(value.proposalId) && typeof value.content === 'string' && value.content.length <= AGENT_SOURCE_MAX && isProposalOutcome(value);
  if (value.type === 'commentAction') return ['open', 'submit', 'update', 'delete'].includes(String(value.kind)) && isPositive(value.line) && isPositive(value.endLine) && Number(value.endLine) >= Number(value.line) && typeof value.quote === 'string' && value.quote.length <= STUDIO_LIMITS.quote
    && (value.kind === 'update' || value.kind === 'delete' ? typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 64 : value.id === undefined)
    && (value.kind === 'open' || value.kind === 'delete' ? value.body === undefined : typeof value.body === 'string' && value.body.trim().length > 0 && value.body.length <= STUDIO_LIMITS.commentBody);
  if (value.type === 'askSelection') return typeof value.action === 'string' && value.action.length > 0 && value.action.length <= 64 && isSelection(value);
  if (value.type === 'saveRequest') return true;
  if (value.type === 'requestOpen') return typeof value.path === 'string';
  return value.type === 'persist' && typeof value.path === 'string' && typeof value.content === 'string';
}

function isPositive(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 1;
}

function isProposalId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isSelection(value: unknown): boolean {
  return isRecord(value) && isPositive(value.startLine) && isPositive(value.endLine) && Number(value.endLine) >= Number(value.startLine)
    && typeof value.text === 'string' && value.text.length <= STUDIO_LIMITS.selectionText;
}

function isAction(value: unknown): value is AgentAction {
  if (!isRecord(value) || !['id', 'name', 'owner', 'target', 'description'].every(key => typeof value[key] === 'string') || !Number.isInteger(value.line) || Number(value.line) < 1) return false;
  const parameter = (row: unknown) => isRecord(row) && ['name', 'type', 'description'].every(key => typeof row[key] === 'string') && typeof row.required === 'boolean';
  return Array.isArray(value.inputs) && value.inputs.length <= 250 && value.inputs.every(parameter) && Array.isArray(value.outputs) && value.outputs.length <= 250 && value.outputs.every(parameter) && Array.isArray(value.uses) && value.uses.length <= 1000 && value.uses.every(use => isRecord(use) && ['available', 'run'].includes(String(use.kind)) && Number.isInteger(use.line) && Number(use.line) > 0 && typeof use.code === 'string');
}

export function isHostToPlayground(value: unknown): value is HostToPlayground {
  if (!isRecord(value) || value.source !== PLAYGROUND_BRIDGE_SOURCE || typeof value.type !== 'string') {
    return false;
  }
  return (
    (value.type === 'graph' && typeof value.content === 'string' && value.content.length <= AGENT_SOURCE_MAX && typeof value.visible === 'boolean' && ['light', 'dark'].includes(String(value.theme)) && (value.compact === undefined || typeof value.compact === 'boolean') && (value.focus === undefined || (typeof value.focus === 'string' && value.focus.length <= 200)) && (value.focusSeq === undefined || (Number.isInteger(value.focusSeq) && Number(value.focusSeq) >= 0 && Number(value.focusSeq) <= 1_000_000_000)) && (value.coverage === undefined || value.coverage === null || readGraphCoverage(value.coverage) !== null) && (value.focusCase === undefined || (typeof value.focusCase === 'string' && value.focusCase.length <= COVERAGE_LIMITS.text))) ||
    value.type === 'init' ||
    (value.type === 'revealLine' && Number.isInteger(value.line) && Number(value.line) > 0) ||
    (value.type === 'reference' && typeof value.content === 'string' && value.content.length <= 750_000 && REFERENCE_LANGUAGES.includes(value.language as ReferenceLanguage)) ||
    value.type === 'setFile' ||
    value.type === 'setTheme' ||
    value.type === 'setDialect' ||
    value.type === 'setView' ||
    value.type === 'setFiles' ||
    value.type === 'setOrg' ||
    value.type === 'saved' ||
    (value.type === 'fileChanged' && typeof value.draftKey === 'string' && value.draftKey.length > 0 && value.draftKey.length <= 2000 && typeof value.content === 'string' && value.content.length <= AGENT_SOURCE_MAX && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256)) ||
    value.type === 'flushSave' ||
    (value.type === 'proposeEdit' && isProposalId(value.proposalId) && typeof value.content === 'string' && value.content.length <= AGENT_SOURCE_MAX && typeof value.summary === 'string' && value.summary.length <= 1000 && typeof value.actor === 'string' && value.actor.length <= 200) ||
    (value.type === 'clearProposal' && isProposalId(value.proposalId)) ||
    (value.type === 'setComments' && Array.isArray(value.comments) && value.comments.length <= 500 && value.comments.every(isStudioComment)) ||
    (value.type === 'setHits' && Array.isArray(value.lines) && value.lines.length <= 1000 && value.lines.every(isPositive)) ||
    (value.type === 'setLayout' && typeof value.compact === 'boolean') ||
    (value.type === 'setReadOnly' && typeof value.readOnly === 'boolean' && (value.content === undefined || (typeof value.content === 'string' && value.content.length <= AGENT_SOURCE_MAX)) &&
      (value.baseline === undefined ? value.baseSha === undefined : typeof value.baseline === 'string' && value.baseline.length <= AGENT_SOURCE_MAX && typeof value.baseSha === 'string' && /^[0-9a-f]{64}$/.test(value.baseSha)))
  );
}

export function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export const PLAYGROUND_ASSET_SRC = '/plugins/salesforce/assets/playground/dist/index.html';
