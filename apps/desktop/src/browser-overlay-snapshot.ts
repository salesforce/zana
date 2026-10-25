import { DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH } from '@zana-ai/zcc-desktop-contract';

interface SnapshotImage {
  isEmpty(): boolean;
  toJPEG(quality: number): Buffer;
}

/** Capture before yielding a native view to renderer menus; never delay hiding indefinitely. */
export function captureBrowserOverlaySnapshot({ capture, publish, hide }: {
  capture: () => Promise<SnapshotImage>;
  publish: (dataUrl: string) => void;
  hide: () => void;
}): () => void {
  let active = true;
  const finish = (image?: SnapshotImage) => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    try {
      if (image && !image.isEmpty()) {
        const dataUrl = `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
        if (dataUrl.length <= DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH) publish(dataUrl);
      }
    } catch {
      // A renderer that closed or failed to capture must still yield the view.
    } finally {
      hide();
    }
  };
  const timer = setTimeout(() => finish(), 250);
  try { void capture().then(finish, () => finish()); }
  catch { finish(); }
  return () => { active = false; clearTimeout(timer); };
}
