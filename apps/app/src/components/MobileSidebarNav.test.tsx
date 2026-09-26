// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MobileSidebarNav } from './MobileSidebarNav.js';
import type { SidebarRailItem } from './SidebarRail.js';

afterEach(cleanup);
const primary: SidebarRailItem = { kind: 'row', id: 'inbox', label: 'Inbox', icon: null, to: '/inbox', testId: 'inbox', active: false };
const tool: SidebarRailItem = { ...primary, id: 'docs', label: 'Docs', mobileGroup: 'tools' };
const projects: SidebarRailItem = { kind: 'section', id: 'projects', node: <div /> };
const renderItem = (id: string) => <button key={id}>{id}</button>;

it('keeps the primary destinations and projects reachable while disclosing all tools together', () => {
  const home: SidebarRailItem = { ...primary, id: 'home', mobileGroup: 'featured' };
  const agents: SidebarRailItem = { ...primary, id: 'agents', mobileGroup: 'featured' };
  render(<MobileSidebarNav items={[home, primary, agents, tool, projects]} navAriaLabel="Main navigation" renderItem={renderItem} />);
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'inbox' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'projects' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'docs' })).toBeNull();
  expect(screen.getAllByRole('button').slice(0, 3).map((button) => button.textContent)).toEqual(['home', 'agents', 'inbox']);
  for (const name of ['home', 'agents']) {
    const action = screen.getByRole('button', { name });
    expect(action.closest('.mobile-nav-featured')).toBeTruthy();
    expect(action.closest('.mobile-sidebar-scroll')).toBeNull();
  }
  for (const name of ['inbox', 'projects', 'More']) {
    expect(screen.getByRole('button', { name }).closest('.mobile-sidebar-scroll')).toBeTruthy();
  }
  const toggle = screen.getByRole('button', { name: 'More' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'docs' })).toBeTruthy();
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.hidden).toBe(false);
  fireEvent.click(toggle);
  expect(screen.queryByRole('button', { name: 'docs' })).toBeNull();
});

it('opens compact even when the current page belongs to More', () => {
  render(<MobileSidebarNav items={[primary, { ...tool, active: true }]} navAriaLabel="Nav" renderItem={renderItem} />);
  expect(screen.queryByRole('button', { name: 'docs' })).toBeNull();
  expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
});

it('omits the tools disclosure when no tools are installed or contributed', () => {
  render(<MobileSidebarNav items={[primary, projects]} navAriaLabel="Nav" renderItem={renderItem} />);
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  expect(screen.getByRole('button', { name: 'projects' })).toBeTruthy();
  expect(document.querySelector('.mobile-nav-featured')).toBeNull();
});
