export type FoldedTodoPlanStatus = "pending" | "active" | "completed";

export interface FoldedTodoPlanStep {
  step: string;
  status: FoldedTodoPlanStatus;
}

export type TodoPlanFoldState = Map<string, FoldedTodoPlanStep>;

interface ParsedTodoItem {
  key: string;
  hasStableId: boolean;
  step: string;
  status: FoldedTodoPlanStatus;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTodoStatus(raw: string): FoldedTodoPlanStatus | null {
  const status = raw
    .trim()
    .toLowerCase()
    .replace(/^todo_status_/, "")
    .replace(/-/g, "_");
  if (status === "pending" || status === "todo") return "pending";
  if (
    status === "in_progress" ||
    status === "inprogress" ||
    status === "active"
  ) {
    return "active";
  }
  if (status === "completed" || status === "complete" || status === "done") {
    return "completed";
  }
  return null;
}

function parseTodoItems(rawInput: unknown): ParsedTodoItem[] | null {
  const record = recordFromUnknown(rawInput);
  if (!record || !Array.isArray(record.todos)) return null;
  const items: ParsedTodoItem[] = [];
  for (const [index, entry] of record.todos.entries()) {
    const todo = recordFromUnknown(entry);
    if (!todo) continue;
    const content = typeof todo.content === "string" ? todo.content.trim() : "";
    const status =
      typeof todo.status === "string" ? normalizeTodoStatus(todo.status) : null;
    if (!content || !status) continue;
    const id = typeof todo.id === "string" ? todo.id.trim() : "";
    items.push({
      key: id || `idx:${index}:${content.slice(0, 80).toLowerCase()}`,
      hasStableId: id.length > 0,
      step: content,
      status,
    });
  }
  return items.length > 0 ? items : null;
}

/**
 * Fold a Cursor `updateTodos` / OpenCode todos snapshot into the running
 * checklist. Snapshots with stable ids merge (Cursor often sends only the
 * rows it changed). Snapshots without ids replace the list (OpenCode sends
 * the full checklist each call).
 */
export function foldTodoPlanSnapshot(
  state: TodoPlanFoldState,
  rawInput: unknown,
): FoldedTodoPlanStep[] | null {
  const items = parseTodoItems(rawInput);
  if (!items) return null;
  const hasStableIds = items.some((item) => item.hasStableId);
  if (!hasStableIds) state.clear();
  for (const item of items) {
    state.set(item.key, { step: item.step, status: item.status });
  }
  return [...state.values()];
}
