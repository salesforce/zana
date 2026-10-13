// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard.js';

function stubClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
}

function stubExecCommand(result: boolean | Error) {
  const execCommand = vi.fn((command: string) => {
    if (result instanceof Error) throw result;
    return command === 'copy' && result;
  });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  return execCommand;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('copyText', () => {
  it('uses the async clipboard when it is allowed', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    const execCommand = stubExecCommand(true);
    await expect(copyText('ref')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('ref');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when the async clipboard is denied, and restores focus', async () => {
    stubClipboard(async () => {
      throw new DOMException('Write permission denied.', 'NotAllowedError');
    });
    let copied = '';
    const execCommand = stubExecCommand(true);
    execCommand.mockImplementation(() => {
      copied = document.querySelector('textarea')!.value;
      return true;
    });
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    await expect(copyText('::design-doc{id="dd_1"}')).resolves.toBe(true);
    expect(copied).toBe('::design-doc{id="dd_1"}');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('falls back when there is no async clipboard', async () => {
    stubClipboard();
    stubExecCommand(true);
    await expect(copyText('id')).resolves.toBe(true);
  });

  it('copies and removes the temporary textarea when no element has focus', async () => {
    stubClipboard();
    const execCommand = stubExecCommand(true);
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
    await expect(copyText('ref without focus')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when both paths fail', async () => {
    stubClipboard(async () => {
      throw new Error('denied');
    });
    stubExecCommand(false);
    await expect(copyText('id')).resolves.toBe(false);
    stubExecCommand(new Error('unsupported'));
    await expect(copyText('id')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
