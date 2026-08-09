import { dialog, type BrowserWindow } from 'electron';
import type { ExecutionConsentDialogRequest, ExecutionConsentDialogResult } from './execution-consent.js';

/** Native main-process ceremony. Renderer receives neither approval controls nor grant material. */
export async function showExecutionConsentDialog(
  request: ExecutionConsentDialogRequest,
  parent?: BrowserWindow
): Promise<ExecutionConsentDialogResult> {
  const options = {
    type: 'warning' as const,
    title: 'Approve broadened execution policy',
    message: 'This execution mapping grants broader native behavior than requested.',
    detail: request.text,
    buttons: ['Allow once', 'Allow for this project', 'Cancel'],
    defaultId: 2,
    cancelId: 2,
    noLink: true
  };
  const result = parent && !parent.isDestroyed()
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) return { decision: 'approve', scope: 'one-launch' };
  if (result.response === 1) return { decision: 'approve', scope: 'project' };
  return { decision: 'cancel' };
}
