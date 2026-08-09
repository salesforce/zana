export default {
  setup(ctx) {
    return {
      async gitVersion() {
        try {
          const result = await ctx.exec({ bin: 'git', args: ['--version'] });
          return result.stdout.trim() || 'git is available';
        } catch (error) {
          return `Git unavailable: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    };
  }
};
