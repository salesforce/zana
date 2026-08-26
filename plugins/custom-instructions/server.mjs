/** Builtin custom-instructions plugin — settings + contributeInstructions. */
export default async function plugin(zcc) {
  const settings = zcc.settings.define({
    instructions: {
      type: 'string',
      label: 'Custom instructions',
      description: 'Included in later agent threads on this host. Blank contributes nothing.',
      default: ''
    }
  });

  const apply = async (values) => {
    const snapshot = values ?? (await settings.get());
    const text = typeof snapshot.instructions === 'string' ? snapshot.instructions.trim() : '';
    zcc.agents.contributeInstructions(text);
  };

  settings.onChange((next) => {
    void apply(next);
  });
  await apply();
}
