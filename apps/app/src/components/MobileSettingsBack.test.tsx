// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { resetAppSettingsRouteMemory } from '../hooks/useAppSettingsRouteMemory.js';
import { MobileSettingsBack } from './MobileSettingsBack.js';

afterEach(() => { cleanup(); resetAppSettingsRouteMemory(); });

function Navigation() {
  const location = useLocation();
  return <>
    <MobileSettingsBack />
    <Link to="/settings/global">Open settings</Link>
    <Link to="/settings/machines">Machines</Link>
    <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>
  </>;
}

it.each(['/agents', '/threads/t1?panel=files#message-2', '/inbox'])('returns to %s after switching settings sections', (from) => {
  render(<MemoryRouter initialEntries={[from]}><Navigation /></MemoryRouter>);
  expect(screen.queryByRole('link', { name: 'Back to app' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Open settings' }));
  expect(screen.getByRole('link', { name: 'Back to app' }).getAttribute('href')).toBe(from);
  fireEvent.click(screen.getByRole('link', { name: 'Machines' }));
  fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));
  expect(screen.getByTestId('location').textContent).toBe(from);
  expect(screen.queryByRole('link', { name: 'Back to app' })).toBeNull();
});

it('provides a safe app destination when Settings is opened directly', () => {
  render(<MemoryRouter initialEntries={['/settings/machines']}><Navigation /></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));
  expect(screen.getByTestId('location').textContent).toBe('/');
});

it('leaves project settings for its project instead of linking back to itself', () => {
  render(<MemoryRouter initialEntries={['/projects/demo/settings']}><Navigation /></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));
  expect(screen.getByTestId('location').textContent).toBe('/projects/demo');
  expect(screen.queryByRole('link', { name: 'Back to app' })).toBeNull();
});

it('shows only the menu return action when the page action is hidden and dismisses on navigation', () => {
  const dismiss = vi.fn();
  render(<MemoryRouter initialEntries={['/settings/global']}>
    <MobileSettingsBack hidden />
    <MobileSettingsBack onNavigate={dismiss} />
  </MemoryRouter>);
  expect(screen.getAllByRole('link', { name: 'Back to app' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));
  expect(dismiss).toHaveBeenCalledOnce();
  expect(screen.queryByRole('link', { name: 'Back to app' })).toBeNull();
});
