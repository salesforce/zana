import { useMemo } from 'react';
import type { PluginSdkApp } from '@zana-ai/zcc-plugin-sdk/app';
import { isProjectIcon } from '@zana-ai/zcc-domain';
import { isProjectColor } from '@zana-ai/zcc-domain/project-colors';
import { useData } from '../store.js';

/**
 * `experimental_useProjects()`: a bounded display projection of the project
 * list. Paths, hosts and remote details never reach plugins; `icon` and
 * `color` are forwarded only when they are valid palette/glyph values.
 * Independent of the thread store. `configLoaded` flips in the same `set` as
 * the first `projects` hydrate (`init()` in store.ts).
 */
export const useProjects: PluginSdkApp['experimental_useProjects'] = () => {
  const projects = useData(s => s.projects);
  const loaded = useData(s => s.configLoaded);
  return useMemo(() => ({
    status: loaded ? 'ready' as const : 'loading' as const,
    projects: projects.map(project => ({
      id: project.id,
      name: project.name,
      ...(isProjectIcon(project.icon) ? { icon: project.icon } : {}),
      ...(isProjectColor(project.color) ? { color: project.color } : {}),
      ...(project.quickAgent === true ? { quickAgent: true } : {})
    }))
  }), [projects, loaded]);
};
