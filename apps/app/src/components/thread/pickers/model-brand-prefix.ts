/**
 * Drops the brand prefix from a model label once provider context is
 * unambiguous (the trigger shows the provider; the menu shows provider tabs).
 */
export function stripModelBrandPrefix(label: string, providerId: string): string {
  switch (providerId) {
    case 'claude-code':
      return label.replace(/^Claude\s+/i, '');
    case 'codex':
      return label.replace(/^GPT-/i, '');
    default:
      return label;
  }
}
