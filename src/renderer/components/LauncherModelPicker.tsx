import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { HarnessModelTarget } from '@shared/harness-adapter';

const INITIAL_MODEL_COUNT = 6;

export function matchingLauncherModels(
  models: readonly HarnessModelTarget[],
  query: string
): readonly HarnessModelTarget[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return models.slice(0, INITIAL_MODEL_COUNT);
  return models.filter((model) =>
    model.label.toLowerCase().includes(normalizedQuery) || model.id.toLowerCase().includes(normalizedQuery)
  );
}

export function LauncherModelPicker({
  id,
  models,
  value,
  disabled,
  onChange
}: {
  id: string;
  models: readonly HarnessModelTarget[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const selected = models.find((model) => model.id === value);
  const normalizedQuery = query.trim();
  const visibleModels = useMemo(() => matchingLauncherModels(models, query), [models, query]);
  const hasMore = !normalizedQuery && models.length > visibleModels.length;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.bottom + 4, width: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    } else {
      setQuery('');
      if (wasOpenRef.current) triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="launch-model-picker-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected?.label ?? 'Default Model'}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="launch-model-picker-menu"
          role="listbox"
          aria-label="Model"
          style={position ? { left: position.left, top: position.top, width: position.width } : { visibility: 'hidden' }}
        >
          <div className="launch-model-picker-search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models"
              aria-label="Search models"
            />
          </div>
          <button
            type="button"
            className={`launch-model-picker-option${!value ? ' is-selected' : ''}`}
            role="option"
            aria-selected={!value}
            onClick={() => { onChange(''); setOpen(false); }}
          >
            <span>Default Model</span>
            {!value && <Check size={14} aria-hidden="true" />}
          </button>
          {visibleModels.map((model) => (
            <button
              key={model.id}
              type="button"
              className={`launch-model-picker-option${value === model.id ? ' is-selected' : ''}`}
              role="option"
              aria-selected={value === model.id}
              onClick={() => { onChange(model.id); setOpen(false); }}
              title={model.id}
            >
              <span>{model.label}</span>
              {value === model.id && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
          {hasMore && <div className="launch-model-picker-hint">Search all {models.length} models</div>}
          {normalizedQuery && visibleModels.length === 0 && <div className="launch-model-picker-hint">No matching models</div>}
        </div>,
        document.body
      )}
    </>
  );
}
