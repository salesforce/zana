#!/usr/bin/env python3
"""One-shot: split src/main/index.ts registerIpc() into apps/desktop/src/ipc/*.ts"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "src/main/index.ts"
OUT = ROOT / "apps/desktop/src/ipc"

FAMILY_FILE = {
    "projects": "projects",
    "ssh": "projects",
    "windows": "windows",
    "terminals": "terminals",
    "menubar": "terminals",
    "config": "config",
    "overseer": "config",
    "projectSettings": "config",
    "executionConsent": "execution",
    "harnessAuth": "execution",
    "harness": "execution",
    "claude": "sessions",
    "opencode": "sessions",
    "history": "sessions",
    "fs": "fs",
    "openers": "fs",
    "clipboard": "fs",
    "editor": "fs",
    "git": "fs",
    "inbox": "inbox",
    "usage": "inbox",
    "suggestions": "inbox",
    "agents": "agents",
    "saved": "saved",
    "library": "saved",
    "mcp": "plugins",
    "plugins": "plugins",
    "pluginApps": "plugins",
    "extensions": "extensions",
    "skills": "skills",
    "commands": "skills",
    "claudeSettings": "settings",
    "codexSettings": "settings",
    "openCodeSettings": "settings",
    "authorizations": "settings",
    "app": "app",
    "updates": "app",
    "deps": "app",
    "scheduler": "scheduler",
    "goals": "scheduler",
    "followups": "scheduler",
    "feed": "scheduler",
    "personas": "personas",
    "teams": "personas",
    "autonomousRuns": "personas",
    "quickPrompts": "personas",
    "llmPrompts": "personas",
    "voice": "voice",
    "modules": "modules",
    "test": "modules",
}

FILE_ORDER = [
    "projects",
    "windows",
    "terminals",
    "config",
    "execution",
    "sessions",
    "fs",
    "inbox",
    "agents",
    "saved",
    "plugins",
    "extensions",
    "skills",
    "settings",
    "app",
    "scheduler",
    "personas",
    "voice",
    "modules",
]

KEYWORDS = {
    "if", "else", "return", "async", "await", "function", "const", "let", "var",
    "class", "new", "typeof", "instanceof", "try", "catch", "finally", "throw",
    "true", "false", "null", "undefined", "this", "super", "import", "export",
    "from", "as", "type", "interface", "extends", "implements", "public",
    "private", "protected", "static", "readonly", "void", "never", "unknown",
    "any", "string", "number", "boolean", "object", "symbol", "bigint", "of",
    "in", "for", "while", "do", "switch", "case", "break", "continue", "default",
    "yield", "delete", "enum", "satisfies", "keyof", "infer", "is", "asserts",
    "unique", "abstract", "declare", "module", "namespace", "require",
    "constructor", "debugger", "NaN", "Infinity", "Promise", "Array", "Map",
    "Set", "Record", "Partial", "Pick", "Omit", "Readonly", "ReturnType",
    "Awaited", "NonNullable", "Error", "Date", "JSON", "Math", "Object",
    "String", "Number", "Boolean", "Buffer", "Uint8Array", "NodeJS", "process",
    "console", "globalThis", "setTimeout", "clearTimeout", "setInterval",
    "clearInterval", "parseInt", "parseFloat", "isNaN", "isFinite", "RegExp",
    "URL", "AbortController", "AbortSignal", "IPC", "ipcMain",
}

LOCAL_ONLY = {"harnessVerificationCache", "verifiedHarnesses", "cloneRoot"}


def rewrite_from(src: str) -> str:
    if src.startswith("./"):
        return "../../../src/main/" + src[2:]
    if src.startswith("../../apps/desktop/src/"):
        return "../" + src[len("../../apps/desktop/src/") :]
    return src


def parse_imports(header: str):
    """Return {name: (kind, source, orig_name)} kind in {value, type, namespace}."""
    names: dict[str, tuple[str, str, str]] = {}
    # strip block comments in header to avoid confusion
    header_nc = re.sub(r"/\*.*?\*/", "", header, flags=re.S)

    for m in re.finditer(
        r"^import\s+(type\s+)?(\*\s+as\s+(\w+)\s+from\s+['\"]([^'\"]+)['\"]|{([^}]+)}\s+from\s+['\"]([^'\"]+)['\"])",
        header_nc,
        re.M,
    ):
        is_type_import = bool(m.group(1))
        if m.group(3):
            names[m.group(3)] = ("namespace", m.group(4), m.group(3))
            continue
        inner, src = m.group(5), m.group(6)
        for part in inner.split(","):
            part = part.strip()
            if not part:
                continue
            tm = re.match(r"^(type\s+)?(\w+)(?:\s+as\s+(\w+))?$", part)
            if not tm:
                continue
            orig = tm.group(2)
            alias = tm.group(3) or orig
            kind = "type" if is_type_import or tm.group(1) else "value"
            names[alias] = (kind, src, orig)
    return names


def parse_defined(src: str) -> set[str]:
    defined = set()
    for m in re.finditer(
        r"^(?:export\s+)?(?:async\s+)?(?:function|class)\s+(\w+)",
        src,
        re.M,
    ):
        defined.add(m.group(1))
    for m in re.finditer(
        r"^(?:export\s+)?(?:const|let)\s+(\w+)",
        src,
        re.M,
    ):
        defined.add(m.group(1))
    return defined


def strip_strings_comments(text: str) -> str:
    out = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("//", i):
            j = text.find("\n", i)
            if j < 0:
                break
            out.append("\n")
            i = j + 1
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            if j < 0:
                break
            chunk = text[i : j + 2]
            out.append("\n" * chunk.count("\n"))
            i = j + 2
            continue
        if text[i] in "'\"`":
            q = text[i]
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if q == "`" and text[j] == "$" and j + 1 < n and text[j + 1] == "{":
                    # template interpolation — keep scanning inside
                    depth = 1
                    j += 2
                    while j < n and depth:
                        if text[j] == "{":
                            depth += 1
                        elif text[j] == "}":
                            depth -= 1
                        j += 1
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            out.append(" " * (j - i))
            i = j
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


IDENT_RE = re.compile(r"(?<![\w.])([A-Za-z_][A-Za-z0-9_]*)")
IPC_RE = re.compile(r"\bIPC\.([A-Za-z]+)\.")


def used_idents(chunk: str) -> set[str]:
    return {m.group(1) for m in IDENT_RE.finditer(strip_strings_comments(chunk))}


def local_bindings(chunk: str) -> set[str]:
    locals_ = set()
    for m in re.finditer(r"\b(?:const|let|function)\s+(\w+)", chunk):
        locals_.add(m.group(1))
    # function params in (a: T, b: U) and destructuring first-level names
    for m in re.finditer(r"\(([^)]*)\)\s*(?::\s*[^{=]+)?\s*=>", chunk):
        for p in m.group(1).split(","):
            p = p.strip()
            nm = re.match(r"(?:\.\.\.)?(\w+)", p)
            if nm and nm.group(1) not in ("async",):
                locals_.add(nm.group(1))
    return locals_


HANDLER_START_RE = re.compile(
    r"safeHandle(?:FromWindow)?(?:<[\s\S]*?>)?\s*\(|ipcMain\.(?:handle|on)\s*\("
)


def match_paren(text: str, open_idx: int) -> int:
    """Return index of matching close paren for text[open_idx] == '('."""
    depth = 0
    i = open_idx
    n = len(text)
    while i < n:
        ch = text[i]
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if ch in "'\"`":
            q = ch
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if q == "`" and text.startswith("${", i):
                    depth_t = 1
                    i += 2
                    while i < n and depth_t:
                        if text[i] == "{":
                            depth_t += 1
                        elif text[i] == "}":
                            depth_t -= 1
                        i += 1
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"unbalanced paren at {open_idx}")


def iter_handler_spans(body: str) -> list[tuple[int, int, str]]:
    """(start, end, ipc_family) for each safeHandle/ipcMain.handle/on call."""
    spans = []
    i = 0
    while True:
        m = HANDLER_START_RE.search(body, i)
        if not m:
            break
        open_idx = m.end() - 1
        close_idx = match_paren(body, open_idx)
        end = close_idx + 1
        if end < len(body) and body[end] == ";":
            end += 1
        inner = body[m.start() : end]
        fam_m = IPC_RE.search(strip_strings_comments(inner))
        if not fam_m:
            raise SystemExit(f"handler without IPC.family at offset {m.start()}: {inner[:80]!r}")
        fam = fam_m.group(1)
        if fam not in FAMILY_FILE:
            raise SystemExit(f"unmapped IPC family {fam}")
        spans.append((m.start(), end, fam))
        i = end
    return spans


def split_families(body: str) -> dict[str, str]:
    """Assign body text to files. Handler calls split at call start; interstitial
    text stays with the previous family (comments glued to the next handler)."""
    spans = iter_handler_spans(body)
    file_chunks: dict[str, list[str]] = defaultdict(list)
    preamble = body[: spans[0][0]] if spans else body
    # Leading locals (verifiedHarnesses) belong with execution.
    if preamble.strip():
        file_chunks["execution"].append(preamble)

    for idx, (start, end, fam) in enumerate(spans):
        dest = FAMILY_FILE[fam]
        lead_start = spans[idx - 1][1] if idx else start
        lead = body[lead_start:start]
        if idx > 0 and lead.strip():
            lines = lead.splitlines(keepends=True)
            glue = []
            rest = []
            saw_code = False
            for line in reversed(lines):
                stripped = line.strip()
                is_comment = (
                    stripped.startswith("//")
                    or stripped.startswith("*")
                    or stripped.startswith("/*")
                    or stripped.startswith("*/")
                    or stripped == ""
                )
                if not saw_code and is_comment:
                    glue.append(line)
                else:
                    saw_code = True
                    rest.append(line)
            rest.reverse()
            glue.reverse()
            prev_fam = FAMILY_FILE[spans[idx - 1][2]]
            if rest:
                file_chunks[prev_fam].append("".join(rest))
            file_chunks[dest].append("".join(glue) + body[start:end])
        else:
            file_chunks[dest].append(body[start:end])
        # Keep ASI-safe separation between concatenated handler calls.
        if not file_chunks[dest][-1].endswith("\n"):
            file_chunks[dest][-1] += "\n"

    if spans:
        tail = body[spans[-1][1] :]
        if tail.strip():
            file_chunks[FAMILY_FILE[spans[-1][2]]].append(tail)

    return {k: "".join(v) for k, v in file_chunks.items()}


def pascal(name: str) -> str:
    return "".join(p.title() for p in name.replace("-", "_").split("_"))


def main() -> None:
    text = INDEX.read_text()
    start = text.find("function registerIpc() {")
    if start < 0:
        raise SystemExit("registerIpc not found")
    # body between first { and the matching close before buildAppMenu
    end_marker = "\nfunction buildAppMenu()"
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit("buildAppMenu not found")
    fn = text[start:end]
    # drop signature line
    first_nl = fn.find("\n")
    body = fn[first_nl + 1 :]
    if body.rstrip().endswith("}"):
        # trailing close of registerIpc
        body = body[: body.rstrip().rfind("}")]

    header = text[:start]
    import_map = parse_imports(header)
    defined = parse_defined(header)

    families = split_families(body)
    OUT.mkdir(parents=True, exist_ok=True)

    all_ctx: set[str] = set()
    file_meta = {}

    for fname, chunk in families.items():
        used = used_idents(chunk)
        locals_ = local_bindings(chunk) | LOCAL_ONLY | KEYWORDS
        ctx_names = sorted(
            n
            for n in used
            if n in defined and n not in locals_ and n not in import_map
        )
        # imported values used
        value_imports: dict[str, list[tuple[str, str]]] = defaultdict(list)
        type_imports: dict[str, list[tuple[str, str]]] = defaultdict(list)
        ns_imports: list[tuple[str, str]] = []
        for n in sorted(used):
            if n in locals_ or n in KEYWORDS:
                continue
            if n not in import_map:
                continue
            kind, src, orig = import_map[n]
            rewritten = rewrite_from(src)
            if kind == "namespace":
                ns_imports.append((n, rewritten))
            elif kind == "type":
                type_imports[rewritten].append((orig, n))
            else:
                value_imports[rewritten].append((orig, n))
        # types that are also used as types from mixed imports: if a name is
        # type-only in import_map we're good; value imports of classes used
        # only as types still need the value import (TS erases type-only).
        all_ctx.update(ctx_names)
        file_meta[fname] = {
            "chunk": chunk,
            "ctx": ctx_names,
            "value_imports": value_imports,
            "type_imports": type_imports,
            "ns_imports": ns_imports,
        }

    # ctx.ts
    ctx_fields = sorted(all_ctx)
    ctx_ts = [
        "/** Compatibility IPC host bindings. Bound once by src/main/index.ts before family registration. */",
        "export interface IpcCtx {",
        *[f"  {n}: any;" for n in ctx_fields],
        "}",
        "",
        "export const ctx = {} as IpcCtx;",
        "",
        "export function bindIpcCtx(next: IpcCtx): void {",
        "  Object.assign(ctx, next);",
        "}",
        "",
    ]
    (OUT / "ctx.ts").write_text("\n".join(ctx_ts))

    def format_named(pairs: list[tuple[str, str]]) -> str:
        parts = []
        for orig, alias in pairs:
            parts.append(orig if orig == alias else f"{orig} as {alias}")
        return ", ".join(parts)

    for fname in FILE_ORDER:
        if fname not in file_meta:
            continue
        meta = file_meta[fname]
        lines = [
            "import { ipcMain } from 'electron';",
            "import { IPC } from '@zana-ai/zcc-desktop-contract';",
            "import { ctx } from './ctx.js';",
        ]
        for ns, src in meta["ns_imports"]:
            lines.append(f"import * as {ns} from '{src}';")
        for src, pairs in sorted(meta["value_imports"].items()):
            lines.append(f"import {{ {format_named(pairs)} }} from '{src}';")
        for src, pairs in sorted(meta["type_imports"].items()):
            lines.append(f"import type {{ {format_named(pairs)} }} from '{src}';")
        # domain product types used via index's type import — they live under
        # import_map already. Mixed: names that appear in used but were
        # imported as types from product are in type_imports.
        lines.append("")
        fn_name = f"register{pascal(fname)}Ipc"
        lines.append(f"export function {fn_name}(): void {{")
        if meta["ctx"]:
            dest = ", ".join(meta["ctx"])
            lines.append(f"  const {{ {dest} }} = ctx;")
        # indent original chunk (already has 2-space indent from being inside registerIpc)
        chunk = meta["chunk"]
        if not chunk.endswith("\n"):
            chunk += "\n"
        lines.append(chunk.rstrip("\n"))
        lines.append("}")
        lines.append("")
        (OUT / f"{fname}.ts").write_text("\n".join(lines) + "\n")

    # register.ts orchestrator
    orch = [
        "import { bindIpcCtx, type IpcCtx } from './ctx.js';",
    ]
    for fname in FILE_ORDER:
        if fname in file_meta:
            orch.append(
                f"import {{ register{pascal(fname)}Ipc }} from './{fname}.js';"
            )
    orch += [
        "",
        "export function registerIpcFamilies(host: IpcCtx): void {",
        "  bindIpcCtx(host);",
    ]
    for fname in FILE_ORDER:
        if fname in file_meta:
            orch.append(f"  register{pascal(fname)}Ipc();")
    orch += ["}", ""]
    (OUT / "register.ts").write_text("\n".join(orch) + "\n")

    # patch index.ts
    bind_fields = ",\n    ".join(ctx_fields)
    replacement = (
        "function registerIpc() {\n"
        "  registerIpcFamilies({\n"
        f"    {bind_fields}\n"
        "  });\n"
        "}\n"
    )
    new_text = text[:start] + replacement + text[end:]
    inserted = False
    for candidate in (
        "import { IPC } from '@zana-ai/zcc-desktop-contract';\n",
        "import { IPC } from '../shared/ipc.js';\n",
    ):
        if candidate in new_text and "registerIpcFamilies" not in new_text.split("function registerIpc")[0]:
            new_text = new_text.replace(candidate, candidate + "import { registerIpcFamilies } from '../../apps/desktop/src/ipc/register.js';\n", 1)
            inserted = True
            break
    if not inserted and "registerIpcFamilies" not in new_text.split("function registerIpc")[0]:
        raise SystemExit("IPC import not found")
    INDEX.write_text(new_text)

    print("files", sorted(file_meta))
    print("ctx fields", len(ctx_fields))
    print("index lines", new_text.count("\n") + 1)
    for fname in FILE_ORDER:
        p = OUT / f"{fname}.ts"
        if p.exists():
            print(f"  {fname}.ts {p.read_text().count(chr(10))+1} lines")


if __name__ == "__main__":
    main()
