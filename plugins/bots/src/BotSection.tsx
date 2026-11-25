import type { ReactNode } from 'react';

/** Used by the bot workbench, the thread profile and the standalone Vault. */
export const botSectionCss = `
.bt-sec { margin-top: 20px; }
.bt-section-head {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
  gap: 8px; min-height: 28px; margin-bottom: 8px;
}
.bt-section-head h3 {
  margin: 0; font-size: 15px; line-height: 20px; font-weight: 600;
  color: var(--text-primary); letter-spacing: normal; text-transform: none;
}
.bt-card { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); }
.bt-row, .bt-sec .bt-form-row, .bt-empty-line, .bt-inset, .bt-memory { padding: 12px 16px; }
.bt-row { display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box; }
:where(button).bt-row { border: 0; background: transparent; text-align: left; cursor: pointer; font: inherit; color: inherit; }
button.bt-row:hover:enabled { background: var(--bg-hover); }
.bt-card > button.bt-row:first-child { border-start-start-radius: inherit; border-start-end-radius: inherit; }
.bt-card > button.bt-row:last-child { border-end-start-radius: inherit; border-end-end-radius: inherit; }
.bt-card > * + *, .bt-form > * + * { border-top: 1px solid var(--border); }
.bt-empty-line, .bt-sub { font-size: 12px; line-height: 18px; color: var(--text-muted); }
.bt-empty-line { margin: 0; }
.bt-sec [role=alert] { color: var(--danger, #f85149); }
.bt-form > :is([role=alert], [role=status]) { margin: 0; padding: 12px 16px; }
.bt-sub { display: block; }
.bt-row-title { font-weight: 500; overflow-wrap: anywhere; }
.bt-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px; box-sizing: border-box;
  min-height: 32px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-panel); color: var(--text-primary); font: inherit; line-height: 18px; white-space: nowrap; cursor: pointer;
}
.bt-btn:hover:enabled { background: var(--bg-hover); }
.bt-btn:disabled { opacity: .5; cursor: default; }
.bt-btn.is-primary { color: #fff; background: var(--accent-blue); border-color: var(--accent-blue); }
.bt-btn.is-primary:hover:enabled { background: color-mix(in srgb, var(--accent-blue) 90%, black); }
.bt-btn.is-ghost { border-color: transparent; background: transparent; }
.bt-btn.is-danger { color: var(--danger, #f85149); }
.bt-btn.is-sm { min-height: 28px; padding: 3px 10px; font-size: 12px; }
.bt-sec :focus-visible { outline: 2px solid var(--accent-blue); outline-offset: 2px; }
.bt-sec .bt-form-row {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  align-items: center; gap: 12px;
}
.bt-sec .bt-form-row > * { min-width: 0; }
.bt-form-row > .bt-btn { justify-self: start; }
.bt-sec .bt-form-row :is(input:not([type=checkbox]), select, textarea, .bt-picker), .bt-sec input[type=search] {
  box-sizing: border-box; width: 100%; min-width: 0; min-height: 34px;
}
.bt-sec :is(input:not([type=checkbox]), select, textarea) {
  border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px;
  background: var(--bg-base); color: var(--text-primary); font: inherit; line-height: 18px;
}
.bt-sec .bt-form-row:has(textarea), .bt-sec .bt-personality-field { align-items: start; }
.bt-form-footer { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 16px; }
@container bot-page (max-width: 540px) {
  .bt-sec .bt-form-row { grid-template-columns: minmax(0, 1fr); gap: 6px; }
}
`;

export function Section({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="bt-sec" aria-label={label}>
      <header className="bt-section-head"><h3>{label}</h3>{action}</header>
      <div className="bt-card">{children}</div>
    </section>
  );
}
