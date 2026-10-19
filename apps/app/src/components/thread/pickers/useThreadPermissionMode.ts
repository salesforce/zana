import { useCallback, useEffect, useState } from 'react';
import { permissionModeSchema, type PermissionMode } from '@zana-ai/zcc-domain/thread-runtime';
import { permissionModeOptionsFor } from './permission-mode-options.js';
import { useBooleanPreference } from '../../../lib/use-boolean-preference.js';
import { FULL_ACCESS_BY_DEFAULT, FULL_ACCESS_BY_DEFAULT_KEY } from '../../../lib/composer-permission-preference.js';
import { useComposerSession, useComposerSetting } from '../../composer/ComposerDraft.js';
import type { ComposerSession } from '../../composer/composer-session.js';

export function useThreadPermissionMode({
  threadId,
  initialPermissionMode,
  supportedModes,
  session: suppliedSession,
  settingKey = 'permissionMode'
}: {
  threadId?: string;
  initialPermissionMode?: string | null;
  supportedModes?: readonly string[];
  session?: ComposerSession;
  settingKey?: string;
}) {
  const fallbackSession = useComposerSession(threadId ? JSON.stringify(['thread', threadId]) : undefined);
  const [saved, save, hasSaved] = useComposerSetting<PermissionMode | undefined>(suppliedSession ?? fallbackSession, settingKey, undefined);
  const [fullAccessByDefault] = useBooleanPreference(FULL_ACCESS_BY_DEFAULT_KEY, FULL_ACCESS_BY_DEFAULT);
  const parsed = permissionModeSchema.safeParse(initialPermissionMode);
  // New agents prefer automatic review; saved threads keep their original policy.
  // Keep this preference while the catalog loads, then project onto offered modes below.
  const persisted = parsed.success ? parsed.data : threadId ? 'accept-edits' : fullAccessByDefault ? 'full' : 'auto';
  const [selected, setSelected] = useState<PermissionMode>(saved ?? persisted);

  // Detail arrives asynchronously after creation/navigation. Repeated polls of
  // the same saved value must not overwrite a choice the user is still making.
  useEffect(() => {
    setSelected(hasSaved && saved ? saved : persisted);
  }, [threadId, persisted, hasSaved, saved]);

  const offered = permissionModeOptionsFor(supportedModes ?? []);
  const unavailable = offered.length > 0 && !offered.some((row) => row.value === selected);
  // A saved pick that is no longer offered stays selected (the picker shows its
  // placeholder) so the error and the picker agree; defaults snap silently.
  const permissionMode = unavailable && !hasSaved ? offered[0]!.value : selected;
  const selectionError = unavailable && hasSaved
    ? 'The saved permission policy is unavailable. Choose an available policy before sending.'
    : null;
  const setPermissionMode = useCallback((value: string) => {
    const next = permissionModeSchema.safeParse(value);
    if (next.success) { setSelected(next.data); save(next.data); }
  }, [save]);
  return { permissionMode, setPermissionMode, selectionError };
}
