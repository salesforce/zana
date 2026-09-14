import { useEffect, useId, useState, type FocusEvent } from 'react';
import { product } from '../lib/product-client.js';
import type { PluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';
import { ToggleSwitch } from '../components/settings/FormFields.js';
import {
  initialPluginSettingDraft,
  isMultilinePluginSetting,
  multilineSettingRows,
  parsePluginSettingDraft,
  pluginSettingControlPlacement,
  pluginSettingSavesOnChange,
  shouldSkipPluginSettingSave,
  type PluginSettingDescriptor,
  type PluginSettingDraft,
  type PluginSettingValue
} from './plugin-defined-settings.js';

export function PluginSettingsForm({
  snap,
  onSave
}: {
  snap: PluginSettingsSnapshot;
  onSave: (key: string, value: string | number | boolean | undefined) => void | Promise<void>;
}) {
  return (
    <div className="ext-plugin-settings-panel" data-testid="plugin-defined-settings">
      {Object.entries(snap.descriptors).map(([key, descriptor]) => (
        <AutosavingPluginSetting
          key={key}
          settingKey={key}
          descriptor={descriptor}
          storedValue={snap.values[key]}
          onSave={onSave}
        />
      ))}
    </div>
  );
}

function AutosavingPluginSetting({
  descriptor,
  settingKey,
  storedValue,
  onSave
}: {
  descriptor: PluginSettingDescriptor;
  settingKey: string;
  storedValue: PluginSettingValue;
  onSave: (key: string, value: string | number | boolean | undefined) => void | Promise<void>;
}) {
  const messageId = useId();
  const initialDraft = initialPluginSettingDraft(descriptor, storedValue);
  const [draftState, setDraftState] = useState({ value: initialDraft, dirty: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const draft = draftState.value;

  useEffect(() => {
    if (!draftState.dirty && !pending && error === null) {
      setDraftState({ value: initialDraft, dirty: false });
    }
  }, [draftState.dirty, error, initialDraft, pending]);

  const commit = async (value: PluginSettingDraft) => {
    if (shouldSkipPluginSettingSave(descriptor, value, storedValue)) {
      setDraftState({ value, dirty: false });
      return;
    }
    try {
      const parsed = parsePluginSettingDraft(descriptor, value);
      setDraftState({ value, dirty: false });
      setPending(true);
      setError(null);
      await onSave(settingKey, parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const changeDraft = (value: PluginSettingDraft) => {
    setDraftState({
      value,
      dirty: descriptor.type === 'string' || descriptor.type === 'number'
    });
    setError(null);
    if (pluginSettingSavesOnChange(descriptor)) void commit(value);
  };

  const saveDraft = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (pluginSettingSavesOnChange(descriptor)) return;
    if (descriptor.type === 'number' && event.currentTarget.validity.badInput) {
      setDraftState({ value: initialDraft, dirty: false });
      void commit('x');
      return;
    }
    void commit(draft);
  };

  const placement = pluginSettingControlPlacement(descriptor);
  return (
    <div
      className="plugin-setting-row"
      data-control-placement={placement}
      data-has-description={descriptor.description ? 'true' : undefined}
    >
      <div className="plugin-setting-copy">
        <div className="plugin-setting-label-row">
          <p className="plugin-setting-label">{descriptor.label}</p>
          {descriptor.secret === true ? <span className="plugin-setting-badge">secret</span> : null}
        </div>
        {descriptor.description ? <p className="plugin-setting-desc">{descriptor.description}</p> : null}
      </div>
      <div className="plugin-setting-control">
        <PluginSettingField
          descriptor={descriptor}
          draft={draft}
          storedValue={storedValue}
          ariaInvalid={error !== null}
          ariaDescribedBy={error !== null ? messageId : undefined}
          onChange={changeDraft}
          onBlur={saveDraft}
        />
        {error !== null ? (
          <p id={messageId} className="plugin-setting-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PluginSettingField({
  descriptor,
  draft,
  storedValue,
  ariaInvalid,
  ariaDescribedBy,
  onChange,
  onBlur
}: {
  descriptor: PluginSettingDescriptor;
  draft: PluginSettingDraft;
  storedValue: PluginSettingValue;
  ariaInvalid: boolean;
  ariaDescribedBy: string | undefined;
  onChange: (value: PluginSettingDraft) => void;
  onBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  if (descriptor.type === 'boolean') {
    return (
      <ToggleSwitch
        label={descriptor.label}
        checked={draft === true}
        onChange={(next) => onChange(next)}
      />
    );
  }
  if (descriptor.type === 'select' && descriptor.options) {
    const value = typeof draft === 'string' ? draft : '';
    return (
      <select
        aria-label={descriptor.label}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {descriptor.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (descriptor.type === 'number') {
    const value = typeof draft === 'string' ? draft : '';
    return (
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min={descriptor.min}
        max={descriptor.max}
        aria-label={descriptor.label}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    );
  }
  const isSecret = descriptor.secret === true;
  const value = typeof draft === 'string' ? draft : '';
  if (isMultilinePluginSetting(descriptor)) {
    return (
      <textarea
        aria-label={descriptor.label}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={multilineSettingRows(value)}
        className="plugin-setting-textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    );
  }
  const secretIsSet = isSecret && typeof storedValue === 'string' && storedValue.length > 0;
  return (
    <input
      type={isSecret ? 'password' : 'text'}
      aria-label={descriptor.label}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      placeholder={isSecret ? (secretIsSet ? '[set]' : '[not set]') : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  );
}

/** Host-generated form from `zcc.settings.define` descriptors. */
export function PluginDefinedSettings({ pluginId }: { pluginId: string }) {
  const [snap, setSnap] = useState<PluginSettingsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    product.pluginApps
      .getSettings(pluginId)
      .then((next) => {
        if (!cancelled) setSnap(next);
      })
      .catch(() => {
        if (!cancelled) setSnap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  if (!snap || Object.keys(snap.descriptors).length === 0) return null;

  const save = async (key: string, value: string | number | boolean | undefined) => {
    const next = await product.pluginApps.setSettings(pluginId, { [key]: value });
    setSnap(next);
  };

  return <PluginSettingsForm snap={snap} onSave={save} />;
}
