import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures/app.js";
import { waitForThreadProvider } from "./fixtures/thread-providers.js";

// Exercise the packaged provider worker, runtime and renderer. Only the native
// Codex process is scripted; every response is recorded at its JSON-RPC stdin.
const computerUse = JSON.parse(
  readFileSync(
    new URL(
      "../plugins/provider-codex/src/fixtures/computer-use-active-turn-elicitation.json",
      import.meta.url,
    ),
    "utf8",
  ),
).params;
const form = {
  serverName: "calendar",
  mode: "form",
  message: "Configure review reminder",
  requestedSchema: {
    type: "object",
    required: ["title", "count"],
    properties: {
      title: { type: "string", title: "Reminder title", minLength: 2 },
      count: { type: "integer", title: "Repeat count", minimum: 1 },
    },
  },
};
const tool = {
  serverName: "calendar",
  mode: "form",
  message: "Allow calendar tool?",
  requestedSchema: { type: "object", properties: {} },
  _meta: {
    codex_approval_kind: "mcp_tool_call",
    tool_name: "create_event",
    tool_params: { title: "Review" },
    persist: ["session"],
  },
};
const urlRequest = {
  serverName: "calendar",
  mode: "url",
  message: "Connect calendar account",
  url: "https://example.com/codex-calendar-approval",
  elicitationId: "calendar-connect",
};
const requests = [
  computerUse,
  form,
  tool,
  {
    ...form,
    message: "Unsupported nested form",
    requestedSchema: {
      type: "object",
      properties: { nested: { type: "object" } },
    },
  },
  urlRequest,
  form,
];

test.use({
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const bin = join(home, "fixture-bin");
    mkdirSync(bin);
    const init = `export PATH='${bin.replaceAll("'", "'\\''")}':"$PATH"\n`;
    for (const name of [".zshrc", ".bashrc", ".bash_profile"])
      writeFileSync(join(home, name), init);
    const fixture = fileURLToPath(
      new URL(
        "../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs",
        import.meta.url,
      ),
    );
    const script = join(home, "elicitation-script.json");
    writeFileSync(
      script,
      JSON.stringify({
        responseLogPath: join(home, "native-responses.jsonl"),
        turns: requests.map((params, index) => {
          const turnId = `elicitation-turn-${index}`;
          return [
            {
              method: "turn/started",
              params: {
                threadId: "fixture",
                turn: {
                  id: turnId,
                  status: "inProgress",
                  items: [],
                  error: null,
                },
              },
            },
            {
              kind: "request",
              method: "mcpServer/elicitation/request",
              params: { ...params, threadId: "fixture", turnId },
            },
            {
              method: "turn/completed",
              params: {
                threadId: "fixture",
                turn: {
                  id: turnId,
                  status: "completed",
                  items: [],
                  error: null,
                },
              },
            },
          ];
        }),
      }),
    );
    writeFileSync(
      join(bin, "codex"),
      `#!${process.execPath}\n
if (process.argv.includes('--version')) { console.log('codex-cli 0.153.4'); process.exit(0); }
if (!process.argv.includes('app-server')) process.exit(64);
process.argv = [process.execPath, ${JSON.stringify(fixture)}, ${JSON.stringify(script)}];
await import(${JSON.stringify(new URL("../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs", import.meta.url).href)});
`,
      { mode: 0o700 },
    );
    await use({ PATH: `${bin}:${process.env.PATH ?? ""}`, ZDOTDIR: home });
  },
});

test("Codex MCP approval, form, URL, decline and stop complete through the built runtime", async ({
  app,
}) => {
  test.setTimeout(120_000);
  const { window, electron, home } = app;
  // Keep the full renderer-to-main URL path, but intercept the OS boundary so
  // this test never opens a real browser or contacts the supplied page.
  await electron.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as any).__mcpOpenedUrls = opened;
    shell.openExternal = async (url) => {
      opened.push(url);
    };
  });
  const openedUrls = () =>
    electron.evaluate(() => (globalThis as any).__mcpOpenedUrls as string[]);
  await waitForThreadProvider(window, "codex");
  const path = join(home, "elicitation-project");
  mkdirSync(path);
  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.value.id,
        providerId: "codex",
        permissionMode: "full",
        input: "Request app access",
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread.id as string;
  }, path);
  await window.evaluate((id) => {
    history.pushState({}, "", `/threads/${id}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, threadId);
  const banner = window.getByTestId("thread-pending-banner");
  const responses = () => {
    const path = join(home, "native-responses.jsonl");
    return existsSync(path)
      ? readFileSync(path, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line).result)
      : [];
  };
  const status = () =>
    window.evaluate(
      async (id) =>
        (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status,
      threadId,
    );
  const answered = async (count: number) => {
    await expect.poll(() => responses().length).toBe(count);
    await expect(banner).toHaveCount(0);
    await expect.poll(status).toBe("idle");
  };
  const ask = async (title: string) => {
    const composer = window.getByTestId("thread-command-input");
    await composer.fill("Next request");
    await composer.press("Enter");
    await expect(banner).toContainText(title);
    await expect(window.locator(".thread-status-badge")).toContainText(
      "Needs you",
    );
  };
  await expect(banner).toContainText("Calculator");
  await expect(banner).toContainText("cua_repl");
  await banner.getByRole("button", { name: "Allow for this session" }).click();
  await answered(1);
  expect(responses()[0]).toEqual({
    action: "accept",
    content: {},
    _meta: { persist: "session" },
  });

  await ask("Configure review reminder");
  await banner.getByRole("button", { name: "Submit response" }).click();
  await expect(banner.getByRole("alert")).toHaveCount(2);
  expect(responses()).toHaveLength(1);
  await banner.getByLabel("Reminder title").fill("Review changes");
  await banner.getByLabel("Repeat count").fill("2");
  await banner.getByRole("button", { name: "Submit response" }).click();
  await answered(2);
  expect(responses()[1]).toEqual({
    action: "accept",
    content: { title: "Review changes", count: 2 },
    _meta: null,
  });

  await ask("Allow calendar tool?");
  await expect(banner).toContainText("create_event");
  await expect(banner).toContainText("Review");
  await expect(
    banner.getByRole("button", { name: "Always allow" }),
  ).toHaveCount(0);
  await banner.getByRole("button", { name: "Decline", exact: true }).click();
  await answered(3);
  expect(responses()[2]).toEqual({
    action: "decline",
    content: null,
    _meta: null,
  });

  await ask("Unsupported nested form");
  await expect(
    banner.getByRole("button", { name: "Submit response" }),
  ).toHaveCount(0);
  await banner.getByRole("button", { name: "Decline", exact: true }).click();
  await answered(4);
  expect(responses()[3]).toEqual({
    action: "decline",
    content: null,
    _meta: null,
  });

  await ask("Connect calendar account");
  await expect(banner).toContainText("Opening the link does not confirm");
  expect(await openedUrls()).toEqual([]);
  expect(responses()).toHaveLength(4);
  await banner
    .getByRole("button", { name: "Open example.com", exact: true })
    .click();
  await expect.poll(openedUrls).toEqual([urlRequest.url]);
  await answered(5);
  expect(responses()[4]).toEqual({
    action: "accept",
    content: null,
    _meta: null,
  });

  await ask("Configure review reminder");
  await window.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(window.locator(".thread-status-badge.is-error")).toHaveCount(0);
});
