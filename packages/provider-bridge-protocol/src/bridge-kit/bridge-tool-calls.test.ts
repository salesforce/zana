import { describe, expect, it } from "vitest";
import {
  buildBridgeToolCallContent,
  decodeToolCallResponsePayload,
} from "./bridge-tool-calls.js";

const PNG = "iVBORw0KGgo=";

describe("decodeToolCallResponsePayload", () => {
  it("keeps text results unchanged", () => {
    expect(
      decodeToolCallResponsePayload({
        success: true,
        contentItems: [
          { type: "inputText", text: "first" },
          { type: "inputText", text: "second" },
        ],
      }),
    ).toEqual({
      content: "first\nsecond",
      contentBlocks: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
      images: [],
      isError: false,
    });
  });

  it("decodes an image-only result into an image rather than OK", () => {
    expect(
      decodeToolCallResponsePayload({
        success: true,
        contentItems: [
          { type: "inputImage", imageUrl: `data:image/png;base64,${PNG}` },
        ],
      }),
    ).toEqual({
      content: "",
      contentBlocks: [{ type: "image", data: PNG, mimeType: "image/png" }],
      images: [{ data: PNG, mimeType: "image/png" }],
      isError: false,
    });
  });

  it("rejects malformed payloads instead of treating them as success", () => {
    expect(decodeToolCallResponsePayload({})).toEqual({
      content: "Invalid tool call response",
      contentBlocks: [{ type: "text", text: "Invalid tool call response" }],
      images: [],
      isError: true,
    });
  });
});

describe("buildBridgeToolCallContent", () => {
  it("prefers explicit content blocks", () => {
    expect(
      buildBridgeToolCallContent({
        content: "ignored",
        contentBlocks: [{ type: "text", text: "kept" }],
      }),
    ).toEqual([{ type: "text", text: "kept" }]);
  });

  it("falls back to text plus images", () => {
    expect(
      buildBridgeToolCallContent({
        content: "OK",
        images: [{ data: PNG, mimeType: "image/png" }],
      }),
    ).toEqual([
      { type: "text", text: "OK" },
      { type: "image", data: PNG, mimeType: "image/png" },
    ]);
  });
});
