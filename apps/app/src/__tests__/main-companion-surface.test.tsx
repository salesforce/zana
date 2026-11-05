// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({ render: vi.fn(), parts: [] as unknown[] }));

vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => ({ render: fixtures.render })) }));
vi.mock('../components/companion/Companion.js', () => ({
  Companion: (props: { part: string | null }) => { fixtures.parts.push(props.part); return null; }
}));
vi.mock('../components/MenubarPopover.js', () => ({ MenubarPopover: () => null }));

beforeEach(() => {
  vi.resetModules();
  fixtures.render.mockClear();
  fixtures.parts.length = 0;
  document.body.innerHTML = '<div id="root"></div>';
  document.documentElement.className = '';
});
afterEach(() => { window.history.replaceState({}, '', '/'); });

it('mounts the Companion for ?surface=companion with its part', async () => {
  window.history.replaceState({}, '', '/?surface=companion&part=rail');
  await import('../main.js');
  await vi.waitFor(() => expect(fixtures.render).toHaveBeenCalledOnce());
  expect(document.documentElement.classList.contains('companion-surface')).toBe(true);
  const element = fixtures.render.mock.calls[0][0];
  const companion = element.props.children;
  expect(companion.props.part).toBe('rail');
});

it('mounts the popover for ?surface=popover and not the Companion', async () => {
  window.history.replaceState({}, '', '/?surface=popover');
  await import('../main.js');
  await vi.waitFor(() => expect(fixtures.render).toHaveBeenCalledOnce());
  expect(document.documentElement.classList.contains('companion-surface')).toBe(false);
  expect(document.body.classList.contains('menubar-popover-body')).toBe(true);
});

it('logs and mounts nothing when #root is missing', async () => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/?surface=companion');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../main.js');
  expect(err).toHaveBeenCalledWith('[renderer] root element not found');
  expect(fixtures.render).not.toHaveBeenCalled();
  err.mockRestore();
});
