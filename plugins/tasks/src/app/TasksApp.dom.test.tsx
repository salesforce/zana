/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPluginApp, renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';
import {
  applyBoardMove,
  createTask,
  emptyStore,
  findTask,
  patchTask,
  toPublic,
  toggleDone,
  type PublicTask,
  type TaskStore
} from '../model.js';

vi.mock('./styles.css', () => ({ default: '.tsk-panel{color:red}' }));
vi.mock('@zana-ai/zcc-ui/kanban.css', () => ({ default: '.zcc-kanban{}' }));

function memoryRpc() {
  let store: TaskStore = emptyStore();
  const items = () => store.items.map(toPublic);
  return {
    list: () => ({ items: items() }),
    get: (input: unknown) => {
      const key = String((input as { key?: string; id?: string })?.key ?? (input as { id?: string })?.id ?? '');
      const task = findTask(store, key);
      if (!task) throw new Error(`task not found: ${key}`);
      return { task: toPublic(task) };
    },
    add: (input: unknown) => {
      const row = input as { title: string; status?: PublicTask['status']; priority?: PublicTask['priority']; description?: string; dueDate?: string };
      const created = createTask(
        {
          title: row.title,
          status: row.status,
          priority: row.priority,
          description: row.description,
          dueDate: row.dueDate ?? null
        },
        { nextSeq: store.nextSeq, now: Date.now() }
      );
      store = { ...store, nextSeq: created.nextSeq, items: [...store.items, created.task] };
      return toPublic(created.task);
    },
    update: (input: unknown) => {
      const row = input as { id: string } & Partial<PublicTask>;
      const current = findTask(store, row.id);
      if (!current) throw new Error('task not found');
      const next = patchTask(current, row);
      store = { ...store, items: store.items.map((item) => (item.id === next.id ? next : item)) };
      return toPublic(next);
    },
    toggle: (input: unknown) => {
      const current = findTask(store, String((input as { id: string }).id));
      if (!current) throw new Error('task not found');
      const next = toggleDone(current);
      store = { ...store, items: store.items.map((item) => (item.id === next.id ? next : item)) };
      return toPublic(next);
    },
    remove: (input: unknown) => {
      const current = findTask(store, String((input as { id: string }).id));
      if (!current) throw new Error('task not found');
      store = { ...store, items: store.items.filter((item) => item.id !== current.id) };
      return { ok: true, id: current.id };
    },
    boardMove: (input: unknown) => {
      const row = input as { id: string; status: PublicTask['status']; index: number };
      store = { ...store, items: applyBoardMove(store.items, row.id, row.status, row.index) };
      return { task: findTask(store, row.id) ? toPublic(findTask(store, row.id)!) : null };
    },
    badge: () => ({ count: store.items.filter((task) => task.status !== 'done' && task.status !== 'canceled').length || null })
  };
}

const app = await loadPluginApp(() => import('../../app.tsx'), 'tasks');

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.getElementById('tsk-plugin-styles')?.remove();
});

describe('tasks app', () => {
  it('shows the BB-style empty state and creates a task from the dialog', async () => {
    const rpc = memoryRpc();
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'tasks', subPath: '' }, { rpc });
    expect(await slot.findByText('No tasks yet')).toBeTruthy();
    expect(slot.getByText('Create the first task to start tracking work.')).toBeTruthy();
    fireEvent.click(slot.getAllByRole('button', { name: 'New task' })[0]!);
    fireEvent.change(slot.getByPlaceholderText('Ship the tracker'), { target: { value: 'Ship tracker' } });
    fireEvent.click(slot.getByRole('button', { name: 'Create task' }));
    await waitFor(() => {
      expect(slot.queryByRole('dialog')).toBeNull();
      expect(slot.getByRole('textbox', { name: 'Task title' }).textContent).toBe('Ship tracker');
      expect(slot.getByText('TSK-1')).toBeTruthy();
    });
    expect(slot.inspection.rpcCalls.some((call) => call.method === 'add')).toBe(true);
    slot.unmount();
  });

  it('groups seeded tasks and opens the board', async () => {
    const rpc = memoryRpc();
    rpc.add({ title: 'One', status: 'todo' });
    rpc.add({ title: 'Two', status: 'in_progress' });
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'tasks', subPath: '' }, { rpc });
    expect(await slot.findByText('One')).toBeTruthy();
    expect(slot.getByText('In Progress')).toBeTruthy();
    fireEvent.click(slot.getByRole('button', { name: 'Board' }));
    expect(await slot.findByLabelText('Tasks by status')).toBeTruthy();
    expect(slot.getAllByRole('button', { name: 'Add' }).length).toBeGreaterThan(0);
    expect(slot.inspection.navigateCalls.some((call) => call.method === 'toPluginPanel' && call.options?.subPath === 'board')).toBe(
      true
    );
    slot.unmount();
  });

  it('opens a task detail from the list and edits the title', async () => {
    const rpc = memoryRpc();
    rpc.add({ title: 'Editable', status: 'todo' });
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'tasks', subPath: '' }, { rpc });
    fireEvent.click(await slot.findByRole('button', { name: 'Open TSK-1: Editable' }));
    const title = await slot.findByRole('textbox', { name: 'Task title' });
    expect(title.textContent).toBe('Editable');
    title.textContent = 'Renamed';
    fireEvent.blur(title);
    await waitFor(() => {
      expect(slot.inspection.rpcCalls.some((call) => call.method === 'update')).toBe(true);
    });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.blur(title);
    const description = slot.getByRole('textbox', { name: 'Task description' });
    fireEvent.change(description, { target: { value: 'More detail' } });
    fireEvent.blur(description);
    fireEvent.change(slot.getByLabelText('Due date'), { target: { value: '2026-09-20' } });
    fireEvent.click(slot.getByRole('button', { name: 'Delete task' }));
    await waitFor(() => {
      expect(slot.inspection.rpcCalls.some((call) => call.method === 'remove')).toBe(true);
      expect(slot.getByText('All tasks')).toBeTruthy();
    });
    slot.unmount();
  });

  it('filters the list and changes status from the row menu', async () => {
    const rpc = memoryRpc();
    rpc.add({ title: 'Keep', status: 'todo' });
    rpc.add({ title: 'Hide', status: 'in_progress' });
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'tasks', subPath: '' }, { rpc });
    expect(await slot.findByText('Keep')).toBeTruthy();
    fireEvent.click(slot.getByRole('button', { name: 'Status' }));
    fireEvent.click(slot.getByRole('menuitemcheckbox', { name: 'Todo' }));
    expect(slot.queryByText('Hide')).toBeNull();
    expect(slot.getByText('1 task')).toBeTruthy();
    fireEvent.click(slot.getByRole('button', { name: /Clear/ }));
    expect(await slot.findByText('Hide')).toBeTruthy();
    fireEvent.click(slot.getByRole('button', { name: 'Priority' }));
    fireEvent.click(slot.getByRole('menuitemcheckbox', { name: 'High' }));
    expect(await slot.findByText('No tasks match these filters')).toBeTruthy();
    fireEvent.click(slot.getByRole('button', { name: 'Clear filters' }));
    fireEvent.mouseDown(document.body);
    fireEvent.click(slot.getByRole('button', { name: 'Status: Todo' }));
    fireEvent.click(slot.getByRole('menuitemcheckbox', { name: 'In Progress' }));
    await waitFor(() => {
      expect(slot.inspection.rpcCalls.some((call) => call.method === 'update')).toBe(true);
    });
    fireEvent.click(slot.getByRole('button', { name: 'Sort' }));
    fireEvent.click(slot.getByRole('menuitemcheckbox', { name: 'Priority' }));
    slot.unmount();
  });

  it('shows a load error, pages between tasks, and handles Escape', async () => {
    const rpc = {
      list: () => {
        throw new Error('offline');
      }
    };
    const errorSlot = renderSlot(app.navPanels[0]!, { pluginId: 'tasks', subPath: '' }, { rpc });
    expect(await errorSlot.findByText("Couldn't load tasks")).toBeTruthy();
    errorSlot.unmount();

    const live = memoryRpc();
    live.add({ title: 'First', status: 'todo' });
    live.add({ title: 'Second', status: 'todo' });
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'tasks', subPath: 'task/TSK-1' }, { rpc: live });
    expect(await slot.findByRole('textbox', { name: 'Task title' })).toBeTruthy();
    fireEvent.click(slot.getByRole('button', { name: 'Next task' }));
    expect(slot.inspection.navigateCalls.some((call) => call.options?.subPath === 'task/TSK-2')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(slot.getByText('All tasks')).toBeTruthy();
    slot.unmount();
  });

  it('drops a board card onto another column', async () => {
    const rpc = memoryRpc();
    const created = rpc.add({ title: 'Card', status: 'todo' }) as PublicTask;
    const slot = renderSlot(app.navPanels[0]!, { pluginId: 'tasks', subPath: 'board' }, { rpc });
    const card = await slot.findByText('Card');
    const article = card.closest('[data-task-id]')!;
    const target = slot.container.querySelector('[data-drop-status="in_progress"]')!;
    const data: Record<string, string> = {};
    const dt = {
      setData: (type: string, value: string) => {
        data[type] = value;
      },
      getData: (type: string) => data[type] ?? '',
      effectAllowed: 'move',
      dropEffect: 'move'
    };
    fireEvent.dragStart(article, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt, clientY: 0 });
    await waitFor(() => {
      expect(slot.inspection.rpcCalls.some((call) => call.method === 'boardMove' && (call.input as { id: string }).id === created.id)).toBe(
        true
      );
    });
    fireEvent.click(slot.getAllByRole('button', { name: 'Add' })[0]!);
    expect(slot.getByRole('dialog', { name: 'New task' })).toBeTruthy();
    slot.unmount();
  });

  it('renders a task mention card and a nav badge', async () => {
    const rpc = memoryRpc();
    rpc.add({ title: 'Mention me', status: 'todo' });
    const Directive = app.messageDirectives[0]!.component;
    const slot = renderSlot(
      { component: Directive },
      {
        pluginId: 'tasks',
        attributes: { key: 'TSK-1' },
        source: '::task{key="TSK-1"}',
        message: { id: 'm1', threadId: 't1', turnId: null, projectId: null },
        openWorkspaceFile: null
      },
      { rpc }
    );
    expect(await slot.findByText('Mention me')).toBeTruthy();
    fireEvent.click(slot.getByRole('button', { name: /Mention me/ }));
    expect(slot.inspection.navigateCalls[0]).toMatchObject({
      method: 'toPluginPanel',
      options: { subPath: 'task/TSK-1' }
    });
    slot.unmount();

    vi.stubGlobal('__ZCC_PLUGIN_HOST__', {
      callRpc: async () => ({ count: 4 })
    });
    const Badge = app.navPanels[0]!.experimental_sidebarAccessory!;
    const badge = renderSlot({ component: Badge }, {});
    await waitFor(() => {
      expect(badge.container.querySelector('.nav-badge')?.textContent).toBe('4');
    });
    badge.unmount();
    vi.unstubAllGlobals();
  });

  it('injects plugin CSS', async () => {
    const { injectStyles } = await import('../../app.tsx');
    injectStyles();
    expect(document.getElementById('tsk-plugin-styles')?.textContent).toContain('.tsk-panel');
  });
});
