/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VariablePresetPicker } from './VariablePresetPicker.js';
import type { ContextPreset } from '../../../lib/preview-context-preset-contract.js';
const preset: ContextPreset = { id: 'customer', name: 'Existing customer', revision: 3, updatedAt: 1, fields: [], values: [{ name: 'verified', type: 'Boolean', value: false }, { name: 'count', type: 'Number', value: 0 }, { name: 'record', type: 'Json', value: { nested: [1] } }, { name: 'locale', type: 'Text', value: null }] };
afterEach(cleanup);
function setup(extra: Partial<Parameters<typeof VariablePresetPicker>[0]> = {}) {
  const props = { presets: [preset], values: [], fields: [], onApply: vi.fn(), onReload: vi.fn(), ...extra };
  const view = render(<VariablePresetPicker {...props} />); return { props, ...view };
}
it('loads a detached typed copy, identifies matching values and returns to defaults', () => {
  const { props, rerender } = setup();
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: preset.id } });
  const values = props.onApply.mock.calls[0][0];
  expect(values).toEqual(preset.values); expect(values).not.toBe(preset.values);
  (values[2].value as any).nested.push(2); expect(preset.values[2].value).toEqual({ nested: [1] });
  rerender(<VariablePresetPicker {...props} values={preset.values} />);
  expect((screen.getByLabelText('Variable preset') as HTMLSelectElement).value).toBe(preset.id);
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: '' } }); expect(props.onApply).toHaveBeenLastCalledWith([]);
  rerender(<VariablePresetPicker {...props} values={[{ name: 'custom', type: 'Text', value: 'value' }]} />);
  expect((screen.getByLabelText('Variable preset') as HTMLSelectElement).value).toBe('__custom');
});
it.each([
  [{ name: 'verified', type: 'Number' as const, label: 'Verified' }, [], /now Number/],
  [undefined, [{ name: 'verified', type: 'Boolean' as const, label: 'Verified', declared: true }], /no longer declared/]
])('refuses presets that no longer match declared variables', (field, fields, error) => {
  const { props } = setup({ fields: field ? [field] : [], presets: [{ ...preset, fields }] });
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: preset.id } });
  expect(screen.getByRole('alert').textContent).toMatch(error); expect(props.onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload presets' })); expect(props.onReload).toHaveBeenCalled();
});
it('handles malformed or missing presets, loading, errors and an empty catalogue', () => {
  const { props, rerender } = setup({ presets: [{ ...preset, values: [{ name: 'bad.name', type: 'Text', value: '' }] }] });
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: preset.id } }); expect(screen.getByRole('alert').textContent).toContain('variable name');
  rerender(<VariablePresetPicker {...props} presets={[]} values={[{ name: 'x', type: 'Text', value: 'custom' }]} />);
  fireEvent.change(screen.getByLabelText('Variable preset'), { target: { value: '__custom' } }); expect(screen.getByRole('alert').textContent).toContain('unavailable');
  rerender(<VariablePresetPicker {...props} loading />); expect((screen.getByLabelText('Variable preset') as HTMLSelectElement).disabled).toBe(true);
  rerender(<VariablePresetPicker {...props} error="Offline" />); expect(screen.getByRole('alert').textContent).toContain('Offline');
  cleanup(); setup({ presets: [], onReload: undefined }); expect(screen.getByText(/No saved presets yet/)).toBeTruthy();
});
