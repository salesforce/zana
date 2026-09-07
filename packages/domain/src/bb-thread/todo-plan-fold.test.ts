import { describe, expect, it } from "vitest";
import {
  foldTodoPlanFromInputs,
  foldTodoPlanSnapshot,
  type TodoPlanFoldState,
} from "./todo-plan-fold.js";

describe("foldTodoPlanSnapshot", () => {
  it("maps Cursor TODO_STATUS_* partial updates onto the full checklist", () => {
    const state: TodoPlanFoldState = new Map();
    expect(
      foldTodoPlanSnapshot(state, {
        _toolName: "updateTodos",
        todos: [
          { id: "ping", content: "ping", status: "TODO_STATUS_PENDING" },
          { id: "pong", content: "pong", status: "TODO_STATUS_PENDING" },
        ],
      }),
    ).toEqual([
      { step: "ping", status: "pending" },
      { step: "pong", status: "pending" },
    ]);
    expect(
      foldTodoPlanSnapshot(state, {
        todos: [{ id: "ping", content: "ping", status: "TODO_STATUS_IN_PROGRESS" }],
      }),
    ).toEqual([
      { step: "ping", status: "active" },
      { step: "pong", status: "pending" },
    ]);
    expect(
      foldTodoPlanSnapshot(state, {
        todos: [{ id: "pong", content: "pong", status: "TODO_STATUS_COMPLETED" }],
      }),
    ).toEqual([
      { step: "ping", status: "active" },
      { step: "pong", status: "completed" },
    ]);
  });

  it("replaces OpenCode full snapshots that have no ids", () => {
    expect(
      foldTodoPlanFromInputs([
        {
          todos: [
            { content: "ping", status: "pending" },
            { content: "pong", status: "pending" },
          ],
        },
        {
          todos: [
            { content: "ping", status: "completed" },
            { content: "pong", status: "in_progress" },
          ],
        },
      ]),
    ).toEqual([
      { step: "ping", status: "completed" },
      { step: "pong", status: "active" },
    ]);
  });

  it("returns null when the payload is not a todos snapshot", () => {
    const state: TodoPlanFoldState = new Map();
    expect(foldTodoPlanSnapshot(state, { command: "echo ping" })).toBeNull();
    expect(foldTodoPlanSnapshot(state, { todos: [] })).toBeNull();
  });
});
