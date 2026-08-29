// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';

export function registerWindowsIpc(): void {
  
  ctx.safeHandle(
    IPC.windows.openProject,
    (projectId: string) => {
      // Trust gate (CLAUDE.md #1): ctx.openProjectWindow re-validates the
      // renderer-supplied id against the store before opening a window.
      ctx.openProjectWindow(projectId);
      return true;
    },
    () => false
  );
}

