import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { placePopoverMenu, useExclusivePopover } from '../../ui/PopoverPicklist.js';
import { stripModelBrandPrefix } from './model-brand-prefix.js';
import type { ModelPickerOption, PickerOption } from './model-picker-option.js';
import {
  buildModelNavRows,
  fuzzyFilter,
  modelSearchText,
  pinSelectedMoreModels,
  splitModelLabelTag
} from './model-picker-search.js';
import { providerIconForId } from './provider-icon.js';
import { emptyModelsHint } from './harness-login.js';

const MODEL_SEARCH_MIN_OPTIONS = 5;
const MENU_MIN_WIDTH = 208;

function ProviderMark({
  providerId,
  label,
  size
}: {
  providerId: string;
  label: string;
  size: number;
}) {
  const Icon = providerIconForId(providerId);
  if (Icon) return <Icon size={size} />;
  return <>{label.charAt(0)}</>;
}

export function showHarnessTabs(
  onSelectedProviderChange: ((value: string) => void) | undefined,
  providerCount: number
): boolean {
  return Boolean(onSelectedProviderChange) && providerCount > 1;
}

export interface ModelReasoningPickerProps {
  providerOptions: readonly PickerOption<string>[];
  selectedProviderId: string;
  /** Omit to lock the harness (tabs hidden). */
  onSelectedProviderChange?: (value: string) => void;
  modelValue: string;
  modelOptions: readonly ModelPickerOption[];
  moreModelOptions?: readonly ModelPickerOption[];
  modelIsLoading?: boolean;
  modelLoadError?: string | null;
  onModelChange: (value: string) => void;
  disabled?: boolean;
}

export function ModelReasoningPicker({
  providerOptions,
  selectedProviderId,
  onSelectedProviderChange,
  modelValue,
  modelOptions,
  moreModelOptions = [],
  modelIsLoading = false,
  modelLoadError = null,
  onModelChange,
  disabled
}: ModelReasoningPickerProps) {
  const [open, setOpen] = useExclusivePopover();
  const [query, setQuery] = useState('');
  const [showMoreModels, setShowMoreModels] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreToggleRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const navId = useId();
  const canSwitchProviders = showHarnessTabs(onSelectedProviderChange, providerOptions.length);
  const selectedProvider = providerOptions.find((row) => row.value === selectedProviderId);
  const displayed = useMemo(
    () => pinSelectedMoreModels(modelOptions, moreModelOptions, modelValue),
    [modelOptions, moreModelOptions, modelValue]
  );
  const selectedModel = displayed.modelOptions.concat(displayed.moreModelOptions).find((row) => row.value === modelValue);
  const triggerModelLabel = modelIsLoading
    ? 'Loading models...'
    : stripModelBrandPrefix(selectedModel?.label ?? (modelValue || 'Select model'), selectedProviderId);
  const { base: triggerModelBase, tag: triggerModelTag } = splitModelLabelTag(triggerModelLabel);
  const triggerTitle = `${selectedProvider?.label ?? selectedProviderId}: ${triggerModelLabel}`;

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const filteredModels = useMemo(
    () => fuzzyFilter(displayed.modelOptions, normalizedQuery, (option) => modelSearchText(option, selectedProviderId)),
    [displayed.modelOptions, normalizedQuery, selectedProviderId]
  );
  const filteredMore = useMemo(
    () => fuzzyFilter(displayed.moreModelOptions, normalizedQuery, (option) => modelSearchText(option, selectedProviderId)),
    [displayed.moreModelOptions, normalizedQuery, selectedProviderId]
  );
  const navRows = useMemo(
    () => buildModelNavRows({
      modelOptions: filteredModels,
      moreModelOptions: filteredMore,
      isSearching
    }),
    [filteredModels, filteredMore, isSearching]
  );
  const showSearch = !modelIsLoading
    && displayed.modelOptions.length + displayed.moreModelOptions.length > MODEL_SEARCH_MIN_OPTIONS;
  const showMorePanel = open && showMoreModels && !isSearching && filteredMore.length > 0;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setShowMoreModels(false);
      setActiveIndex(-1);
    } else if (showSearch) {
      searchRef.current?.focus();
    }
  }, [open, showSearch]);

  useEffect(() => {
    if (isSearching) setShowMoreModels(false);
  }, [isSearching]);

  useEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const position = placePopoverMenu(rect, { width: window.innerWidth, height: window.innerHeight }, MENU_MIN_WIDTH);
    const menu = menuRef.current;
    menu.style.left = `${position.left}px`;
    menu.style.width = `${Math.max(position.width, MENU_MIN_WIDTH)}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
    if (position.bottom != null) {
      menu.style.bottom = `${position.bottom}px`;
      menu.style.top = 'auto';
    } else {
      menu.style.top = `${position.top}px`;
      menu.style.bottom = 'auto';
    }
  }, [open, navRows.length, canSwitchProviders]);

  useEffect(() => {
    if (!showMorePanel || !menuRef.current || !moreMenuRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const panel = moreMenuRef.current;
    const width = Math.max(menuRect.width, MENU_MIN_WIDTH);
    const gap = 6;
    let left = menuRect.right + gap;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, menuRect.left - width - gap);
    }
    const top = moreToggleRef.current?.getBoundingClientRect().top ?? menuRect.top;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(120, window.innerHeight - top - 8)}px`;
  }, [showMorePanel, filteredMore.length]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target)
        || menuRef.current?.contains(target)
        || moreMenuRef.current?.contains(target)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [open, setOpen]);

  const selectModel = (value: string) => {
    onModelChange(value);
    setOpen(false);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (navRows.length === 0) return;
      setActiveIndex((current) => (current >= navRows.length - 1 ? 0 : current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (navRows.length === 0) return;
      setActiveIndex((current) => (current <= 0 ? navRows.length - 1 : current - 1));
    } else if (event.key === 'Enter') {
      const row = navRows[activeIndex];
      if (!row) return;
      event.preventDefault();
      if (row.kind === 'model') selectModel(row.option.value);
      else setShowMoreModels((current) => !current);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="model-reasoning-picker-trigger"
      aria-label="Provider and model"
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      title={triggerTitle}
      data-testid="model-reasoning-picker-trigger"
      onClick={() => setOpen((current) => !current)}
    >
      <span className="model-reasoning-picker-trigger-icon" aria-hidden="true">
        <ProviderMark
          providerId={selectedProviderId}
          label={selectedProvider?.label ?? selectedProviderId}
          size={14}
        />
      </span>
      <span className="model-reasoning-picker-trigger-model">{triggerModelBase}</span>
      {triggerModelTag ? (
        <span className="model-reasoning-picker-trigger-tag">{triggerModelTag}</span>
      ) : null}
      {disabled ? null : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );

  if (disabled) return trigger;

  return (
    <>
      {trigger}
      {open && createPortal(
        <div
          ref={menuRef}
          className="model-reasoning-picker-menu model-reasoning-picker-menu--models"
          role="dialog"
          aria-label="Provider and model"
          data-testid="model-reasoning-picker-menu"
        >
          {canSwitchProviders ? (
            <div className="model-reasoning-picker-tabs" role="tablist" aria-label="Harness">
              {providerOptions.map((provider) => {
                const active = provider.value === selectedProviderId;
                return (
                  <button
                    key={provider.value}
                    type="button"
                    role="tab"
                    aria-label={provider.label}
                    aria-selected={active}
                    className={`model-reasoning-picker-tab${active ? ' is-active' : ''}`}
                    data-testid={`model-reasoning-provider-${provider.value}`}
                    onClick={() => {
                      if (provider.value !== selectedProviderId) onSelectedProviderChange?.(provider.value);
                    }}
                  >
                    <ProviderMark providerId={provider.value} label={provider.label} size={14} />
                  </button>
                );
              })}
            </div>
          ) : null}
          {showSearch ? (
            <div className="model-reasoning-picker-search">
              <Search size={13} aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                placeholder="Search models"
                aria-label="Search models"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(-1);
                }}
                onKeyDown={onSearchKeyDown}
              />
            </div>
          ) : null}
          <div className="model-reasoning-picker-section">
            <div className="model-reasoning-picker-section-label">Model</div>
            {modelIsLoading ? (
              <div className="model-reasoning-picker-hint">Loading models…</div>
            ) : navRows.length === 0 ? (
              <div className="model-reasoning-picker-hint">{emptyModelsHint(selectedProviderId, modelLoadError)}</div>
            ) : navRows.map((row, index) => {
              if (row.kind === 'more-toggle') {
                return (
                  <button
                    key="more-toggle"
                    ref={moreToggleRef}
                    type="button"
                    id={`${navId}-opt-${index}`}
                    className={`model-reasoning-picker-row${showMoreModels || activeIndex === index ? ' is-active' : ''}`}
                    aria-expanded={showMoreModels}
                    data-testid="model-reasoning-more-toggle"
                    onClick={() => setShowMoreModels((current) => !current)}
                  >
                    <span>More models</span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                );
              }
              const selected = row.option.value === modelValue;
              return (
                <button
                  key={row.option.value}
                  type="button"
                  id={`${navId}-opt-${index}`}
                  className={`model-reasoning-picker-row${selected ? ' is-selected' : ''}${activeIndex === index ? ' is-active' : ''}`}
                  data-testid={`model-reasoning-model-${row.option.value}`}
                  onClick={() => selectModel(row.option.value)}
                >
                  <span>{stripModelBrandPrefix(row.option.label, selectedProviderId)}</span>
                  {selected ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
      {showMorePanel && createPortal(
        <div
          ref={moreMenuRef}
          className="model-reasoning-picker-more"
          role="listbox"
          aria-label="More models"
          data-testid="model-reasoning-more-menu"
        >
          {filteredMore.map((option) => {
            const selected = option.value === modelValue;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`model-reasoning-picker-row${selected ? ' is-selected' : ''}`}
                data-testid={`model-reasoning-more-${option.value}`}
                onClick={() => selectModel(option.value)}
              >
                <span>{stripModelBrandPrefix(option.label, selectedProviderId)}</span>
                {selected ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
