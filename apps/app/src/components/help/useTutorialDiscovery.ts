import { useCallback, useEffect, useState } from 'react';
import { readBooleanPreference, subscribeBooleanPreference, writeBooleanPreference } from '../../lib/boolean-preference.js';

export const TUTORIAL_DISCOVERY_DISMISSED_KEY = 'zcc.helpVideos.discoveryDismissed';
const BLOCKING_DIALOG = '[aria-modal="true"], [role="alertdialog"], dialog[open]';

/** Device-local discovery, offered once the shell and its startup dialogs settle. */
export function useTutorialDiscovery(eligible: boolean) {
  const [dismissed, setDismissed] = useState(() => readBooleanPreference(TUTORIAL_DISCOVERY_DISMISSED_KEY, false));
  const [ready, setReady] = useState(false);

  useEffect(() => subscribeBooleanPreference(() => {
    // Keep the session choice even if storage rejected our write.
    setDismissed(current => current || readBooleanPreference(TUTORIAL_DISCOVERY_DISMISSED_KEY, false));
  }), []);

  useEffect(() => {
    setReady(false);
    if (!eligible || dismissed) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      if (document.querySelector(BLOCKING_DIALOG)) setReady(false);
      else timer = setTimeout(() => setReady(true), 750);
    };
    // Dialogs portal outside the shell. Observe only while discovery is pending;
    // dismissal disconnects this observer and cancels its settling timer.
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-modal', 'role', 'open']
    });
    update();
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [eligible, dismissed]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    writeBooleanPreference(TUTORIAL_DISCOVERY_DISMISSED_KEY, true);
  }, []);

  return { visible: eligible && !dismissed && ready, dismiss };
}
