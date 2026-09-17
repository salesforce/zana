import type { KeyboardEvent } from "react";

export function SalesforceTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  panelId,
}: {
  label: string;
  items: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange(value: T): void;
  panelId: string;
}) {
  function keydown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % items.length
        : event.key === "ArrowLeft"
          ? (index + items.length - 1) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(items[next][0]);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
      [next]?.focus();
  }
  return (
    <div className="sf-tabs" role="tablist" aria-label={label}>
      {items.map(([id, title], index) => (
        <button
          type="button"
          key={id}
          id={`${panelId}-${id}`}
          className="sf-tab"
          role="tab"
          aria-controls={panelId}
          aria-selected={value === id}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => keydown(event, index)}
        >
          {title}
        </button>
      ))}
    </div>
  );
}
