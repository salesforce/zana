import type { ElectronApplication } from '@playwright/test';

export interface NativeDialogCall {
  title?: string;
  message?: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

/** Record native message boxes and return queued choices without desktop automation. */
export async function stubNativeDialogs(
  electron: ElectronApplication,
  responses: number[]
): Promise<void> {
  await electron.evaluate(({ dialog }, queued) => {
    const root = globalThis as typeof globalThis & {
      __zccE2eDialogs?: { responses: number[]; calls: NativeDialogCall[] };
    };
    root.__zccE2eDialogs = { responses: [...queued], calls: [] };
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length === 2 ? args[1] : args[0]) as NativeDialogCall;
      root.__zccE2eDialogs!.calls.push(JSON.parse(JSON.stringify(options)) as NativeDialogCall);
      return {
        response: root.__zccE2eDialogs!.responses.shift() ?? options.cancelId ?? 1,
        checkboxChecked: false
      };
    }) as typeof dialog.showMessageBox;
  }, responses);
}

export async function nativeDialogCalls(electron: ElectronApplication): Promise<NativeDialogCall[]> {
  return electron.evaluate(() => {
    const root = globalThis as typeof globalThis & {
      __zccE2eDialogs?: { calls: NativeDialogCall[] };
    };
    return root.__zccE2eDialogs?.calls ?? [];
  });
}
