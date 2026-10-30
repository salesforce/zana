import { relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { balancedShards, testDurations } from './ci-shards.mjs';

export default class DurationSequencer extends BaseSequencer {
  async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const key = (spec: TestSpecification) => relative(this.ctx.config.root, spec.moduleId).replaceAll('\\', '/');
    // Balance each execution group independently: parallel files cannot offset a
    // long serial tail. Keep Vitest's normal sorting and groupOrder unchanged.
    const groups = new Map<string, TestSpecification[]>();
    for (const spec of files) {
      const group = groups.get(spec.project.name) ?? [];
      group.push(spec);
      groups.set(spec.project.name, group);
    }
    return [...groups.values()].flatMap(group => balancedShards(group, count, key,
      (spec: TestSpecification) => (testDurations.unit[key(spec)] ?? 500) + 500)[index - 1]);
  }
}
