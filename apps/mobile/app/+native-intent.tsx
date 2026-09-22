import { nativeIntent } from '../src/lib/urls';
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return nativeIntent(path);
}
