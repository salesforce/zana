/** Builtin ask-user-question plugin — registerTool + ui.requestInput. */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_QUESTION_TIMEOUT = '30 minutes';

/** Setting option -> how long a question card waits for an answer. Max is the host's 7-day cap. */
const QUESTION_TIMEOUT_OPTIONS = new Map([
  [DEFAULT_QUESTION_TIMEOUT, 30 * MINUTE_MS],
  ['1 hour', HOUR_MS],
  ['4 hours', 4 * HOUR_MS],
  ['8 hours', 8 * HOUR_MS],
  ['24 hours', DAY_MS],
  ['3 days', 3 * DAY_MS],
  ['7 days', 7 * DAY_MS]
]);

/** A stored value that is no longer an offered option falls back to the default instead of failing every question. */
function questionTimeoutMs(value) {
  return QUESTION_TIMEOUT_OPTIONS.get(value) ?? QUESTION_TIMEOUT_OPTIONS.get(DEFAULT_QUESTION_TIMEOUT);
}

export default function plugin(zcc) {
  const settings = zcc.settings.define({
    questionTimeout: {
      type: 'select',
      label: 'Question timeout',
      description: 'How long a question card stays open waiting for your answer.',
      options: [...QUESTION_TIMEOUT_OPTIONS.keys()],
      default: DEFAULT_QUESTION_TIMEOUT
    }
  });

  zcc.agents.registerTool({
    name: 'ask_user_question',
    description:
      'Ask the operator a structured multiple-choice question and wait for the answer. Use when you need a decision.',
    parameters: { type: 'object' },
    async execute(input, ctx) {
      // Read per call so a changed setting applies to the next question; an open card keeps the timeout it started with.
      // The tool call's signal closes the card if the agent's call is torn down first.
      const { questionTimeout } = await settings.get();
      const result = await zcc.ui.requestInput({
        threadId: ctx.threadId,
        rendererId: 'ask-user-question',
        title: 'Question',
        payload: input && typeof input === 'object' ? input : { questions: [] },
        timeoutMs: questionTimeoutMs(questionTimeout)
      }, { signal: ctx.signal });
      return result;
    }
  });
}
