import { createHash } from 'node:crypto';
import type { ExecutionDatabase } from '@zana-ai/zcc-db';
import { inboxQuestions, type InboxEntry, type InboxHostAction, type InboxHostActionInput, type InboxHostActionResult } from '@zana-ai/zcc-domain/product';

const RECORD_PREFIX = 'inbox-action:';
const HOST_ACTION_TEXT_MAX_CHARS = 64 * 1024;

type ActionStatus = InboxHostAction['status'];

interface ActionRow {
  entryId: string;
  kind: string;
  ref: string;
  contentHash: string;
  status: ActionStatus;
  textOptionId?: string;
  error?: string;
  visibleError?: boolean;
  unavailable?: boolean;
}

export interface InboxActionHandlerOutcome {
  /** Keep this approved action available after a successful operation. */
  keepPending?: boolean;
}

export class InboxActionOperatorError extends Error {
  constructor(message: string, readonly unavailable = false) {
    super(message);
    this.name = 'InboxActionOperatorError';
  }
}

export type InboxActionHandler = (input: { ref: string; input?: InboxHostActionInput }) =>
  Promise<void | InboxActionHandlerOutcome> | void | InboxActionHandlerOutcome;

export interface InboxActionRegistry {
  readonly enabled: boolean;
  bind(entry: InboxEntry, action: { kind: string; ref: string; textOptionId?: string }): boolean;
  list(entries: InboxEntry[]): InboxHostAction[];
  run(entry: InboxEntry, input?: InboxHostActionInput): Promise<InboxHostActionResult>;
  remove(entryIds: string[]): void;
  markUnavailable(kind: string, ref: string, message: string): void;
  register(kind: string, handler: InboxActionHandler): () => void;
  /** Main-only durable binding; never projected to renderer. */
  bound(entryId: string): { kind: string; ref: string } | null;
}

function recordId(entryId: string): string {
  return `${RECORD_PREFIX}${entryId}`;
}

function contentHash(entry: InboxEntry, action: Pick<ActionRow, 'kind' | 'textOptionId'>): string {
  const questions = entry.questions ?? (entry.question ? [entry.question] : []);
  return createHash('sha256').update(JSON.stringify({
      kind: action.kind,
      textOptionId: action.textOptionId ?? '',
    subject: entry.subject ?? '',
    comments: entry.comments ?? '',
    questions: questions.map((question) => ({
      prompt: question.prompt ?? '',
      options: question.options.map((option) => ({ id: option.id, label: option.label }))
    }))
  })).digest('hex');
}

function parseRow(value: string): ActionRow | null {
  try {
    const row = JSON.parse(value) as Partial<ActionRow>;
    if (
        typeof row.entryId !== 'string' || typeof row.kind !== 'string' ||
        typeof row.ref !== 'string' || typeof row.contentHash !== 'string' ||
        !['pending', 'claimed', 'done', 'failed'].includes(row.status ?? '') ||
        (row.textOptionId !== undefined && typeof row.textOptionId !== 'string') ||
        (row.visibleError !== undefined && typeof row.visibleError !== 'boolean')
        || (row.unavailable !== undefined && typeof row.unavailable !== 'boolean')
    ) return null;
    return row as ActionRow;
  } catch {
    return null;
  }
}

/**
 * Main-only durable action ledger. It intentionally has no built-in handlers:
 * product features opt in by registering a kind and binding a host-created entry.
 */
export function createInboxActionRegistry(database?: ExecutionDatabase): InboxActionRegistry {
  const handlers = new Map<string, InboxActionHandler>();
  if (!database) {
    const unavailable = async (): Promise<InboxHostActionResult> => ({ ok: false, status: 'missing' });
    return {
      enabled: false,
      bind: () => false,
      list: () => [],
      run: unavailable,
      remove: () => {},
      markUnavailable: () => {},
      register: () => () => {}
      ,bound: () => null
    };
  }

  const select = database.sqlite.prepare('SELECT value_json FROM execution_records WHERE id = ?');
  const insert = database.sqlite.prepare(
    'INSERT OR IGNORE INTO execution_records (id, value_json, created_at, updated_at) VALUES (?, ?, ?, ?)'
  );
  const update = database.sqlite.prepare('UPDATE execution_records SET value_json = ?, updated_at = ? WHERE id = ?');
  const claim = database.sqlite.prepare(
    'UPDATE execution_records SET value_json = ?, updated_at = ? WHERE id = ? AND value_json = ?'
  );
  const remove = database.sqlite.prepare('DELETE FROM execution_records WHERE id = ?');
  const resetClaims = database.sqlite.prepare(
    "UPDATE execution_records SET value_json = replace(value_json, '\"status\":\"claimed\"', '\"status\":\"pending\"'), updated_at = ? WHERE id LIKE ? AND value_json LIKE '%\"status\":\"claimed\"%'"
  );
  resetClaims.run(Date.now(), `${RECORD_PREFIX}%`);

  const read = (entryId: string): ActionRow | null => {
    const row = select.get(recordId(entryId)) as { value_json: string } | undefined;
    return row ? parseRow(row.value_json) : null;
  };
  const write = (row: ActionRow) => update.run(JSON.stringify(row), Date.now(), recordId(row.entryId));

  return {
    enabled: true,
    bind(entry, action) {
      if (!entry.id || !action.kind || !action.ref) return false;
      if (action.textOptionId && !inboxQuestions(entry).some((question) => question.options.some((option) => option.id === action.textOptionId))) return false;
      const row: ActionRow = {
        entryId: entry.id,
        kind: action.kind,
        ref: action.ref,
        contentHash: contentHash(entry, action),
        status: 'pending',
        ...(action.textOptionId ? { textOptionId: action.textOptionId } : {})
      };
      return Number(insert.run(recordId(entry.id), JSON.stringify(row), Date.now(), Date.now()).changes) === 1;
    },
    list(entries) {
      return entries.flatMap((entry) => {
        const row = read(entry.id);
        if (!row || !handlers.has(row.kind) || row.contentHash !== contentHash(entry, row)) return [];
        return [{
          entryId: row.entryId,
          kind: row.kind,
          status: row.status,
          ...(row.textOptionId ? { textOptionId: row.textOptionId } : {}),
          ...(row.visibleError && row.error ? { message: row.error } : row.error ? { message: 'Could not complete this decision. Try again.' } : {}),
          ...(row.unavailable ? { unavailable: true } : {})
        }];
      });
    },
    async run(entry, input) {
      if (!input || typeof input.optionId !== 'string' || (input.text !== undefined && typeof input.text !== 'string')
        || (input.text?.length ?? 0) > HOST_ACTION_TEXT_MAX_CHARS
        || !inboxQuestions(entry).some((question) => question.options.some((option) => option.id === input.optionId))) {
        return { ok: false, status: 'missing' };
      }
      const claimed = database.transaction(() => {
        const row = read(entry.id);
        if (!row || row.contentHash !== contentHash(entry, row)) return null;
        if (row.textOptionId === input.optionId && !input.text?.trim()) return null;
        if (row.textOptionId !== input.optionId && input.text !== undefined) return null;
        if (row.status === 'done') return row;
        if (row.status === 'failed' && !row.unavailable) row.status = 'pending';
        if (row.status !== 'pending') return null;
        const previous = JSON.stringify(row);
        row.status = 'claimed';
        return Number(claim.run(JSON.stringify(row), Date.now(), recordId(row.entryId), previous).changes) === 1
          ? row
          : null;
      });
      if (!claimed) return { ok: false, status: 'missing' };
      if (claimed.status === 'done') return { ok: true, status: 'done' };
      const handler = handlers.get(claimed.kind);
      if (!handler) {
        claimed.status = 'failed';
        claimed.error = 'handler unavailable';
        write(claimed);
        return { ok: false, status: 'failed' };
      }
      try {
        const outcome = await handler({ ref: claimed.ref, input });
        claimed.status = outcome?.keepPending ? 'pending' : 'done';
        delete claimed.error;
        delete claimed.visibleError;
        delete claimed.unavailable;
        write(claimed);
        return { ok: true, status: claimed.status };
      } catch (error) {
        // Handler failures can be transient (for example, Git contention). Keep
        // action pending so operator can retry same authorized choice.
        claimed.status = 'pending';
        claimed.error = error instanceof Error ? error.message.slice(0, 500) : 'handler failed';
        claimed.visibleError = error instanceof InboxActionOperatorError;
        claimed.unavailable = error instanceof InboxActionOperatorError && error.unavailable;
        if (!claimed.visibleError) console.error(`[InboxActionRegistry] ${claimed.kind} handler failed`, error);
        write(claimed);
        return { ok: false, status: 'failed' };
      }
    },
    remove(entryIds) {
      database.transaction(() => {
        for (const entryId of entryIds) remove.run(recordId(entryId));
      });
    },
    markUnavailable(kind, ref, message) {
      database.transaction(() => {
        const rows = database.sqlite.prepare("SELECT value_json FROM execution_records WHERE id LIKE ?").all(`${RECORD_PREFIX}%`) as Array<{ value_json: string }>;
        for (const candidate of rows) {
          const row = parseRow(candidate.value_json);
          if (!row || row.kind !== kind || row.ref !== ref || row.status === 'done') continue;
          row.status = 'failed';
          row.error = message.slice(0, 500);
          row.visibleError = true;
          row.unavailable = true;
          write(row);
        }
      });
    },
    register(kind, handler) {
      handlers.set(kind, handler);
      return () => {
        if (handlers.get(kind) === handler) handlers.delete(kind);
      };
    },
    bound(entryId) {
      const row = read(entryId);
      return row ? { kind: row.kind, ref: row.ref } : null;
    }
  };
}
