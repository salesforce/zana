import type { ComponentType, KeyboardEvent } from "react";

export function SalesforceTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  panelId,
  orientation = "horizontal",
  icons,
}: {
  label: string;
  items: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange(value: T): void;
  panelId: string;
  /** Vertical draws an activity bar: icon over a short label. */
  orientation?: "horizontal" | "vertical";
  icons?: Partial<Record<T, ComponentType>>;
}) {
  const vertical = orientation === "vertical";
  function keydown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    const next =
      event.key === forward
        ? (index + 1) % items.length
        : event.key === back
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
    <div
      className={vertical ? "sf-tabs sf-activity-bar" : "sf-tabs"}
      role="tablist"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : undefined}
    >
      {items.map(([id, title], index) => {
        const Icon: ComponentType | undefined = icons?.[id];
        return (
          <button
            type="button"
            key={id}
            id={`${panelId}-${id}`}
            className="sf-tab"
            role="tab"
            title={vertical ? title : undefined}
            aria-controls={panelId}
            aria-selected={value === id}
            tabIndex={value === id ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => keydown(event, index)}
          >
            {Icon && <Icon />}
            {vertical ? <span>{title}</span> : title}
          </button>
        );
      })}
    </div>
  );
}
