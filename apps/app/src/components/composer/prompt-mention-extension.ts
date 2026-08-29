import Mention from '@tiptap/extension-mention';

export const PromptMentionExtension = Mention.extend({
  addAttributes() {
    const parentAttributes = this.parent?.() ?? {};
    return {
      ...parentAttributes,
      resource: { default: null },
      serializedText: { default: null }
    };
  }
}).configure({
  HTMLAttributes: { class: 'prompt-mention-pill' },
  deleteTriggerWithBackspace: true,
  renderText({ node }) {
    return typeof node.attrs.serializedText === 'string' ? node.attrs.serializedText : '';
  },
  renderHTML({ node }) {
    const label = typeof node.attrs.label === 'string' && node.attrs.label
      ? node.attrs.label
      : typeof node.attrs.serializedText === 'string'
        ? node.attrs.serializedText
        : '';
    return ['span', { class: 'prompt-mention-pill' }, label];
  },
  suggestion: {
    char: '@',
    allow: () => false,
    allowSpaces: false,
    items: () => [],
    render: () => ({
      onStart: () => undefined,
      onUpdate: () => undefined,
      onExit: () => undefined
    })
  }
});
