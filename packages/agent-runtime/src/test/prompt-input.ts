import type { PromptInput } from "@zana-ai/zcc-domain/thread-runtime";

export interface PromptTextInputArgs {
  text: string;
}

export function promptTextInput(args: PromptTextInputArgs): PromptInput {
  return { type: "text", text: args.text, mentions: [] };
}
