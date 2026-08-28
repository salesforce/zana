/** Builtin Docs plugin server — UI stays compiled into the host renderer. */
export default function plugin(zcc) {
  zcc.log.info('docs plugin loaded');
  zcc.ui.registerMentionProvider({
    id: 'note',
    label: 'Docs',
    async search() {
      return [];
    },
    async resolve(itemId) {
      throw new Error(`unknown note: ${itemId}`);
    }
  });
}
