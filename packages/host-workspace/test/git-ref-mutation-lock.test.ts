import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withGitRefMutationLock } from "../src/git-ref-mutation-lock.js";

describe("withGitRefMutationLock", () => {
  it("serializes work on the same git common dir", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zcc-git-lock-"));
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withGitRefMutationLock(dir, async () => {
      order.push(1);
      await firstGate;
      order.push(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = withGitRefMutationLock(dir, async () => {
      order.push(3);
    });
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
