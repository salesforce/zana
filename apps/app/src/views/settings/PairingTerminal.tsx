import { useEffect, useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { resolveTerminalTheme } from '../../lib/terminalThemes.js';
import { useData } from '../../store.js';

/**
 * Disposable xterm bound to the main-owned SSH pairing PTY. Independent of
 * TerminalSurface so pairing never becomes an Agents tab.
 */
export function PairingTerminal() {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const fontSize = useData((s) => s.fontSize);
  const theme = useData((s) => s.theme);
  const terminalTheme = useData((s) => s.terminalTheme);

  useLayoutEffect(() => {
    if (!ref.current || !hasDesktopBridge()) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, SF Mono, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: useData.getState().fontSize,
      theme: resolveTerminalTheme(useData.getState().terminalTheme, useData.getState().theme),
      scrollback: 4000
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    let replayDone = false;
    let pending: string[] | null = [];

    const write = (data: string) => {
      if (disposed) return;
      if (!replayDone) {
        pending?.push(data);
        return;
      }
      term.write(data);
    };

    const offData = product.hosts.pairing.onData(write);
    const offExit = product.hosts.pairing.onExit(() => undefined);

    void product.hosts.pairing.status().then((status) => {
      if (disposed) return;
      if (status.backlog) term.write(status.backlog);
      const queued = pending ?? [];
      pending = null;
      replayDone = true;
      for (const chunk of queued) term.write(chunk);
      term.focus();
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims) void product.hosts.pairing.resize(dims.cols, dims.rows);
      } catch {
        /* zero-size until the modal finishes layout */
      }
    }).catch(() => {
      if (disposed) return;
      const queued = pending ?? [];
      pending = null;
      replayDone = true;
      for (const chunk of queued) term.write(chunk);
    });

    term.onData((data) => {
      void product.hosts.pairing.write(data);
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims) void product.hosts.pairing.resize(dims.cols, dims.rows);
      } catch {
        /* ignore */
      }
    });
    ro.observe(ref.current);

    return () => {
      disposed = true;
      offData();
      offExit();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.fontSize = fontSize;
  }, [fontSize]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = resolveTerminalTheme(terminalTheme, theme);
  }, [theme, terminalTheme]);

  return (
    <div
      ref={ref}
      className="add-machine-pairing-terminal"
      data-testid="add-machine-pairing-terminal"
    />
  );
}
