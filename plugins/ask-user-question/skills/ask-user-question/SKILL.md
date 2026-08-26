---
name: ask-user-question
description: Ask the operator a structured multiple-choice question in the ZCC thread workbench. Use when you need a human decision rather than guessing.
---

# Ask the user a question

Prefer this plugin over free-text "what should I do?" when the decision is
small and option-shaped. The host renders a `pendingInteraction` form.

From a plugin server factory:

```js
zcc.agents.registerTool({
  name: 'ask_user_question',
  description: 'Ask the operator a structured question',
  execute(input, ctx) {
    return zcc.ui.requestInput({
      threadId: ctx.threadId,
      rendererId: 'ask-user-question',
      title: 'Question',
      payload: input
    });
  }
});
```

`rendererId` must match the `pendingInteraction` slot `id`. Payload fields
mirror Claude's `AskUserQuestion` tool (`questions[].question`, `header`,
`options[].label` / `description`, `multiSelect`).
