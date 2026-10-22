import { describe, expect, it, vi } from 'vitest';
import { copyText, copyTextOrFail } from './copy-text.js';

describe('copyText', () => {
  it('copies text through the web clipboard when there is no desktop bridge', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      await copyText('/tmp/proj');
      expect(writeText).toHaveBeenCalledWith('/tmp/proj');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('copies text through the desktop clipboard bridge', async () => {
    const writeText = vi.fn(async () => ({ ok: true as const }));
    const webWrite = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: webWrite } });
    vi.stubGlobal('window', { cc: { clipboard: { writeText } } });
    try {
      await copyText('Read README.md');
      expect(writeText).toHaveBeenCalledWith('Read README.md');
      expect(webWrite).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the web clipboard when the desktop write fails', async () => {
    const writeText = vi.fn(async () => ({ ok: false as const }));
    const webWrite = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: webWrite } });
    vi.stubGlobal('window', { cc: { clipboard: { writeText } } });
    try {
      await copyText('hello');
      expect(writeText).toHaveBeenCalledWith('hello');
      expect(webWrite).toHaveBeenCalledWith('hello');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves without a clipboard, so fire-and-forget callers stay quiet', async () => {
    vi.stubGlobal('navigator', {});
    try {
      await expect(copyText('hello')).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the web clipboard when the desktop bridge throws', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    const webWrite = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: webWrite } });
    vi.stubGlobal('window', { cc: { clipboard: { writeText } } });
    try {
      await copyText('hello');
      expect(webWrite).toHaveBeenCalledWith('hello');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('copyTextOrFail', () => {
  it('copies like copyText when a clipboard exists', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      await copyTextOrFail('hello');
      expect(writeText).toHaveBeenCalledWith('hello');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects when no clipboard is available, instead of reporting a copy', async () => {
    vi.stubGlobal('navigator', {});
    try {
      await expect(copyTextOrFail('hello')).rejects.toThrow('Clipboard unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects when the desktop write fails and there is no web clipboard', async () => {
    const writeText = vi.fn(async () => ({ ok: false as const }));
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { cc: { clipboard: { writeText } } });
    try {
      await expect(copyTextOrFail('hello')).rejects.toThrow('Clipboard unavailable');
      expect(writeText).toHaveBeenCalledWith('hello');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
