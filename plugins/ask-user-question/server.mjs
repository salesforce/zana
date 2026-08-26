/** Builtin ask-user-question plugin — registerTool + ui.requestInput. */
export default function plugin(zcc) {
  zcc.agents.registerTool({
    name: 'ask_user_question',
    description:
      'Ask the operator a structured multiple-choice question and wait for the answer. Use when you need a decision.',
    async execute(input, ctx) {
      const result = await zcc.ui.requestInput({
        threadId: ctx.threadId,
        rendererId: 'ask-user-question',
        title: 'Question',
        payload: input && typeof input === 'object' ? input : { questions: [] }
      });
      return result;
    }
  });
}
