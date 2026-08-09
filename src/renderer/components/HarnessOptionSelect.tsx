import type { ProviderUiOption } from '@shared/launch-provider';

/**
 * The generic picker for a data-driven harness option axis.
 *
 * It renders a single `<select>` from a `ProviderUiOption[]` — the flat,
 * role-tagged catalog produced by `harnessOptions(profile)` in
 * `@shared/launch-provider`. Every model / permission-mode / sandbox / approval
 * selector in the app funnels through THIS, so the option list + sentinel +
 * disabled handling live in one place instead of a hand-rolled `{list.map(...)}`
 * per axis in every form. Adding a provider that understands a new set of models
 * is then a change to the shared catalog, never here.
 *
 * The two current callers differ only in binding, which this component absorbs:
 *  - PersonaEditor: the catalog carries its own `default` entry as the no-op
 *    value, so no `sentinel` is passed; an axis the profile ignores renders as a
 *    DISABLED control (empty `options` + `disabled`), which shows a lone
 *    `Default` so the control still reads sensibly.
 *  - ProjectTab: uses `sentinel={{ id: '', label: 'Use default' }}` (empty = "no
 *    per-project override") with `dropDefaultId` so the catalog's own `default`
 *    entry isn't offered as a duplicate of the sentinel.
 */
export interface HarnessOptionSelectProps {
  id: string;
  /** The role's options for the current profile (from `harnessOptions`). */
  options: ProviderUiOption[];
  value: string;
  onChange: (value: string) => void;
  /**
   * A sentinel option prepended to the list (e.g. `{ id: '', label: 'Use
   * default' }`). When set, any catalog entry with the same id is dropped so it
   * isn't offered twice.
   */
  sentinel?: ProviderUiOption;
  /**
   * Drop the catalog's built-in `default` entry — for callers whose `sentinel`
   * already expresses "no selection", so `default` would be a confusing twin.
   */
  dropDefaultId?: boolean;
  disabled?: boolean;
  /** Native `title` (hover copy explaining a disabled axis). */
  title?: string;
  /** Optional class for the caller's surrounding form layout. */
  className?: string;
  /** Fallback option shown when `options` is empty (e.g. a disabled control). */
  emptyOption?: ProviderUiOption;
}

const DEFAULT_EMPTY: ProviderUiOption = { id: 'default', label: 'Default' };

/**
 * Pure assembly of the rendered `<option>` list — extracted so the sentinel /
 * dropDefault / empty-fallback behaviour is unit-testable without a DOM. Order:
 * [sentinel?] + catalog (minus the built-in `default` when dropped, minus any
 * catalog entry duplicating the sentinel), falling back to `emptyOption` when
 * the catalog is empty.
 */
export function buildOptionList(args: {
  options: ProviderUiOption[];
  sentinel?: ProviderUiOption;
  dropDefaultId?: boolean;
  emptyOption?: ProviderUiOption;
}): ProviderUiOption[] {
  const { options, sentinel, dropDefaultId, emptyOption = DEFAULT_EMPTY } = args;
  let catalog = options;
  if (dropDefaultId) catalog = catalog.filter((o) => o.id !== 'default');
  if (sentinel) catalog = catalog.filter((o) => o.id !== sentinel.id);
  const rendered = catalog.length > 0 ? catalog : [emptyOption];
  return sentinel ? [sentinel, ...rendered] : rendered;
}

export function HarnessOptionSelect({
  id,
  options,
  value,
  onChange,
  sentinel,
  dropDefaultId,
  disabled,
  title,
  className,
  emptyOption = DEFAULT_EMPTY
}: HarnessOptionSelectProps) {
  const list = buildOptionList({ options, sentinel, dropDefaultId, emptyOption });

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      title={title}
      className={className}
    >
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
