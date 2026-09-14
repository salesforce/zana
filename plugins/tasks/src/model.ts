export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'canceled'
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SORTS = ['manual', 'priority', 'due'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export const KEY_PREFIX = 'TSK';
export const STORE_VERSION = 2;
export const MAX_TASKS = 500;
export const TASKS_CHANGED = 'tasks-changed';
export const STORAGE_KEY = 'store';
/** Legacy KV key used by the checkbox-list plugin. */
export const LEGACY_ITEMS_KEY = 'items';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  canceled: 'Canceled'
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority'
};

export const SORT_LABELS: Record<TaskSort, string> = {
  manual: 'Manual',
  priority: 'Priority',
  due: 'Due date'
};

export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4
};

export const BOARD_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done'
] as const satisfies readonly TaskStatus[];

export interface Task {
  id: string;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: number;
  updatedAt: number;
  order: number;
}

export interface TaskStore {
  version: typeof STORE_VERSION;
  nextSeq: number;
  items: Task[];
}

export interface PublicTask extends Task {
  done: boolean;
}

export interface ListFilters {
  statuses: TaskStatus[];
  priorities: TaskPriority[];
}

export const EMPTY_FILTERS: ListFilters = { statuses: [], priorities: [] };

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isTaskSort(value: unknown): value is TaskSort {
  return typeof value === 'string' && (TASK_SORTS as readonly string[]).includes(value);
}

export function hasActiveFilters(filters: ListFilters): boolean {
  return filters.statuses.length > 0 || filters.priorities.length > 0;
}

export function toPublic(task: Task): PublicTask {
  return { ...task, done: task.status === 'done' };
}

export function taskKey(seq: number): string {
  return `${KEY_PREFIX}-${seq}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readDueDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export function migrateLegacyItem(raw: unknown, seq: number, now: number): Task | null {
  const row = asRecord(raw);
  if (!row) return null;
  const title = readString(row.title).trim();
  if (!title) return null;
  const id = readString(row.id) || `legacy-${seq}`;
  const done = row.done === true;
  const status = isTaskStatus(row.status) ? row.status : done ? 'done' : 'todo';
  return {
    id,
    key: readString(row.key) || taskKey(seq),
    title,
    description: readString(row.description),
    status,
    priority: isTaskPriority(row.priority) ? row.priority : 'none',
    dueDate: readDueDate(row.dueDate),
    createdAt: readNumber(row.createdAt, now),
    updatedAt: readNumber(row.updatedAt, now),
    order: readNumber(row.order, seq)
  };
}

export function emptyStore(): TaskStore {
  return { version: STORE_VERSION, nextSeq: 1, items: [] };
}

export function normalizeStore(raw: unknown, now = Date.now()): TaskStore {
  if (raw == null) return emptyStore();
  if (Array.isArray(raw)) {
    const items: Task[] = [];
    let seq = 1;
    for (const row of raw) {
      const task = migrateLegacyItem(row, seq, now);
      if (!task) continue;
      items.push(task);
      seq += 1;
    }
    return { version: STORE_VERSION, nextSeq: seq, items };
  }
  const row = asRecord(raw);
  if (!row) return emptyStore();
  const source = Array.isArray(row.items) ? row.items : [];
  const items: Task[] = [];
  let seq = Math.max(1, Math.floor(readNumber(row.nextSeq, 1)));
  for (const entry of source) {
    const task = migrateLegacyItem(entry, seq, now);
    if (!task) continue;
    items.push(task);
    const parsed = Number.parseInt(task.key.split('-')[1] ?? '', 10);
    if (Number.isFinite(parsed) && parsed >= seq) seq = parsed + 1;
  }
  return { version: STORE_VERSION, nextSeq: seq, items };
}

export function createTask(
  input: {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    id?: string;
  },
  ctx: { nextSeq: number; now?: number }
): { task: Task; nextSeq: number } {
  const title = input.title.trim();
  if (!title) throw new Error('title is required');
  const now = ctx.now ?? Date.now();
  const seq = ctx.nextSeq;
  return {
    task: {
      id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `task-${now}-${seq}`,
      key: taskKey(seq),
      title,
      description: (input.description ?? '').trim(),
      status: input.status ?? 'todo',
      priority: input.priority ?? 'none',
      dueDate: input.dueDate ?? null,
      createdAt: now,
      updatedAt: now,
      order: now
    },
    nextSeq: seq + 1
  };
}

export function findTask(store: TaskStore, idOrKey: string): Task | undefined {
  const needle = idOrKey.trim();
  if (!needle) return undefined;
  const upper = needle.toUpperCase();
  return store.items.find((task) => task.id === needle || task.key.toUpperCase() === upper);
}

export function patchTask(
  task: Task,
  patch: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
    order?: number;
  },
  now = Date.now()
): Task {
  const next: Task = { ...task, updatedAt: now };
  if (typeof patch.title === 'string') {
    const title = patch.title.trim();
    if (!title) throw new Error('title is required');
    next.title = title;
  }
  if (typeof patch.description === 'string') next.description = patch.description;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate;
  if (typeof patch.order === 'number' && Number.isFinite(patch.order)) next.order = patch.order;
  return next;
}

export function toggleDone(task: Task, now = Date.now()): Task {
  return {
    ...task,
    status: task.status === 'done' ? 'todo' : 'done',
    updatedAt: now
  };
}

export function matchesFilters(task: Task, filters: ListFilters): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.includes(task.status)) return false;
  if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) return false;
  return true;
}

export function sortTasks<T extends Task>(tasks: readonly T[], sort: TaskSort): T[] {
  const copy = [...tasks];
  if (sort === 'priority') {
    copy.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order);
  } else if (sort === 'due') {
    copy.sort((a, b) => {
      if (a.dueDate === null && b.dueDate === null) return a.order - b.order;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate) || a.order - b.order;
    });
  } else {
    copy.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }
  return copy;
}

export interface StatusGroup<T extends Task = Task> {
  status: TaskStatus;
  tasks: T[];
}

export function groupTasksByStatus<T extends Task>(tasks: readonly T[]): StatusGroup<T>[] {
  const byStatus = new Map<TaskStatus, T[]>();
  for (const task of tasks) {
    const bucket = byStatus.get(task.status);
    if (bucket) bucket.push(task);
    else byStatus.set(task.status, [task]);
  }
  return TASK_STATUSES.flatMap((status) => {
    const bucket = byStatus.get(status);
    return bucket ? [{ status, tasks: bucket }] : [];
  });
}

export type ColumnMap<T extends Task = Task> = Record<TaskStatus, T[]>;

export function emptyColumns<T extends Task = Task>(): ColumnMap<T> {
  return {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    canceled: []
  };
}

export function groupColumns<T extends Task>(tasks: readonly T[]): ColumnMap<T> {
  const columns = emptyColumns<T>();
  for (const task of tasks) columns[task.status].push(task);
  return columns;
}

export function visibleBoardStatuses(columns: Readonly<Record<TaskStatus, readonly unknown[]>>): TaskStatus[] {
  return [...BOARD_STATUSES, ...(columns.canceled.length > 0 ? (['canceled'] as const) : [])];
}

export function applyBoardMove(tasks: readonly Task[], taskId: string, toStatus: TaskStatus, dropIndex: number, now = Date.now()): Task[] {
  const moving = tasks.find((task) => task.id === taskId);
  if (!moving) return [...tasks];
  const remaining = tasks.filter((task) => task.id !== taskId);
  const destination = remaining.filter((task) => task.status === toStatus);
  const rest = remaining.filter((task) => task.status !== toStatus);
  const index = Math.max(0, Math.min(dropIndex, destination.length));
  const nextColumn = [...destination];
  nextColumn.splice(index, 0, { ...moving, status: toStatus, updatedAt: now });
  return [
    ...rest,
    ...nextColumn.map((task, order) => ({ ...task, order, updatedAt: now }))
  ];
}

export function formatDueDate(dueDate: string, today = new Date()): string {
  const date = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dueDate;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' })
  });
}

export function openTaskCount(tasks: readonly Task[]): number {
  return tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled').length;
}

export function formatTaskListLine(task: Task): string {
  const status = task.status.padEnd(11, ' ');
  const priority = task.priority === 'none' ? '     ' : task.priority.padEnd(6, ' ');
  return `${task.key.padEnd(8, ' ')} ${status} ${priority} ${task.title}`;
}

export function formatHelp(): string {
  return [
    'zcc tasks list [--status <status>] [--priority <priority>]',
    'zcc tasks add <title> [--status <status>] [--priority <priority>] [--due YYYY-MM-DD]',
    'zcc tasks show <key-or-id>',
    'zcc tasks update <key-or-id> [--title <title>] [--status <status>] [--priority <priority>] [--due YYYY-MM-DD]',
    'zcc tasks done <key-or-id>',
    ''
  ].join('\n');
}

export interface ParsedCli {
  command: string;
  rest: string[];
  flags: Record<string, string>;
  help: boolean;
}

export function parseCliArgs(argv: readonly string[]): ParsedCli {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (token.startsWith('--') && token.length > 2) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = 'true';
      }
      continue;
    }
    rest.push(token);
  }
  const command = rest[0] ?? 'list';
  return { command, rest: rest.slice(1), flags, help };
}

export function statusFromFlag(value: string | undefined): TaskStatus | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[-\s]/g, '_');
  if (normalized === 'inprogress') return 'in_progress';
  if (normalized === 'inreview') return 'in_review';
  if (!isTaskStatus(normalized)) throw new Error(`unknown status: ${value}`);
  return normalized;
}

export function priorityFromFlag(value: string | undefined): TaskPriority | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'no' || normalized === 'none') return 'none';
  if (!isTaskPriority(normalized)) throw new Error(`unknown priority: ${value}`);
  return normalized;
}

export function dueFromFlag(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === '' || value === 'none' || value === 'clear') return null;
  const due = readDueDate(value);
  if (!due) throw new Error(`due date must be YYYY-MM-DD, got ${value}`);
  return due;
}
