import { useEffect, useRef, useState } from "react";

export function ActionDialog({
  title,
  message,
  input,
  onClose,
  onConfirm,
}: {
  title: string;
  message?: string;
  input?: string;
  onClose(): void;
  onConfirm(value: string): void;
}) {
  const [value, setValue] = useState(input ?? "");
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const nodes = () => [
      ...(dialog.current?.querySelectorAll<HTMLElement>("input,button") ?? []),
    ];
    nodes()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const controls = nodes();
        if (event.shiftKey && document.activeElement === controls[0]) {
          event.preventDefault();
          controls.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === controls.at(-1)
        ) {
          event.preventDefault();
          controls[0]?.focus();
        }
      }
    };
    const element = dialog.current;
    element?.addEventListener("keydown", key);
    return () => {
      element?.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="sf-dialog-backdrop">
      <div
        className="sf-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialog}
      >
        <h3>{title}</h3>
        {message && <p>{message}</p>}
        {input !== undefined && (
          <label className="sf-form">
            Name
            <input
              className="sf-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        )}
        <div className="sf-row">
          <span className="sf-grow" />
          <button className="sf-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="sf-btn primary"
            type="button"
            disabled={input !== undefined && !value.trim()}
            onClick={() => onConfirm(value)}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
