import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';

export interface MachineProjectAction {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  title?: string;
  run(): void;
}
export function MachineProjectAddMenu({
  name,
  actions,
  note
}: {
  name: string;
  actions: MachineProjectAction[];
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => setOpen(false), []);
  useLayoutEffect(() => {
    if (!open) return;
    const button = anchor.current!,
      element = menu.current!,
      doc = button.ownerDocument,
      view = doc.defaultView!;
    const rect = button.getBoundingClientRect(),
      box = element.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.right - box.width, view.innerWidth - box.width - 8)
      ),
      top: Math.max(
        8,
        Math.min(rect.bottom + 6, view.innerHeight - box.height - 8)
      )
    });
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (e: Event) => {
      if (
        !element.contains(e.target as Node) &&
        !button.contains(e.target as Node)
      )
        dismiss();
    };
    const scroll = (e: Event) => {
      if (
        e.target === doc ||
        (e.target instanceof Element && e.target.contains(button))
      )
        dismiss();
    };
    doc.addEventListener('pointerdown', outside);
    doc.addEventListener('scroll', scroll, true);
    view.addEventListener('resize', dismiss);
    return () => {
      doc.removeEventListener('pointerdown', outside);
      doc.removeEventListener('scroll', scroll, true);
      view.removeEventListener('resize', dismiss);
    };
  }, [open, dismiss]);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="machine-project-add"
        aria-label={`Add project on ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={13} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="sidebar-projects-add-menu machine-add-dropdown"
            role="menu"
            aria-label={`Add project on ${name}`}
            style={position}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  anchor.current?.focus();
                }
                event.stopPropagation();
                dismiss();
              } else if (
                ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
              ) {
                event.preventDefault();
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)'
                  )
                ];
                const index = buttons.indexOf(
                  event.target as HTMLButtonElement
                );
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (index +
                          (event.key === 'ArrowDown' ? 1 : -1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
            }}
          >
            {note && <p className="machine-add-dropdown-note">{note}</p>}
            {actions.map((action) => (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                key={action.id}
                disabled={action.disabled}
                title={action.title}
                onClick={() => {
                  dismiss();
                  action.run();
                }}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
