// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { MachineProjectGroup } from '../lib/machine-projects.js';
import { DesktopProjectPicker, type DesktopProjectOption } from './DesktopProjectPicker.js';

const machines = [
  { id: 'local', name: 'This Mac', primary: true, host: { status: 'connected', homeDir: '/Users/test' }, projects: [] },
  { id: 'dev', name: 'Devbox', primary: false, host: { status: 'disconnected', homeDir: '/home/dev' }, projects: [] },
  { id: 'empty', name: 'Empty', primary: false, projects: [] },
] as MachineProjectGroup[];
const options: DesktopProjectOption[] = [
  { value: 'scratch', label: 'This Mac › Default Project', description: 'General tasks on This Mac', machineId: 'local', project: { name: 'Default Project', quickAgent: true, path: '/scratch' } as Project },
  { value: 'app', label: 'This Mac › app', description: '/Users/test/projects/app', machineId: 'local', project: { name: 'app', path: '/Users/test/projects/app' } as Project },
  { value: 'api', label: 'Devbox › api', description: '/home/dev/api', machineId: 'dev', project: { name: 'api', path: '/unused', remote: { remotePath: '/home/dev/api' } } as Project },
];
const originalWidth = window.innerWidth, originalHeight = window.innerHeight;
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true });
});
function setup(props: Partial<ComponentProps<typeof DesktopProjectPicker>> = {}) {
  const onChange = vi.fn(), onAddProject = vi.fn();
  const result = render(<DesktopProjectPicker ariaLabel="Location" value="app" machines={machines} options={options}
    selectedMachineId="local" onChange={onChange} onAddProject={onAddProject}
    searchPlaceholder="Search projects or machines…" emptyHint="No matches" {...props} />);
  const trigger = screen.getByRole('button', { name: 'Location' });
  return { ...result, onChange, onAddProject, trigger, open: () => fireEvent.click(trigger) };
}
const browse = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Machines' })).getByRole('button', { name }));

describe('desktop split project picker', () => {
  it('starts at the selected machine, shortens only its home prefix and keeps full path tooltips', () => {
    const { open } = setup(); open();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('~/projects/app')).toBeTruthy();
    expect(screen.getByRole('option', { name: /This Mac › app/ }).title).toBe('/Users/test/projects/app');
    expect(screen.getByRole('combobox')).toBe(document.activeElement);
    expect(screen.getByText('2 projects')).toBeTruthy();
  });
  it('browses machines without committing a location and adds to the browsed machine', () => {
    const { open, onChange, onAddProject } = setup(); open(); browse('Devbox Offline 1');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('~/api')).toBeTruthy();
    expect(screen.getByText('1 project')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add project on Devbox' }));
    expect(onAddProject).toHaveBeenCalledWith(machines[1]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('searches all machines and full paths, selects a result and restores trigger focus', () => {
    const { open, onChange, trigger } = setup(); open();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/home/dev' } });
    fireEvent.click(screen.getByRole('option', { name: /Devbox › api/ }));
    expect(onChange).toHaveBeenCalledWith('api');
    expect(document.activeElement).toBe(trigger);
    open();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'devbox' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    browse('This Mac Online 2');
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
  it('keeps add visible in empty search and empty machines', () => {
    const { open } = setup(); open(); browse('Empty Local 0');
    expect(screen.getByRole('status').textContent).toBe('No projects on this machine');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no such project' } });
    expect(screen.getByRole('status').textContent).toBe('No matches');
    expect(screen.getByRole('button', { name: 'Add project on Empty' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('searches the displayed abbreviated path when existing-thread descriptions describe a new draft', () => {
    const { open } = setup({ options: options.map(option => ({ ...option, description: 'New thread elsewhere' })) }); open();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '~/api' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Devbox › api New thread elsewhere' })).toBeTruthy();
  });
  it('supports keyboard opening, wrapping, list Home/End and Enter while skipping disabled rows', () => {
    const onChange = vi.fn();
    const { trigger } = setup({ onChange, options: [{ value: 'old', label: 'Old location', description: 'Current thread location', disabled: true, machineId: 'local' }, ...options] });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const input = screen.getByRole('combobox');
    const activeName = () => document.getElementById(input.getAttribute('aria-activedescendant')!)?.getAttribute('aria-label');
    expect(activeName()).toContain('This Mac › app');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); expect(activeName()).toContain('Default Project');
    fireEvent.keyDown(input, { key: 'ArrowUp' }); expect(activeName()).toContain('This Mac › app');
    fireEvent.keyDown(input, { key: 'Home' }); expect(activeName()).toContain('This Mac › app');
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'Home' }); expect(activeName()).toContain('Default Project');
    fireEvent.keyDown(list, { key: 'End' }); expect(activeName()).toContain('This Mac › app');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onChange).toHaveBeenCalledWith('app');
  });
  it('keeps native Enter on machine buttons and closes with Escape without bubbling to the launcher', () => {
    const parentEscape = vi.fn(), { open, trigger } = setup(); open();
    document.addEventListener('keydown', parentEscape);
    const button = screen.getByRole('button', { name: 'Devbox Offline 1' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    parentEscape.mockClear();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(parentEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    document.removeEventListener('keydown', parentEscape);
  });
  it('closes outside a modal even if the modal stops bubbling mousedown', () => {
    const { open } = setup(); open();
    fireEvent.mouseDown(screen.getByRole('combobox'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const outside = document.createElement('button');
    outside.addEventListener('mousedown', event => event.stopPropagation());
    document.body.append(outside); outside.focus(); fireEvent.mouseDown(outside);
    expect(document.activeElement).toBe(outside); outside.remove();
    expect(screen.queryByRole('dialog')).toBeNull();
    open(); fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('can close with the trigger or close button and excludes add in existing threads', () => {
    const { open } = setup({ onAddProject: undefined }); open();
    expect(screen.queryByRole('button', { name: /Add project/ })).toBeNull();
    open(); expect(screen.queryByRole('dialog')).toBeNull();
    open(); fireEvent.click(screen.getByRole('button', { name: 'Close project picker' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows recorded unavailable rows without making them selectable', () => {
    const recorded = { value: 'old', label: 'Recorded location', description: 'Current thread location', disabled: true, machineId: 'local' };
    const { open, onChange } = setup({ value: 'old', options: [recorded] }); open();
    const row = screen.getByRole('option'); expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row); fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox').hasAttribute('aria-activedescendant')).toBe(false);
  });
  it('handles missing machines and an unknown selection with its placeholder', () => {
    const { open } = setup({ machines: [], options: [], value: 'missing', selectedMachineId: undefined, placeholder: 'Choose a location' });
    expect(screen.getByRole('button', { name: 'Location' }).textContent).toContain('Choose a location'); open();
    expect(screen.getByRole('status').textContent).toBe('No projects on this machine');
    expect(screen.queryByRole('button', { name: /Add project/ })).toBeNull();
  });
  it('reflects setup and unavailable machine status and does not shorten unrelated paths', () => {
    const extra = [{ id: 'ssh', name: 'SSH box', remote: { host: 'ssh' }, primary: false, projects: [] }, { id: 'gone', name: 'Gone', hostId: 'gone', primary: false, projects: [] }] as MachineProjectGroup[];
    const { open } = setup({ machines: [...machines, ...extra], options: [...options, { value: 'outside', machineId: 'ssh', label: 'SSH box › outside', project: { name: 'outside', path: '/Users/test-other/outside' } as Project }] }); open();
    expect(screen.getByRole('button', { name: 'Gone Unavailable 0' })).toBeTruthy();
    browse('SSH box Setup needed 1');
    expect(screen.getByText('/Users/test-other/outside')).toBeTruthy();
  });
  it('repositions on resize or outside scrolling, flips above and keeps both columns inside narrow viewports', () => {
    const { open, trigger } = setup();
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 500, right: 700, top: 700, bottom: 730, width: 200 } as DOMRect);
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    open(); const menu = screen.getByRole('dialog');
    expect(menu.style.bottom).toBe('104px');
    expect(menu.style.left).toBe('150px');
    Object.defineProperty(window, 'innerWidth', { value: 440, configurable: true });
    fireEvent.resize(window);
    expect(menu.style.width).toBe('424px'); expect(menu.style.left).toBe('8px');
    fireEvent.scroll(document); fireEvent.scroll(screen.getByRole('listbox'));
    expect(menu.style.bottom).toBe('104px');
  });
  it('disables the trigger and dismisses an open picker when it becomes locked', () => {
    const { open, rerender } = setup(); open();
    rerender(<DesktopProjectPicker ariaLabel="Location" value="app" machines={machines} options={options} onChange={vi.fn()} disabled />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('button', { name: 'Location' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
