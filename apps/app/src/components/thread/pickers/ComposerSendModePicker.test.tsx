// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerSendModePicker } from './ComposerSendModePicker.js';
import { COMPOSER_SEND_MODE_OPTIONS } from './composer-send-mode-options.js';

afterEach(cleanup);

describe('ComposerSendModePicker', () => {
  it('lists the shared send-mode options and reports a pick', () => {
    const onChange = vi.fn();
    render(<ComposerSendModePicker value="queue-if-active" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('composer-send-mode-picker'));
    const target = COMPOSER_SEND_MODE_OPTIONS.find((row) => row.value !== 'queue-if-active')!;
    fireEvent.click(screen.getByRole('option', { name: new RegExp(target.label) }));
    expect(onChange).toHaveBeenCalledWith(target.value);
  });
});
