const roots = '.bb-tasks, [data-bb-plugin="tasks"]';
const withinTasks = ':where(.bb-tasks, [data-bb-plugin="tasks"], .bb-tasks *, [data-bb-plugin="tasks"] *)';

export function scopeTaskStyles(css) {
  css.walkRules(rule => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'rule' || (parent.type === 'atrule' && /keyframes$/.test(parent.name))) return;
    }
    if (rule.selector === ':root, :host') { rule.selector = roots; return; }
    if (rule.selector.startsWith('.bb-tasks') || rule.selector.startsWith('[data-bb-plugin') || rule.selector.startsWith(':where(.bb-tasks')) return;
    // Radix puts the scope marker and utility classes on the SAME portal node.
    // Class utilities must match that node as well as descendants of the panel.
    rule.selectors = rule.selectors.map(selector => selector.startsWith('.')
      ? `${withinTasks}${selector}`
      : `:where(${roots}) ${selector}`);
  });
}
