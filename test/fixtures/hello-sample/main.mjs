/**
 * Hello Sample — minimal extension main process.
 * Proves the live-load lifecycle without rebuilding the app.
 */
export default {
  id: 'hello-sample',
  setup(ctx) {
    ctx.log('hello-sample: main process activated');

    return {
      /** Simple ping capability to verify it's running */
      ping: async () => {
        ctx.log('hello-sample: ping received');
        return { ok: true, message: 'pong from hello-sample' };
      },

      /** Return the extension's loaded state */
      getStatus: async () => {
        return {
          ok: true,
          id: 'hello-sample',
          version: '1.0.0',
          loaded: true
        };
      }
    };
  }
};
