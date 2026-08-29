/** Builtin custom-instructions plugin — KV + RPC + CLI + contributeInstructions. */

export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4096;
const STORAGE_KEY = 'customInstructions';

function invalidInput(message, issues = [{ message }]) {
  const error = new Error(message);
  error.code = 'invalid_input';
  error.issues = issues;
  throw error;
}

function parseInstructionsInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    invalidInput('expected { instructions: string }');
  }
  const entries = Object.entries(input);
  if (entries.length !== 1 || entries[0]?.[0] !== 'instructions') {
    invalidInput('expected exactly one field: "instructions"');
  }
  const instructions = entries[0][1];
  if (typeof instructions !== 'string') {
    invalidInput('"instructions" must be a string');
  }
  if (instructions.length > MAX_CUSTOM_INSTRUCTIONS_LENGTH) {
    invalidInput(
      `"instructions" must be at most ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters`
    );
  }
  return instructions;
}

function assertGetInstructionsInput(input) {
  if (input == null) return;
  invalidInput('expected no input');
}

function response(instructions) {
  return { instructions, maxLength: MAX_CUSTOM_INSTRUCTIONS_LENGTH };
}

export default async function plugin(zcc) {
  let customInstructions = (await zcc.storage.kv.get(STORAGE_KEY)) ?? '';
  if (typeof customInstructions !== 'string') customInstructions = '';

  const applyContribution = () => {
    zcc.agents.contributeInstructions(customInstructions);
  };

  const persist = async (instructions) => {
    await zcc.storage.kv.set(STORAGE_KEY, instructions);
    customInstructions = instructions;
    applyContribution();
  };

  zcc.rpc.register(
    {
      getInstructions: {},
      saveInstructions: {}
    },
    {
      getInstructions(input) {
        assertGetInstructionsInput(input);
        return response(customInstructions);
      },
      async saveInstructions(input) {
        const instructions = parseInstructionsInput(input);
        await persist(instructions);
        return response(customInstructions);
      }
    }
  );

  applyContribution();

  zcc.cli.register({
    name: 'instructions',
    summary: 'Read and update the custom instructions injected into agents',
    commands: [
      {
        name: 'get',
        summary: 'Print the current custom instructions',
        usage: 'zcc instructions get [--json]'
      },
      {
        name: 'set',
        summary: 'Replace the custom instructions',
        usage: 'zcc instructions set <text...> [--json]'
      },
      {
        name: 'clear',
        summary: 'Clear the custom instructions',
        usage: 'zcc instructions clear [--json]'
      }
    ],
    async run(argv) {
      const json = argv.includes('--json');
      const positional = argv.filter((value) => value !== '--json');
      const [command, ...rest] = positional;
      if (command === 'get') {
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ instructions: customInstructions })
            : customInstructions
        };
      }
      if (command === 'set') {
        const instructions = parseInstructionsInput({
          instructions: rest.join(' ')
        });
        await persist(instructions);
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ instructions: customInstructions })
            : 'Custom instructions updated'
        };
      }
      if (command === 'clear') {
        await persist('');
        return {
          exitCode: 0,
          stdout: json ? JSON.stringify({ instructions: '' }) : 'Custom instructions cleared'
        };
      }
      return {
        exitCode: 1,
        stderr: 'Usage: zcc instructions get|set <text...>|clear [--json]'
      };
    }
  });
}
