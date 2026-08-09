/**
 * Inbox Push Sample — exercises `ctx.inbox.push` (Phase B of the notifications
 * rework) from a sandboxed disk-extension main process, over the brokered
 * `inbox.push` capability. Exposes a `push` capability so the E2E spec can
 * trigger the call on demand via `window.cc.modules.call`.
 */
export default {
  id: 'inbox-push-sample',
  setup(ctx) {
    ctx.log('inbox-push-sample: main process activated');

    return {
      push: async (input) => {
        const res = await ctx.inbox.push(input);
        ctx.log(`inbox-push-sample: pushed ${res.id}`);
        return res;
      }
    };
  }
};
