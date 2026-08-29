import { useEffect, useState } from 'react';
import {
  readBooleanPreference,
  subscribeBooleanPreference,
  writeBooleanPreference
} from './boolean-preference.js';

export function useBooleanPreference(key: string, defaultValue: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => readBooleanPreference(key, defaultValue));
  useEffect(() => subscribeBooleanPreference(() => {
    setValue(readBooleanPreference(key, defaultValue));
  }), [defaultValue, key]);
  return [
    value,
    (next) => {
      writeBooleanPreference(key, next);
      setValue(next);
    }
  ];
}
