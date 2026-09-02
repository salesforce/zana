import { describe, expect, it } from "vitest";
import { createBridgeIo } from "./bridge-harness.js";

describe("createBridgeIo", () => {
  it("omits error.data when sendError is called with three arguments", () => {
    const lines: string[] = [];
    const { sendError } = createBridgeIo({ write: (line) => lines.push(line) });
    sendError(1, -32000, "boom");
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "boom" },
    });
  });

  it("attaches error.data when sendError is given a recovery payload", () => {
    const lines: string[] = [];
    const { sendError } = createBridgeIo({ write: (line) => lines.push(line) });
    sendError(2, -32000, "archived", {
      recovery: {
        kind: "sessionArchived",
        message: "unarchive and retry",
        retryable: true,
      },
    });
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32000,
        message: "archived",
        data: {
          recovery: {
            kind: "sessionArchived",
            message: "unarchive and retry",
            retryable: true,
          },
        },
      },
    });
  });
});
