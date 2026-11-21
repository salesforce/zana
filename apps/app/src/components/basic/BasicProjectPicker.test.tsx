// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { BasicProjectPicker } from './BasicProjectPicker.js';

const h = vi.hoisted(() => ({ props: null as any }));
vi.mock('../ui/PopoverPicklist.js', () => ({ PopoverPicklist: (props: any) => {
  h.props = props;
  return <select aria-label={props.ariaLabel} value={props.value} onChange={event => props.onChange(event.target.value)}>
    <option value="">{props.placeholder}</option>
    {props.options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
} }));
afterEach(() => { cleanup(); h.props = null; });
const local = { id: 'local', name: 'My project', path: '/work/project' } as Project;
const remote = { id: 'remote', name: 'Website', path: '', hostId: 'remote-host', remote: { host: 'remote.example', remotePath: '/work/site' } } as Project;

it('offers projects without exposing machine or working-folder controls and preserves their identity', () => {
  const change = vi.fn();
  render(<BasicProjectPicker projects={[local, remote]} value="local" onChange={change} />);
  const picker = screen.getByRole('combobox', { name: 'Project' });
  expect(h.props.options).toEqual([{ value: 'local', label: 'My project' }, { value: 'remote', label: 'Website', description: 'Remote project' }]);
  fireEvent.change(picker, { target: { value: 'remote' } });
  expect(change).toHaveBeenCalledExactlyOnceWith(remote);
  expect(h.props.searchable).toBe(false);
});

it('names pinned projects without allowing a target change', () => {
  const change = vi.fn();
  render(<BasicProjectPicker projects={[]} value="remote" pinned={remote} onChange={change} />);
  expect(screen.getByLabelText('Project').textContent).toBe('Project: Website');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

it('handles an unavailable selection, ignores stale picks and offers search for a longer roster', () => {
  const change = vi.fn();
  render(<BasicProjectPicker projects={Array.from({ length: 6 }, (_, i) => ({ ...local, id: String(i) }))} value="missing" onChange={change} />);
  expect(h.props.placeholder).toBe('Choose a project');
  expect(h.props.searchable).toBe(true);
  h.props.onChange('removed');
  expect(change).not.toHaveBeenCalled();
});
