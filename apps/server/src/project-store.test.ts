import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectStore, dedupeTag, pickProjectColor, PROJECT_COLORS, slugifyTag } from './project-store.js';

const roots: string[] = [];

function makeDir(): string {
  const value = mkdtempSync(join(tmpdir(), 'zcc-server-project-store-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('createProjectStore', () => {
  it('rejects a path that does not exist or is not a directory', async () => {
    const home = makeDir();
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });
    await expect(store.add(join(home, 'missing'))).rejects.toThrow();

    const file = join(home, 'not-a-dir');
    writeFileSync(file, 'x');
    await expect(store.add(file)).rejects.toThrow('not a directory');
  });

  it('requires and persists an absolute canonical project path', async () => {
    const home = makeDir();
    const projectDir = join(home, 'project');
    const link = join(home, 'project-link');
    mkdirSync(projectDir);
    symlinkSync(projectDir, link);
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });

    await expect(store.add('project')).rejects.toThrow('project path must be absolute');
    const first = await store.add(link);
    const second = await store.add(projectDir);

    expect(first.path).toBe(realpathSync(projectDir));
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
  });

  it('heals a legacy noncanonical local path when it is added again', async () => {
    const home = makeDir();
    const projectDir = join(home, 'project');
    mkdirSync(projectDir);
    const projectsFile = join(home, '.zcc', 'projects.json');
    mkdirSync(join(home, '.zcc'));
    writeFileSync(projectsFile, JSON.stringify({
      version: 1,
      projects: [{ id: 'legacy', name: 'project', path: projectDir, createdAt: 1, lastActiveAt: 1 }]
    }));
    const store = createProjectStore({ projectsFile });

    const project = await store.add(realpathSync(projectDir));

    expect(project.id).toBe('legacy');
    expect(project.path).toBe(realpathSync(projectDir));
    expect(store.list()).toHaveLength(1);
  });

  it('adds a project with an assigned tag, color, and timestamps', async () => {
    const home = makeDir();
    const projectDir = join(home, 'my project');
    mkdirSync(projectDir);
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });

    const project = await store.add(projectDir);
    expect(project.path).toBe(realpathSync(projectDir));
    expect(project.name).toBe('my project');
    expect(project.tag).toBe('my-project');
    expect(project.color).toBe(PROJECT_COLORS[0]);
    expect(project.createdAt).toBeGreaterThan(0);
    expect(project.lastActiveAt).toBe(project.createdAt);
    expect(store.list()).toEqual([project]);

    const onDisk = JSON.parse(readFileSync(join(home, '.zcc', 'projects.json'), 'utf8'));
    expect(onDisk).toEqual({ version: 1, projects: [project] });
  });

  it('dedups an existing path by bumping lastActiveAt instead of creating a duplicate', async () => {
    const home = makeDir();
    const projectDir = join(home, 'proj');
    mkdirSync(projectDir);
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });

    const first = await store.add(projectDir);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await store.add(projectDir);

    expect(second.id).toBe(first.id);
    expect(second.lastActiveAt).toBeGreaterThanOrEqual(first.lastActiveAt);
    expect(store.list()).toHaveLength(1);
  });

  it('dedups tag collisions across distinct projects with the same basename', async () => {
    const home = makeDir();
    const dirA = join(home, 'sub1', 'demo');
    const dirB = join(home, 'sub2', 'demo');
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });

    const a = await store.add(dirA);
    const b = await store.add(dirB);
    expect(a.tag).toBe('demo');
    expect(b.tag).toBe('demo-2');
    expect(dedupeTag(slugifyTag('demo'), new Set(['demo']))).toBe('demo-2');
  });

  it('assigns the least-used palette color first, in palette order on ties', async () => {
    const home = makeDir();
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });
    const dirs = ['a', 'b', 'c'].map((name) => {
      const dir = join(home, name);
      mkdirSync(dir);
      return dir;
    });

    const colors: string[] = [];
    for (const dir of dirs) colors.push((await store.add(dir)).color!);
    expect(colors).toEqual([PROJECT_COLORS[0], PROJECT_COLORS[1], PROJECT_COLORS[2]]);
    expect(pickProjectColor(colors)).toBe(PROJECT_COLORS[3]);
  });

  it('classifies an extension source directory into the Extensions category', async () => {
    const home = makeDir();
    const extDir = join(home, 'my-ext');
    mkdirSync(extDir);
    writeFileSync(
      join(extDir, 'extension.json'),
      JSON.stringify({ id: 'my-ext', title: 'My Extension', entry: { renderer: 'renderer.js' } })
    );
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });

    const project = await store.add(extDir);
    expect(project.category).toBe('Extensions');
    expect(project.name).toBe('Ext: My Extension');
  });

  it('heals a previously-plain project into Extensions once a matching manifest appears', async () => {
    const home = makeDir();
    const dir = join(home, 'my-ext');
    mkdirSync(dir);
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });

    const before = await store.add(dir);
    expect(before.category).toBeUndefined();

    writeFileSync(
      join(dir, 'extension.json'),
      JSON.stringify({ id: 'my-ext', title: 'My Extension', entry: { main: 'main.mjs' } })
    );
    const after = await store.add(dir);
    expect(after.id).toBe(before.id);
    expect(after.category).toBe('Extensions');
    expect(after.name).toBe('Ext: My Extension');
  });

  it('updates name/category and silently drops an out-of-palette color', async () => {
    const home = makeDir();
    const dir = join(home, 'proj');
    mkdirSync(dir);
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });
    const project = await store.add(dir);

    const updated = await store.update(project.id, { name: 'Renamed', color: '#ffffff' });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.color).toBe(project.color); // invalid hex dropped, prior value kept

    const validColor = await store.update(project.id, { color: PROJECT_COLORS[4] });
    expect(validColor?.color).toBe(PROJECT_COLORS[4]);
  });

  it('rejects malformed project update values', async () => {
    const home = makeDir();
    const dir = join(home, 'proj');
    mkdirSync(dir);
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });
    const project = await store.add(dir);

    await expect(store.update(project.id, { name: '' })).rejects.toThrow('project name');
    await expect(store.update(project.id, { name: 'bad\nname' })).rejects.toThrow('control characters');
    await expect(store.update(project.id, { category: 'Other' })).rejects.toThrow('unsupported project category');
  });

  it('returns null updating an unknown id without touching the file', async () => {
    const home = makeDir();
    const projectsFile = join(home, '.zcc', 'projects.json');
    const store = createProjectStore({ projectsFile });
    const dir = join(home, 'proj');
    mkdirSync(dir);
    await store.add(dir);
    const before = readFileSync(projectsFile, 'utf8');

    expect(await store.update('missing-id', { name: 'x' })).toBeNull();
    expect(readFileSync(projectsFile, 'utf8')).toBe(before);
  });

  it('reorders known ids, appends omitted projects, and assigns sort indexes', async () => {
    const home = makeDir();
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });
    const dirs = ['a', 'b', 'c'].map((name) => {
      const dir = join(home, name);
      mkdirSync(dir);
      return dir;
    });
    const [a, b, c] = await Promise.all(dirs.map((dir) => store.add(dir)));

    const ordered = await store.reorder([c.id, a.id, 'missing']);

    expect(ordered.map((project) => project.id)).toEqual([c.id, a.id, b.id]);
    expect(ordered.map((project) => project.sortIndex)).toEqual([0, 1, 2]);
  });

  it('touches a project and backfills missing tag/color metadata', async () => {
    const home = makeDir();
    const projectsFile = join(home, '.zcc', 'projects.json');
    mkdirSync(join(home, '.zcc'));
    writeFileSync(projectsFile, JSON.stringify({
      version: 1,
      projects: [{ id: 'legacy', name: 'Legacy Project', path: join(home, 'missing'), createdAt: 1, lastActiveAt: 1 }]
    }));
    const store = createProjectStore({ projectsFile });

    const touched = await store.touch('legacy');

    expect(touched).toMatchObject({ id: 'legacy', tag: 'legacy-project', color: PROJECT_COLORS[0] });
    expect(touched!.lastActiveAt).toBeGreaterThan(1);
  });

  it('removes a project and only its matching app-owned remote placeholder', async () => {
    const home = makeDir();
    const dataDir = join(home, '.zcc');
    const placeholderRoot = join(dataDir, 'remote-projects');
    const placeholder = join(placeholderRoot, 'remote-1');
    mkdirSync(placeholder, { recursive: true });
    const projectsFile = join(dataDir, 'projects.json');
    writeFileSync(projectsFile, JSON.stringify({
      version: 1,
      projects: [
        { id: 'remote-1', name: 'Remote', path: placeholder, createdAt: 1, lastActiveAt: 1, remote: { host: 'example' } },
        { id: 'local-1', name: 'Local', path: join(home, 'local'), createdAt: 1, lastActiveAt: 1 }
      ]
    }));
    const store = createProjectStore({ projectsFile, remotePlaceholderRoot: placeholderRoot });

    expect(await store.remove('remote-1')).toMatchObject({ id: 'remote-1' });
    expect(existsSync(placeholder)).toBe(false);
    expect(store.list().map((project) => project.id)).toEqual(['local-1']);
    expect(await store.remove('missing')).toBeNull();
  });

  it('serializes concurrent add() calls so neither write is lost', async () => {
    const home = makeDir();
    const store = createProjectStore({ projectsFile: join(home, '.zcc', 'projects.json') });
    const dirA = join(home, 'a');
    const dirB = join(home, 'b');
    mkdirSync(dirA);
    mkdirSync(dirB);

    const [a, b] = await Promise.all([store.add(dirA), store.add(dirB)]);
    expect(store.list()).toHaveLength(2);
    expect(new Set(store.list().map((p) => p.id))).toEqual(new Set([a.id, b.id]));
  });

  it('reads a legacy bare-array projects.json for backward compatibility', async () => {
    const home = makeDir();
    const projectsFile = join(home, '.zcc', 'projects.json');
    mkdirSync(join(home, '.zcc'));
    writeFileSync(projectsFile, JSON.stringify([
      { id: 'legacy-1', name: 'Legacy', path: '/tmp/legacy', createdAt: 1, lastActiveAt: 1 }
    ]));
    const store = createProjectStore({ projectsFile });
    expect(store.list()).toEqual([
      { id: 'legacy-1', name: 'Legacy', path: '/tmp/legacy', createdAt: 1, lastActiveAt: 1 }
    ]);
  });

  it('binds an SSH remote project to an enrolled host and drops project.remote', async () => {
    const home = makeDir();
    const placeholderRoot = join(home, 'remote-projects');
    const placeholder = join(placeholderRoot, 'remote-1');
    mkdirSync(placeholder, { recursive: true });
    const projectsFile = join(home, '.zcc', 'projects.json');
    mkdirSync(join(home, '.zcc'));
    writeFileSync(projectsFile, JSON.stringify({
      version: 1,
      projects: [{
        id: 'remote-1',
        name: 'Remote',
        path: placeholder,
        createdAt: 1,
        lastActiveAt: 1,
        remote: { host: 'devbox', user: 'me', remotePath: '/home/me/app' }
      }]
    }));
    const store = createProjectStore({ projectsFile, remotePlaceholderRoot: placeholderRoot });
    const bound = await store.bindToHost('remote-1', {
      hostId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      path: '/home/me/app'
    });
    expect(bound).toMatchObject({
      id: 'remote-1',
      hostId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      path: '/home/me/app'
    });
    expect(bound).not.toHaveProperty('remote');
    expect(store.list()[0]).not.toHaveProperty('remote');
  });
});
