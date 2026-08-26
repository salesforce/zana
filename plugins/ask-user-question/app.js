export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.pendingInteraction({
      id: 'ask-user-question',
      component: function AskUserQuestionForm(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        const questions = Array.isArray(props.interaction.payload?.questions)
          ? props.interaction.payload.questions
          : [];
        return React.createElement(
          'div',
          null,
          questions.length === 0
            ? React.createElement('p', null, 'No questions in this prompt.')
            : questions.map((question, index) =>
                React.createElement(
                  'fieldset',
                  { key: index, style: { border: 0, padding: 0, marginBottom: 12 } },
                  React.createElement('legend', null, question.question ?? question.prompt ?? 'Question'),
                  (question.options ?? []).map((option, optionIndex) =>
                    React.createElement(
                      'button',
                      {
                        key: optionIndex,
                        type: 'button',
                        style: { display: 'block', marginTop: 6 },
                        onClick: () => props.submit({ answers: [{ question: question.question, selected: option.label ?? option }] })
                      },
                      option.label ?? String(option)
                    )
                  )
                )
              ),
          React.createElement(
            'button',
            { type: 'button', onClick: () => props.cancel() },
            'Cancel'
          )
        );
      }
    });
  }
};
