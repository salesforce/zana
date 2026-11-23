import { useEffect, useId, useRef, useState } from 'react';
import { AlarmClock, ArrowDownUp, Check, ChevronRight, CircleDot, Clock, Ellipsis } from 'lucide-react';
import {
  BASIC_CONVERSATION_SORTS, BASIC_CONVERSATION_STATUSES, BASIC_CONVERSATION_WINDOWS,
  isDefaultBasicConversationView, useBasicConversationView, type BasicConversationView
} from './basic-conversation-view.js';

type Choice = 'sort' | 'status' | 'window';
const CHOICES: Record<Choice, { label: string; icon: typeof Clock; options: ReadonlyArray<readonly [string, string]> }> = {
  sort: { label: 'Sort by', icon: ArrowDownUp, options: BASIC_CONVERSATION_SORTS },
  status: { label: 'Status', icon: CircleDot, options: BASIC_CONVERSATION_STATUSES },
  window: { label: 'Last activity', icon: Clock, options: BASIC_CONVERSATION_WINDOWS }
};
const optionLabel = (choice: Choice, value: string) => CHOICES[choice].options.find(([id]) => id === value)?.[1] ?? value;

/** Short summary of a non-default filter, shown beside the heading. */
export function basicConversationViewSummary(view: BasicConversationView): string {
  return [
    view.status !== 'active' && optionLabel('status', view.status),
    view.window !== 'all' && optionLabel('window', view.window),
    !view.automations && 'No automations'
  ].filter(Boolean).join(' · ');
}

/** The ••• menu beside the Basic sidebar "Conversations" heading. */
export function BasicConversationMenu() {
  const view = useBasicConversationView(s => s.view);
  const update = useBasicConversationView(s => s.update);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Choice | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = (focus = false) => {
    setOpen(false); setExpanded(null);
    if (focus) buttonRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!wrapRef.current?.contains(event.target as Node)) close(); };
    // Document-level: picking an option unmounts its button, so focus may sit outside the menu.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const filtered = !isDefaultBasicConversationView({ ...view, sort: 'activity' });
  const choice = (key: Choice) => {
    const { label, icon: Icon, options } = CHOICES[key];
    const isOpen = expanded === key;
    return <div key={key} className="basic-ui-conversation-menu-choice">
      <button type="button" role="menuitem" aria-haspopup="true" aria-expanded={isOpen}
        onClick={() => setExpanded(isOpen ? null : key)}>
        <Icon size={14} aria-hidden="true" /><span>{label}</span>
        <span className="basic-ui-conversation-menu-value">{optionLabel(key, view[key])}</span>
        <ChevronRight size={13} aria-hidden="true" className={isOpen ? 'is-open' : undefined} />
      </button>
      {isOpen && <div role="group" aria-label={label} className="basic-ui-conversation-menu-options">
        {options.map(([id, text]) => <button key={id} type="button" role="menuitemradio" aria-checked={view[key] === id}
          onClick={() => { update({ [key]: id } as Partial<BasicConversationView>); setExpanded(null); }}>
          <span>{text}</span>{view[key] === id && <Check size={14} aria-hidden="true" />}
        </button>)}
      </div>}
    </div>;
  };
  return <div className="basic-ui-conversation-menu-wrap" ref={wrapRef}>
    <button ref={buttonRef} type="button" className={`basic-ui-conversation-menu-button${filtered ? ' is-filtered' : ''}`}
      aria-label="Conversation view options" title="Conversation view options" aria-haspopup="menu"
      aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => (open ? close() : setOpen(true))}>
      <Ellipsis size={15} aria-hidden="true" />
    </button>
    {open && <div id={menuId} className="basic-ui-conversation-menu" role="menu" aria-label="Conversation view options">
      <span className="basic-ui-conversation-menu-label">Sort chats by</span>
      {choice('sort')}
      <span className="basic-ui-conversation-menu-label">Show</span>
      {choice('status')}
      {choice('window')}
      <button type="button" role="menuitemcheckbox" aria-checked={view.automations}
        className="basic-ui-conversation-menu-toggle" onClick={() => update({ automations: !view.automations })}>
        <AlarmClock size={14} aria-hidden="true" /><span>Automations</span>
        <span className="basic-ui-conversation-menu-switch" aria-hidden="true" />
      </button>
    </div>}
  </div>;
}
