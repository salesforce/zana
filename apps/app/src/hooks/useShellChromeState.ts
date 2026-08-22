import { getAppSurface, type AppSurface } from '../lib/app-surface.js';
import { product } from '../lib/product-client.js';
import { useEffect, useState } from 'react';
import {
  shellPlatform,
  shouldReserveMacosTrafficLights,
  type ShellPlatform
} from '../lib/shellChrome.js';

export interface ShellChromeState {
  platform: ShellPlatform;
  isFullScreen: boolean;
  surface: AppSurface;
  reserveMacosTrafficLights: boolean;
}

/** Reads window state once for the whole shell; individual headers stay pure. */
export function useShellChromeState(): ShellChromeState {
  const [platform] = useState(shellPlatform);
  const [surface] = useState(getAppSurface);
  const [isFullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    let active = true;
    void product.app.isFullScreen().then((fullScreen) => {
      if (active) setFullScreen(fullScreen);
    }).catch(() => {});
    const off = product.app.onFullScreenChanged(setFullScreen);
    return () => {
      active = false;
      off();
    };
  }, []);

  return {
    platform,
    isFullScreen,
    surface,
    reserveMacosTrafficLights: shouldReserveMacosTrafficLights(platform, isFullScreen, surface)
  };
}
