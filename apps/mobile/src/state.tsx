import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { ProfileStore, EMPTY_STATE, type MobileState } from './lib/profiles';
const store = new ProfileStore({
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    })
});
interface StateContext {
  state: MobileState;
  ready: boolean;
  error: string;
  update(change: (state: MobileState) => MobileState): Promise<void>;
}
const Context = createContext<StateContext | null>(null);
export function ProfilesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void store
      .load()
      .then((next) => {
        if (active) {
          setState(next);
          setReady(true);
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Context.Provider
      value={{
        state,
        ready,
        error,
        update: async (change) => {
          const next = await store.update(change);
          setState(next);
        }
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useProfiles() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing profiles provider');
  return context;
}
