/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FlowVisualization } from './FlowVisualization.js';
import { flowModel } from './action-flow.js';
import { ACTION_FLOW } from '../action-fixtures.js';

const props = { pluginId: 'salesforce', model: flowModel(ACTION_FLOW), visualization: { fileName: 'CheckReturn.flow-meta.xml', data: { nodes: ['example'] } }, onOpenTarget: vi.fn() };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); props.onOpenTarget.mockClear(); });
const request = (frame: HTMLIFrameElement, patch = {}) => fireEvent(window, new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { type: 'REQUEST_PLUGIN_DATA' }, ...patch }));

describe('official Flow frame', () => {
  it('only sends the snapshot to its sandboxed frame and ignores edit/navigation requests', () => {
    render(<FlowVisualization {...props} />);
    const frame = screen.getByTitle('Salesforce Flow visualizer') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    request(frame, { source: window }); request(frame, { origin: location.origin });
    request(frame, { data: { type: 'SUBMIT_EDIT', payload: {} } });
    request(frame, { data: { type: 'FLOW_PREVIEW_CLOSE' } });
    expect(post).not.toHaveBeenCalled();
    request(frame);
    expect(post).toHaveBeenCalledWith({ type: 'PLUGIN_DATA_RESPONSE', payload: { data: props.visualization.data, context: { fileName: 'CheckReturn.flow-meta.xml', filePath: '/flow-preview/CheckReturn.flow-meta.xml' } } }, '*');
    expect(screen.queryByText('Drawing Flow…')).toBeNull();
    fireEvent.click(screen.getByText(/Related implementations/));
    fireEvent.click(screen.getByRole('button', { name: 'Open flow://CreateReturn ↗' }));
    expect(props.onOpenTarget).toHaveBeenCalledWith('flow://CreateReturn');
  });
  it('recreates the frame when the host theme changes and cleans up its listener', async () => {
    document.documentElement.dataset.theme = 'dark';
    const view = render(<FlowVisualization {...props} />);
    const frame = screen.getByTitle('Salesforce Flow visualizer');
    await act(async () => { document.documentElement.dataset.theme = 'light'; });
    await waitFor(() => expect(screen.getByTitle('Salesforce Flow visualizer')).not.toBe(frame));
    const current = screen.getByTitle('Salesforce Flow visualizer') as HTMLIFrameElement;
    const post = vi.spyOn(current.contentWindow!, 'postMessage').mockImplementation(() => {});
    view.unmount(); request(current); expect(post).not.toHaveBeenCalled();
  });
  it.each(['PLUGIN_ERROR', 'timeout', 'load error'])('recovers to the existing basic map on %s', kind => {
    vi.useFakeTimers(); render(<FlowVisualization {...props} />);
    const frame = screen.getByTitle('Salesforce Flow visualizer') as HTMLIFrameElement;
    if (kind === 'timeout') act(() => vi.advanceTimersByTime(10_001));
    else if (kind === 'load error') fireEvent.error(frame);
    else request(frame, { data: { type: kind, payload: { stack: 'PRIVATE' } } });
    expect(screen.getByLabelText('Flow implementation map')).toBeTruthy();
    expect(screen.queryByTitle('Salesforce Flow visualizer')).toBeNull();
    expect(screen.getByRole('status').textContent).not.toContain('PRIVATE');
  });
  it('keeps the basic map when the parser is unavailable, and reports its reason', () => {
    render(<FlowVisualization {...props} visualization={undefined} error="Too large for the viewer." />);
    expect(screen.getByRole('status').textContent).toContain('Too large');
    expect(screen.getByLabelText('Flow implementation map')).toBeTruthy();
  });
  it('opens a native expanded viewer and restores focus on Escape', () => {
    render(<FlowVisualization {...props} />);
    const button = screen.getByRole('button', { name: 'Expand Flow' });
    button.focus(); fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Expanded Flow' });
    expect(dialog.contains(screen.getByTitle('Salesforce Flow visualizer'))).toBe(true);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: 'Close Flow' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('closes an expanded view for Escape from its own iframe only', () => {
    render(<FlowVisualization {...props} />);
    const button = screen.getByRole('button', { name: 'Expand Flow' });
    button.focus(); fireEvent.click(button);
    const frame = screen.getByTitle('Salesforce Flow visualizer') as HTMLIFrameElement;
    const data = { type: 'FLOW_PREVIEW_CLOSE' };
    request(frame, { data, source: window });
    request(frame, { data, origin: location.origin });
    expect(screen.getByRole('dialog')).toBeTruthy();
    request(frame, { data });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
