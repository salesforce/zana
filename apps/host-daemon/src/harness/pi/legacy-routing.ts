import type { HarnessLegacyRoutingAdapter } from '../legacy-routing-adapter.js';

/**
 * PI's provider/model/thinking defaults (global, then project) are argv a PI
 * launch folds in; a PI thread has no equivalent knob, so plugin thread routing
 * must refuse rather than drop them. Launch resolution never calls this.
 */
export const piLegacyRouting: HarnessLegacyRoutingAdapter = {
  threadUnmappedFields(context) {
    const fields: string[] = [];
    const add = (layer: 'global' | 'project', label: string, value: string | undefined) => {
      if (value && value !== 'default') fields.push(`the ${layer} PI ${label} (${value})`);
    };
    add('global', 'provider', context.config.piProvider);
    add('global', 'model', context.config.piModel);
    add('global', 'thinking level', context.config.piThinking);
    add('project', 'provider', context.projectSettings?.piProvider);
    add('project', 'model', context.projectSettings?.piModel);
    add('project', 'thinking level', context.projectSettings?.piThinking);
    return fields;
  }
};
