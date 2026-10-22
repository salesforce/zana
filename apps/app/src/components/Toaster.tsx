import { useUi } from '../store.js';

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind === 'error' ? 'error' : ''}`}
          onClick={() => dismiss(t.id)}
          role="status"
        >
          {t.message}
          {t.action && <button type="button" className="toast-action" onClick={(event) => {
            event.stopPropagation();
            dismiss(t.id);
            t.action?.onClick();
          }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
