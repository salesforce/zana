import { describe, expect, it } from "vitest";
import {
  SYSTEM_INSTRUCTION_ECHO_MAX_CHARS,
  SYSTEM_INSTRUCTIONS_OPEN,
  concatenatedAcpPromptText,
  createSystemInstructionEchoStripper,
  wrapSystemInstructions,
} from "./system-instruction-echo.js";

describe("wrapSystemInstructions", () => {
  it("wraps the payload in the ACP first-prompt tags", () => {
    expect(wrapSystemInstructions("Be terse.")).toBe(
      "<system_instructions>\nBe terse.\n</system_instructions>",
    );
  });
});

describe("concatenatedAcpPromptText", () => {
  it("joins text blocks the way Mastra Code concatenates prompt content", () => {
    expect(
      concatenatedAcpPromptText([
        { type: "text", text: wrapSystemInstructions("Be terse.") },
        { type: "text", text: "hello" },
        { type: "resource_link", text: "ignored" },
      ]),
    ).toBe(`${wrapSystemInstructions("Be terse.")}\nhello`);
  });
});

describe("createSystemInstructionEchoStripper", () => {
  const echo = concatenatedAcpPromptText([
    { type: "text", text: wrapSystemInstructions("Be terse.") },
    { type: "text", text: "hello" },
  ]);

  it("passes chunks through when it is not armed", () => {
    const stripper = createSystemInstructionEchoStripper();
    expect(stripper.consume(echo)).toBe(echo);
  });

  it("drops a one-chunk Mastra-style prompt echo and keeps the reply", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    expect(stripper.consume(echo)).toBe("");
    expect(stripper.consume("Hi!")).toBe("Hi!");
  });

  it("drops an echo that arrives in the same chunk as the reply", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    expect(stripper.consume(`${echo}\nHi!`)).toBe("Hi!");
  });

  it("matches an echo streamed one character at a time", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    let visible = "";
    for (const char of echo) {
      visible += stripper.consume(char);
    }
    expect(visible).toBe("");
    expect(stripper.consume("Hi!")).toBe("Hi!");
  });

  it("falls back to stripping only the wrapper when the user text is not echoed", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    expect(stripper.consume(`${wrapSystemInstructions("Be terse.")}\nHi!`)).toBe(
      "Hi!",
    );
  });

  it("does not hide a reply that is not an instruction echo", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    expect(stripper.consume("Hello there.")).toBe("Hello there.");
  });

  it("leaves the fake agent's echo: prefix alone", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    expect(stripper.consume(`echo:${echo}`)).toBe(`echo:${echo}`);
  });

  it("skips leading whitespace before the wrapper", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    expect(stripper.consume(`\n  ${echo}`)).toBe("");
    expect(stripper.consume("Hi!")).toBe("Hi!");
  });

  it("discards a partial match at finish so the next turn is clean", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    expect(stripper.consume("<system")).toBe("");
    stripper.finish();
    expect(stripper.consume("Hello there.")).toBe("Hello there.");
  });

  it("fails open when the match buffer exceeds the cap", () => {
    const stripper = createSystemInstructionEchoStripper();
    stripper.arm(echo);
    const huge = `${SYSTEM_INSTRUCTIONS_OPEN}${"x".repeat(SYSTEM_INSTRUCTION_ECHO_MAX_CHARS)}`;
    expect(stripper.consume(huge)).toBe(huge);
  });
});
