import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

const forkCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: (_entry: string, _args: readonly string[], options: Record<string, unknown>) => {
      forkCalls.push(options);
      return Object.assign(new EventEmitter(), { connected: false, kill: () => true });
    },
  };
});

const { createForkChannel } = await import("../src/parcel-subprocess/fork-channel.js");

// The watcher child is forked from the host daemon, which runs under Electron (a
// GUI process): on Windows a child without windowsHide opens a console window.
it("forks the parcel watcher child with the console window hidden", () => {
  createForkChannel();
  expect(forkCalls).toHaveLength(1);
  expect(forkCalls[0]).toMatchObject({ windowsHide: true });
});
