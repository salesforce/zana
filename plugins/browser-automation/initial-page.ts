/** Bind the documented main page to the session's existing scoped tab. */
export function reuseInitialPage(script: string, pageId: string): string {
  return `{
    const original = globalThis.browser;
    const initialPageId = ${JSON.stringify(pageId)};
    const initialPage = async () => (await original.listPages()).some(page => page.id === initialPageId);
    globalThis.browser = Object.freeze({
      ...original,
      async getPage(name, ...args) {
        return original.getPage(name === "main" && await initialPage() ? initialPageId : name, ...args);
      },
      async closePage(name) {
        if (name === "main" && await initialPage()) return (await original.getPage(initialPageId)).close();
        return original.closePage(name);
      },
      async listPages() {
        return (await original.listPages()).map(page => page.id === initialPageId ? { ...page, name: "main" } : page);
      }
    });
  }
  ${script}`;
}
