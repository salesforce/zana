// Minimal JSX typing for Electron's <webview> tag. We only use the
// subset of attributes/methods our webview embeds touch (e.g. the
// Library PDF preview).
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

export interface ElectronWebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getWebContentsId(): number;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<
        HTMLAttributes<ElectronWebviewElement> & {
          src?: string;
          partition?: string;
          allowpopups?: boolean | string;
          httpreferrer?: string;
          useragent?: string;
        },
        ElectronWebviewElement
      >;
    }
  }
}

export {};
