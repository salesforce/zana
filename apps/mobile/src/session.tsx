import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import CookieManager from '@react-native-cookies/cookies';
import { useProfiles } from './state';
import { connectNativeProfile } from './lib/session-controller';

interface Session {
  profileId?: string;
  credential?: string;
  ready: boolean;
  revision: number;
  error: unknown;
}
interface SessionContext extends Session {
  resumeRevision: number;
  reconnect(): void;
}
const Context = createContext<SessionContext | null>(null);

/** One cookie owner for the entire router, including screens retained behind deep links. */
export function NativeSessionProvider({ children }: { children: ReactNode }) {
  const { state } = useProfiles();
  const profile = state.profiles.find((p) => p.id === state.activeId);
  const [session, setSession] = useState<Session>({ ready: false, revision: 0, error: null });
  const [retry, setRetry] = useState(0);
  const [resumeRevision, setResumeRevision] = useState(0);
  useEffect(() => {
    if (!profile) return;
    return connectNativeProfile(profile, {
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      cookies: CookieManager,
      subscribe: (listener) => {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
      onReady: () =>
        setSession((s) => ({
          profileId: profile.id,
          credential: profile.credential,
          ready: true,
          revision: s.revision + 1,
          error: null
        })),
      onError: (error) =>
        setSession((s) => ({
          ...s,
          profileId: profile.id,
          credential: profile.credential,
          ready: false,
          error
        })),
      onResume: () => setResumeRevision((n) => n + 1)
    });
  }, [profile?.id, profile?.credential, retry]);
  const reconnect = useCallback(() => {
    setSession((s) => ({ ...s, ready: false, error: null }));
    setRetry((n) => n + 1);
  }, []);
  const current = session.profileId === profile?.id && session.credential === profile?.credential;
  return (
    <Context.Provider
      value={{
        ...session,
        ready: !!profile && current && session.ready,
        error: current ? session.error : null,
        resumeRevision,
        reconnect
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useNativeSession() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing native session provider');
  return context;
}
