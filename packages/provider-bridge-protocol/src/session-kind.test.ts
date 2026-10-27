import { describe, expect, it } from "vitest";
import {
  threadForkParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
} from "./requests.js";

const base = {
  threadId: "t1",
  cwd: "/tmp/x",
  instructionMode: "append",
  options: {
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: "ask",
  },
};

describe("sessionKind on session construction params", () => {
  it.each([
    ["omitted", undefined, undefined],
    ["interactive", "interactive", "interactive"],
    ["automated", "automated", "automated"],
    ["unknown", "robot", undefined],
  ])("start parses %s", (_label, input, expected) => {
    const parsed = threadStartParamsSchema.parse({
      ...base,
      ...(input === undefined ? {} : { sessionKind: input }),
    });
    expect(parsed.sessionKind).toBe(expected);
  });

  it("is accepted on resume and fork too", () => {
    expect(
      threadResumeParamsSchema.parse({
        ...base,
        providerThreadId: "p1",
        sessionKind: "automated",
      }).sessionKind,
    ).toBe("automated");
    expect(
      threadForkParamsSchema.parse({
        ...base,
        sourceProviderThreadId: "p1",
        sessionKind: "automated",
      }).sessionKind,
    ).toBe("automated");
  });
});
