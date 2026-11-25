import { useEffect, useState } from 'react';
import { product } from './product-client.js';
import {
  launchModeMirrorPatch,
  readLaunchModePreference,
  subscribeLaunchModePreference,
  writeLaunchModePreference,
  type LaunchMode
} from './launch-mode-preference.js';

export function useLaunchModePreference(): [LaunchMode, (mode: LaunchMode) => void] {
  const [value, setValue] = useState(readLaunchModePreference);
  useEffect(() => subscribeLaunchModePreference(() => {
    setValue(readLaunchModePreference());
  }), []);
  return [
    value,
    (next) => {
      writeLaunchModePreference(next);
      product.config.set(launchModeMirrorPatch(next)).catch((error) => {
        console.warn(`launch-mode mirror write failed (mode ${next}); main keeps the previous mode until the next change`, error);
      });
      setValue(next);
    }
  ];
}
