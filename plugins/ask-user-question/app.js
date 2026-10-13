// The host owns the question UI, navigation, keyboard shortcuts, and retained drafts.
// This adapter preserves the tool's answer format across every harness.
export function questionForm(interaction) {
  const questions = interaction.payload.questions.map((question, index) => ({
    id: `question-${index}`,
    prompt: question.question,
    shortLabel: question.header,
    multiSelect: Boolean(question.multiSelect),
    allowFreeText: true,
    options: question.options.map(option => ({
      value: option.label,
      label: option.label,
      description: option.description
    }))
  }));
  return {
    questions,
    toResponse: answers => ({
      answers: questions.map(question => ({
        question: question.prompt,
        selected: answers[question.id]?.selected ?? [],
        freeText: answers[question.id]?.freeText ?? ''
      }))
    })
  };
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.pendingInteraction({ id: 'ask-user-question', questionForm });
  }
};
