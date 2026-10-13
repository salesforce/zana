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

const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      // Keep legacy strings intact through provider-side validation so execute can normalize them.
      // Empty arrays must also reach execute for the actionable error below, without opening a card.
      type: ['array', 'string'],
      description: 'Every question for the operator, asked together in one card. Prefer an array; a JSON-encoded array is accepted for compatibility.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The full question text.' },
          header: { type: 'string', description: 'Optional short label shown above the question.' },
          multiSelect: { type: 'boolean', description: 'Allow more than one option to be chosen.' },
          options: {
            type: ['array', 'string'],
            description: 'Prefer an array of choice objects. Bare-string choices and a JSON-encoded array are also accepted.',
            items: {
              type: ['object', 'string'],
              properties: {
                label: { type: 'string', description: 'The choice shown to the operator.' },
                description: { type: 'string', description: 'Optional explanation of the choice.' }
              },
              required: ['label']
            }
          }
        },
        required: ['question', 'options']
      }
    }
  },
  required: ['questions']
};

/** Parse a JSON-encoded value; models sometimes send an object or array argument as a string. */
function decoded(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOption(option) {
  if (typeof option === 'string') return text(option) ? { label: text(option) } : null;
  const label = text(option?.label);
  if (!label) return null;
  const description = text(option.description);
  return description ? { label, description } : { label };
}

function normalizeQuestion(item) {
  const question = text(item?.question) || text(item?.prompt);
  const rawOptions = decoded(item?.options);
  const options = Array.isArray(rawOptions) ? rawOptions.map(normalizeOption).filter(Boolean) : [];
  if (!question || options.length === 0) return null;
  const header = text(item.header);
  return {
    question,
    ...(header ? { header } : {}),
    ...(item.multiSelect === true ? { multiSelect: true } : {}),
    options
  };
}

/**
 * Coerce tool input into `{ questions }` the card can render. Providers without schema-constrained tool calls
 * (Pi) send `questions` as a JSON string and options as bare strings; a single question object is accepted too.
 */
function normalizeQuestions(input) {
  const root = decoded(input);
  const raw = decoded(root?.questions) ?? (root?.question !== undefined ? [root] : undefined);
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return items.map(normalizeQuestion).filter(Boolean);
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
    parameters: QUESTIONS_SCHEMA,
    async execute(input, ctx) {
      const questions = normalizeQuestions(input);
      if (questions.length === 0) {
        // An empty card can't be answered and would hold the agent until the timeout; let it retry instead.
        throw new Error(
          'ask_user_question needs { "questions": [{ "question": "…", "options": [{ "label": "…" }] }] } ' +
            'with at least one question that has text and at least one option.'
        );
      }
      // Read per call so a changed setting applies to the next question; an open card keeps the timeout it started with.
      // The tool call's signal closes the card if the agent's call is torn down first.
      const { questionTimeout } = await settings.get();
      const result = await zcc.ui.requestInput({
        threadId: ctx.threadId,
        rendererId: 'ask-user-question',
        title: 'Question',
        payload: { questions },
        timeoutMs: questionTimeoutMs(questionTimeout)
      }, { signal: ctx.signal });
      return result;
    }
  });
}
