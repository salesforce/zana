import { useEffect, useState } from 'react';
import {
  shellPlatform,
  shouldReserveMacosTrafficLights,
  type ShellPlatform
} from '../lib/shellChrome.js';

export interface ShellChromeState {
  platform: ShellPlatform;
  isFullScreen: boolean;
  reserveMacosTrafficLights: boolean;
}

/** Reads window state once for the whole shell; individual headers stay pure. */
export function useShellChromeState(): ShellChromeState {
  const [platform] = useState(shellPlatform);
  const [isFullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    let active = true;
    void window.cc.app.isFullScreen().then((fullScreen) => {
      if (active) setFullScreen(fullScreen);
    }).catch(() => {});
    const off = window.cc.app.onFullScreenChanged(setFullScreen);
    return () => {
      active = false;
      off();
    };
  }, []);

  return {
    platform,
    isFullScreen,
    reserveMacosTrafficLights: shouldReserveMacosTrafficLights(platform, isFullScreen)
  };
}
