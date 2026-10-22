import { describe, expect, it } from "vitest";
import {
  THREAD_CONVERSATION_SEARCH_QUERY_MAX,
  threadConversationOutlineQuerySchema,
  threadConversationOutlineResponseSchema,
} from "../src/api/threads.js";
import { publicApiRoutes } from "../src/public-api.js";

describe("conversation outline find-in-thread contract", () => {
  it("accepts an optional, bounded query", () => {
    expect(threadConversationOutlineQuerySchema.parse({})).toEqual({});
    expect(threadConversationOutlineQuerySchema.parse({ q: "cat" })).toEqual({ q: "cat" });
    expect(
      threadConversationOutlineQuerySchema.safeParse({ q: "x".repeat(THREAD_CONVERSATION_SEARCH_QUERY_MAX + 1) }).success,
    ).toBe(false);
  });

  it("returns per-message match counts only when searched", () => {
    expect(threadConversationOutlineResponseSchema.parse({ items: [], maxSeq: 0 })).toEqual({ items: [], maxSeq: 0 });
    const searched = { items: [], maxSeq: 3, matches: [{ id: "m1", seq: 2, count: 4 }] };
    expect(threadConversationOutlineResponseSchema.parse(searched)).toEqual(searched);
    expect(
      threadConversationOutlineResponseSchema.safeParse({ items: [], maxSeq: 3, matches: [{ id: "m1", seq: 2, count: 0 }] }).success,
    ).toBe(false);
  });

  it("validates the route query", () => {
    expect(publicApiRoutes.threads.conversationOutline.request).toEqual({
      source: "query",
      schema: threadConversationOutlineQuerySchema,
    });
  });
});
