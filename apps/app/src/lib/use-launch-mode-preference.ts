import { useEffect, useState } from 'react';
import {
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
      setValue(next);
    }
  ];
}
