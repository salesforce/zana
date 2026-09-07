/**
 * Decide the native-role (`acpMode`) selection after the model catalog changes.
 *
 * Returns the value to select, or `undefined` to leave the current pick as-is.
 *
 * Rules:
 * - Initialize to the provider default (`currentValue`) when the user has not
 *   picked yet.
 * - Reset an explicit pick to the default ONLY when options are LOADED (non-empty)
 *   and the pick is genuinely absent from them (e.g. after switching provider).
 * - NEVER clobber a valid pick while options are momentarily empty — a reload /
 *   in-flight window (`reloadThreadProviderModels` deletes the cached entry and
 *   emits before the refetch, so `options` briefly falls back to `[]`). Clobbering
 *   there silently reverted a native-role pick (e.g. a selected role) back to the
 *   default `build`, so the launched session ran the wrong role.
 */
export function nextAcpModeSelection(input: {
  /** The provider default from the ACP `session/new` mode configOption. */
  current: string | undefined;
  /** The user's current pick (undefined = not yet chosen). */
  selected: string | undefined;
  /** The advertised mode options ([] while loading/reloading). */
  options: ReadonlyArray<{ value: string }>;
}): string | undefined {
  if (!input.current) return undefined;
  if (input.selected === undefined) return input.current;
  if (input.options.length > 0 && !input.options.some((option) => option.value === input.selected)) {
    return input.current;
  }
  return undefined;
}
