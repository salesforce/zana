// Adapted from BB da3e60b81d56, initialization-probe.ts; see docs/third-party/BB-LICENSE.
import { query, type Query, type SDKControlInitializeResponse, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeCodeExecutable } from "./session-options.js";

async function* idlePrompt(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

/** Initialize the native CLI without sending a model turn or persisting a conversation.
 * Let it resolve env, apiKeyHelper, config dir, and enterprise gateway settings.
 */
export async function withInitializedClaude<T>(
  read: (session: Query, initialization: SDKControlInitializeResponse) => Promise<T>,
  { env = process.env, cwd = process.cwd(), timeoutMs = 7_000 }: {
    env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number;
  } = {},
): Promise<T> {
  const promptEnd = new AbortController();
  const executable = resolveClaudeCodeExecutable({ env });
  let session: Query | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    session = query({
      prompt: idlePrompt(promptEnd.signal),
      options: {
        cwd, env, persistSession: false,
        settingSources: ["user", "project", "local"],
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      },
    });
    const active = session;
    return await Promise.race([
      active.initializationResult().then((initialization) => read(active, initialization)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Claude readiness check timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    promptEnd.abort();
    session?.close();
  }
}
