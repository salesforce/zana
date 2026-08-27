import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { PromptMentionExtension } from '../components/composer/prompt-mention-extension.js';

export const NAVIGATE_TO_THREAD_ON_CREATE_KEY = 'zcc.navigateToThreadOnCreate';
export const NAVIGATE_TO_THREAD_ON_CREATE_DEFAULT = true;

export const MARKDOWN_IN_PROMPT_KEY = 'zcc.markdownInPrompt';
export const MARKDOWN_IN_PROMPT_DEFAULT = true;

export type ComposerSendMode = 'auto' | 'steer' | 'queue-if-active';

export function resolveThreadSendMode(args: {
  steerOnEnter: boolean;
  threadRunning: boolean;
  modifierEnter: boolean;
}): ComposerSendMode {
  if (!args.steerOnEnter || !args.threadRunning) return 'auto';
  return args.modifierEnter ? 'queue-if-active' : 'steer';
}

export function composerPromptExtensions(markdownEnabled: boolean, placeholder: string) {
  return [
    StarterKit.configure({
      heading: markdownEnabled ? { levels: [1, 2, 3] } : false,
      bold: markdownEnabled ? undefined : false,
      italic: markdownEnabled ? undefined : false,
      strike: markdownEnabled ? undefined : false,
      code: markdownEnabled ? undefined : false,
      codeBlock: markdownEnabled ? undefined : false,
      blockquote: markdownEnabled ? undefined : false,
      bulletList: markdownEnabled ? undefined : false,
      orderedList: markdownEnabled ? undefined : false,
      listItem: markdownEnabled ? undefined : false,
      horizontalRule: markdownEnabled ? undefined : false,
      // Prompt box: don't autolink paths or turn `/plan` into an <a>.
      link: false,
      trailingNode: false
    }),
    Placeholder.configure({ placeholder }),
    PromptMentionExtension
  ];
}
