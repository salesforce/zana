// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
const scene = vi.hoisted(() => ({ available: true, reduced: false, select: (_key: string) => {} }));
vi.mock('../../lib/agent-city/use-city', () => ({
  useCityCanvas: (_root: unknown, _canvas: unknown, _buildings: unknown, _selected: unknown, _paused: unknown, select: (key: string) => void) => {
    scene.select = select;
    return { available: scene.available, reduced: scene.reduced };
  }
}));
import { AgentCityDemo } from './AgentCityDemo';
import { CITY_PROJECTS } from './agent-city-demo-data';

beforeEach(() => {
  scene.available = true; scene.reduced = false;
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('public Agent City demo', () => {
  it('clearly labels fixed sample data and makes all projects keyboard-accessible', () => {
    render(createElement(AgentCityDemo));
    expect(screen.getByText(/Interactive demo · Sample data/)).toBeTruthy();
    expect(screen.getByLabelText(/Miniature San Francisco/)).toBeTruthy();
    const projects = screen.getByRole('group', { name: 'Explore sample projects' });
    expect(within(projects).getAllByRole('button')).toHaveLength(3);
    expect(CITY_PROJECTS.map((project) => project.count)).toEqual([7, 3, 1]);
    expect(CITY_PROJECTS[0].needs).toBe(1);
  });

  it('explores the real tower interior, floors, full roster, and waiting-agent explanation', () => {
    render(createElement(AgentCityDemo));
    fireEvent.click(screen.getByRole('button', { name: 'Checkout 7' }));
    expect(screen.getByRole('button', { name: 'Checkout 7' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Explore floor')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Checkout sample agents' })).getAllByRole('button')).toHaveLength(7);
    fireEvent.change(screen.getByLabelText('Explore floor'), { target: { value: '0' } });
    expect((screen.getByLabelText('Explore floor') as HTMLSelectElement).value).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: /Fix checkout tests/ }));
    expect(screen.getByRole('status').textContent).toContain('waiting for your reply');
    fireEvent.click(screen.getByRole('button', { name: /Review the payment flow/ }));
    expect(screen.getByRole('status').textContent).toContain('Working');
    fireEvent.click(screen.getByRole('button', { name: /Prepare the release/ }));
    expect(screen.getByRole('status').textContent).toContain('Idle');
    expect((screen.getByLabelText('Explore floor') as HTMLSelectElement).value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: '← Back to city' }));
    expect(screen.queryByLabelText('Explore floor')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Checkout7');
  });

  it('supports canvas project/worker/floor picks and Escape without inventing unknown agents', () => {
    render(createElement(AgentCityDemo));
    // Canvas callbacks run through the same selection path as the DOM controls.
    fireEvent.click(screen.getByRole('button', { name: 'Checkout 7' }));
    act(() => { scene.select('city-floor:0'); });
    expect((screen.getByLabelText('Explore floor') as HTMLSelectElement).value).toBe('0');
    act(() => { scene.select('checkout-0'); });
    expect(screen.getByRole('status').textContent).toContain('waiting for your reply');
    act(() => { scene.select('city-floor:999'); scene.select('unknown'); });
    fireEvent.keyDown(screen.getByRole('button', { name: '← Back to city' }), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '← Back to city' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Docs 1' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Docs 1' }));
    expect(screen.getByText(/1 sample agent/)).toBeTruthy();
  });

  it('pauses and resumes motion and respects reduced-motion preferences', () => {
    const { rerender } = render(createElement(AgentCityDemo));
    fireEvent.click(screen.getByRole('button', { name: 'Pause city motion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume city motion' }));
    scene.reduced = true;
    rerender(createElement(AgentCityDemo));
    expect((screen.getByRole('button', { name: 'Motion reduced' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps sample rosters usable when canvas is unavailable', () => {
    scene.available = false;
    render(createElement(AgentCityDemo));
    expect(screen.getByText(/isn’t available in this browser/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Pause city motion' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Website 3' }));
    expect(screen.getByRole('list', { name: 'Website sample agents' })).toBeTruthy();
    expect(screen.queryByLabelText('Explore floor')).toBeNull();
  });
});
