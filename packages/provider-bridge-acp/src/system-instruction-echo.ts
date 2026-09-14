/**
 * ACP v1 has no system-prompt slot, so the bridge prepends session
 * instructions as a `<system_instructions>` text block on the first
 * `session/prompt`. Agents that concatenate prompt blocks (Mastra Code)
 * often stream that text back as the first `agent_message_chunk`. This
 * stripper consumes a leading echo of the prompt we just sent so the
 * thread shows only the real reply.
 */

export const SYSTEM_INSTRUCTIONS_OPEN = "<system_instructions>";
export const SYSTEM_INSTRUCTIONS_CLOSE = "</system_instructions>";

/** Bound so a missing close tag cannot grow the match buffer without limit. */
export const SYSTEM_INSTRUCTION_ECHO_MAX_CHARS = 256 * 1024;

export function wrapSystemInstructions(instructions: string): string {
  return `${SYSTEM_INSTRUCTIONS_OPEN}\n${instructions}\n${SYSTEM_INSTRUCTIONS_CLOSE}`;
}

export function concatenatedAcpPromptText(
  blocks: readonly { type: string; text?: string }[],
): string {
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

export interface SystemInstructionEchoStripper {
  arm(expectedEcho: string): void;
  consume(chunk: string): string;
  finish(): void;
}

export function createSystemInstructionEchoStripper(): SystemInstructionEchoStripper {
  let expectedEcho: string | undefined;
  let buffer = "";
  let done = true;

  function disarm(): void {
    expectedEcho = undefined;
    buffer = "";
    done = true;
  }

  return {
    arm(echo: string): void {
      expectedEcho = echo;
      buffer = "";
      done = echo.length === 0;
    },
    consume(chunk: string): string {
      if (done || expectedEcho === undefined) {
        return chunk;
      }
      buffer += chunk;
      if (buffer.length > SYSTEM_INSTRUCTION_ECHO_MAX_CHARS) {
        const overflow = buffer;
        disarm();
        return overflow;
      }
      const result = consumeEchoBuffer(buffer, expectedEcho);
      buffer = result.buffer;
      if (result.done) {
        disarm();
      }
      return result.emit;
    },
    finish(): void {
      disarm();
    },
  };
}

function consumeEchoBuffer(
  buffer: string,
  expectedEcho: string,
): { emit: string; buffer: string; done: boolean } {
  const lead = buffer.match(/^\s*/u)?.[0]?.length ?? 0;
  const rest = buffer.slice(lead);
  if (rest.length === 0) {
    return { emit: "", buffer, done: false };
  }

  if (rest.startsWith(expectedEcho)) {
    return {
      emit: rest.slice(expectedEcho.length).replace(/^\s+/u, ""),
      buffer: "",
      done: true,
    };
  }
  if (expectedEcho.startsWith(rest)) {
    return { emit: "", buffer, done: false };
  }

  if (rest.startsWith(SYSTEM_INSTRUCTIONS_OPEN)) {
    const closeAt = rest.indexOf(SYSTEM_INSTRUCTIONS_CLOSE);
    if (closeAt === -1) {
      return { emit: "", buffer, done: false };
    }
    return {
      emit: rest
        .slice(closeAt + SYSTEM_INSTRUCTIONS_CLOSE.length)
        .replace(/^\s+/u, ""),
      buffer: "",
      done: true,
    };
  }
  if (SYSTEM_INSTRUCTIONS_OPEN.startsWith(rest)) {
    return { emit: "", buffer, done: false };
  }

  return { emit: buffer, buffer: "", done: true };
}
