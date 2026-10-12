import { describe, expect, it } from "vitest";
import {
  extractShellCommandFromString,
  parseShellCommandIntents,
} from "../src/tool-call-parsing.js";

describe("tool-call shell parsing", () => {
  it("treats quoted shell operators as literal arguments", () => {
    expect(parseShellCommandIntents('grep "a|b" "src > docs.txt"')).toEqual([
      {
        type: "search",
        cmd: 'grep "a|b" "src > docs.txt"',
        query: "a|b",
        path: "src > docs.txt",
      },
    ]);
    expect(parseShellCommandIntents('cat ">"')).toEqual([
      {
        type: "read",
        cmd: 'cat ">"',
        name: "cat",
        path: ">",
      },
    ]);
  });

  it("disqualifies commands with unquoted write redirects", () => {
    expect(parseShellCommandIntents("cat src/app.ts > /tmp/out.txt")).toEqual(
      [],
    );
  });

  it("unwraps known shell wrappers before intent parsing", () => {
    const command = extractShellCommandFromString(
      '/bin/zsh -lc "grep \\"a|b\\" src/app.ts"',
    );

    expect(command).toBe('grep "a|b" src/app.ts');
    expect(parseShellCommandIntents(command)).toEqual([
      {
        type: "search",
        cmd: 'grep "a|b" src/app.ts',
        query: "a|b",
        path: "src/app.ts",
      },
    ]);
  });

  it("resolves read paths against an earlier cd", () => {
    const dir = "/Users/dev/.claude/projects/p/session/tool-results";
    const command = `cd ${dir}/; head -c 600 out.txt; echo; rg -n '^<file' out.txt`;
    expect(parseShellCommandIntents(command)).toEqual([
      { type: "read", cmd: command, name: "head", path: `${dir}/out.txt` },
    ]);
    expect(parseShellCommandIntents("cd src && cat ./app.ts")[0]).toMatchObject({
      path: "src/app.ts",
    });
    expect(parseShellCommandIntents("cd /a/b && cd ../c && cat x")[0]).toMatchObject({
      path: "/a/c/x",
    });
    expect(parseShellCommandIntents("cd .. && cat x")[0]).toMatchObject({
      path: "../x",
    });
    expect(parseShellCommandIntents("cd / && cat ../x")[0]).toMatchObject({
      path: "/x",
    });
    expect(parseShellCommandIntents("cd src && cd .. && ls")[0]).toMatchObject({
      type: "list_files",
      path: ".",
    });
    expect(parseShellCommandIntents("cd && cat x")[0]).toMatchObject({
      path: "~/x",
    });
    expect(parseShellCommandIntents("cd /a && ls")[0]).toMatchObject({
      type: "list_files",
      path: "/a",
    });
    expect(parseShellCommandIntents("cd /a && rg TODO src")[0]).toMatchObject({
      type: "search",
      path: "/a/src",
    });
  });

  it("drops relative paths after a cd whose target is unknown", () => {
    expect(parseShellCommandIntents("cd - && cat x")[0]).toMatchObject({
      path: null,
    });
    expect(parseShellCommandIntents("cd - && cat /abs/x")[0]).toMatchObject({
      path: "/abs/x",
    });
    expect(parseShellCommandIntents("cd $UNSET && cat x")[0]).toMatchObject({
      path: "$UNSET/x",
    });
  });

  it("expands literal shell variables assigned in earlier segments", () => {
    const command = "F=/tmp/out.txt; sed -n '1,9p' $F | rg -v '^$'";
    expect(parseShellCommandIntents(command)).toEqual([
      { type: "read", cmd: command, name: "sed", path: "/tmp/out.txt" },
    ]);
    expect(parseShellCommandIntents("D=/a; F=${D}/b; cat $F")[0]).toMatchObject({
      path: "/a/b",
    });
    expect(parseShellCommandIntents("cat $F")[0]).toMatchObject({ path: "$F" });
    // A prefix assignment only reaches the command's environment, not its
    // already-expanded arguments.
    expect(parseShellCommandIntents("F=/a cat $F")[0]).toMatchObject({
      path: "$F",
    });
    // A value that is itself dynamic stays unresolved.
    expect(parseShellCommandIntents("F=$(pwd)/x; cat $F")[0]).toMatchObject({
      path: "$F",
    });
  });

  it("leaves paths untouched when no earlier segment changes context", () => {
    expect(parseShellCommandIntents("cat ./src/../app.ts")[0]).toMatchObject({
      path: "./src/../app.ts",
    });
  });

  it("treats unquoted newlines as shell segment boundaries", () => {
    const command =
      "git ls-tree -d main packages/ | head -30\n" +
      'echo "==="\n' +
      "git show main:.gitignore 2>/dev/null | grep -E 'legacy-audit|timeline-replay' || echo \"(no matches)\"";

    expect(
      parseShellCommandIntents(command),
    ).toEqual([
      {
        type: "search",
        cmd: command,
        query: "legacy-audit|timeline-replay",
        path: null,
      },
    ]);
  });
});
