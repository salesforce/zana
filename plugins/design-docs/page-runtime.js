// Generated from src/runtime by scripts/build-app.mjs; do not edit.
"use strict";
(() => {
  // src/app/highlight.ts
  var COMMENT_HIGHLIGHT = "dd-comment";
  var FOCUS_HIGHLIGHT = "dd-comment-focus";
  function normalizeQuote(quote) {
    return quote.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/gm, "").replace(/[*_`~]+/g, "").replace(/\s+/g, " ").trim();
  }
  var HIDDEN_TEXT = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  function indexText(root) {
    const walker = root.ownerDocument.createTreeWalker(root, 4, {
      acceptNode: (node) => HIDDEN_TEXT.has(node.parentElement?.tagName.toUpperCase() ?? "") ? 2 : 1
    });
    const nodes = [];
    const starts = [];
    let raw = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      starts.push(raw.length);
      nodes.push(node);
      raw += node.data;
    }
    let normalized = "";
    const map = [];
    let lastWasSpace = true;
    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (/\s/.test(char)) {
        if (!lastWasSpace) {
          normalized += " ";
          map.push(index);
        }
        lastWasSpace = true;
      } else {
        normalized += char;
        map.push(index);
        lastWasSpace = false;
      }
    }
    return { nodes, starts, normalized, map };
  }
  function locate(index, rawOffset) {
    let low = 0;
    let high = index.starts.length - 1;
    while (low < high) {
      const mid = low + high + 1 >> 1;
      if (index.starts[mid] <= rawOffset) low = mid;
      else high = mid - 1;
    }
    return [index.nodes[low], rawOffset - index.starts[low]];
  }
  function findQuoteRanges(root, quotes) {
    const found = /* @__PURE__ */ new Map();
    if (!quotes.length) return found;
    const index = indexText(root);
    if (!index.nodes.length) return found;
    for (const quote of quotes) {
      if (found.has(quote)) continue;
      let needle = "";
      let at = -1;
      for (const candidate of /* @__PURE__ */ new Set([quote.replace(/\s+/g, " ").trim(), normalizeQuote(quote)])) {
        if (candidate.length < 2) continue;
        at = index.normalized.indexOf(candidate);
        if (at >= 0) {
          needle = candidate;
          break;
        }
      }
      if (at < 0) continue;
      const [startNode, startOffset] = locate(index, index.map[at]);
      const [endNode, endOffset] = locate(index, index.map[at + needle.length - 1]);
      const range = root.ownerDocument.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset + 1);
      found.set(quote, range);
    }
    return found;
  }
  function registry() {
    const css = globalThis.CSS;
    const Highlight = globalThis.Highlight;
    return css?.highlights && Highlight ? { registry: css.highlights, Highlight } : null;
  }
  var owners = /* @__PURE__ */ new Map();
  function paintRanges(name, owner, ranges) {
    const api = registry();
    if (!api) return;
    const byOwner = owners.get(name) ?? /* @__PURE__ */ new Map();
    owners.set(name, byOwner);
    if (ranges.length) byOwner.set(owner, ranges);
    else byOwner.delete(owner);
    const all = [...byOwner.values()].flat();
    if (all.length) api.registry.set(name, new api.Highlight(...all));
    else api.registry.delete(name);
  }

  // src/shared/limits.ts
  var MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
  var MAX_BINARY_FILE_BYTES = 2 * 1024 * 1024;
  var MAX_DOC_BYTES = 24 * 1024 * 1024;
  var LARGE_TEXT_FILE_BYTES = 256 * 1024;
  var MAX_HISTORY_BYTES_PER_DOC = 48 * 1024 * 1024;
  var MAX_QUOTE_LENGTH = 500;

  // src/shared/frame-protocol.ts
  var PAGE_CONFIG_ID = "dd-page";
  var PAGE_FILES_ID = "dd-files";
  var PAGE_HELLO = "dd-page-hello";
  var MAX_PAGE_PROBLEMS = 50;
  var MAX_PAGE_STORAGE_CHARS = 256 * 1024;

  // src/shared/paths.ts
  var MAX_PATH_LENGTH = 160;
  var MAX_PATH_DEPTH = 10;
  var SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
  var DesignDocPathError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "DesignDocPathError";
    }
  };
  function normalizeDocPath(raw) {
    if (typeof raw !== "string") throw new DesignDocPathError("path must be a string");
    let value = raw.trim().replace(/\\/g, "/");
    while (value.startsWith("./")) value = value.slice(2);
    if (!value) throw new DesignDocPathError("path is required");
    if (value.startsWith("/")) throw new DesignDocPathError("path must be relative to the design doc");
    if (value.length > MAX_PATH_LENGTH) {
      throw new DesignDocPathError(`path must be at most ${MAX_PATH_LENGTH} characters`);
    }
    const segments = value.split("/");
    if (segments.length > MAX_PATH_DEPTH) {
      throw new DesignDocPathError(`path must be at most ${MAX_PATH_DEPTH} levels deep`);
    }
    for (const segment of segments) {
      if (segment === ".." || segment === ".") {
        throw new DesignDocPathError('path must not contain "." or ".." segments');
      }
      if (!SEGMENT_PATTERN.test(segment) || segment.endsWith(" ") || segment.endsWith(".")) {
        throw new DesignDocPathError(
          `invalid path segment ${JSON.stringify(segment)}: use letters, digits, ".", "_", "-" or spaces, starting with a letter or digit`
        );
      }
    }
    return segments.join("/");
  }
  function extensionOf(path) {
    const name = path.split("/").pop() ?? path;
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
  }
  var KIND_BY_EXTENSION = {
    md: "markdown",
    markdown: "markdown",
    mdx: "markdown",
    html: "html",
    htm: "html",
    mmd: "mermaid",
    mermaid: "mermaid",
    svg: "svg",
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    webp: "image",
    ico: "image",
    woff: "font",
    woff2: "font",
    ttf: "font",
    otf: "font",
    txt: "text"
  };
  var IMAGE_MEDIA_TYPES = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon"
  };
  var FONT_MEDIA_TYPES = {
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf"
  };
  var CODE_LANGUAGE_BY_EXTENSION = {
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    rb: "ruby",
    sql: "sql",
    sh: "bash",
    css: "css",
    graphql: "graphql",
    gql: "graphql",
    proto: "protobuf",
    xml: "xml",
    cls: "apex",
    apex: "apex"
  };
  function fileKindOf(path) {
    const ext = extensionOf(path);
    const kind = KIND_BY_EXTENSION[ext];
    if (kind) return kind;
    if (CODE_LANGUAGE_BY_EXTENSION[ext]) return "code";
    return "text";
  }
  var TEXT_MEDIA_TYPES = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    xml: "application/xml",
    csv: "text/csv",
    md: "text/markdown",
    txt: "text/plain"
  };
  function mediaTypeOf(path) {
    const ext = extensionOf(path);
    const binary = IMAGE_MEDIA_TYPES[ext] ?? FONT_MEDIA_TYPES[ext];
    if (binary) return binary;
    return `${TEXT_MEDIA_TYPES[ext] ?? "text/plain"};charset=utf-8`;
  }

  // src/shared/page.ts
  var PAGE_ORIGIN = "https://doc.invalid";
  var PAGE_ASSET_BUDGET = 12 * 1024 * 1024;
  var MAX_RPC_PAYLOAD_BYTES = 960 * 1024;
  function pageUrl(path) {
    return `${PAGE_ORIGIN}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }
  function pageTargetOf(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.origin !== PAGE_ORIGIN) return null;
    let path;
    try {
      path = parsed.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment)).join("/");
    } catch {
      return null;
    }
    if (!path || parsed.pathname.endsWith("/")) path = path ? `${path}/index.html` : "index.html";
    try {
      path = normalizeDocPath(path);
    } catch {
      return null;
    }
    return { path, hash: parsed.hash ? decodeHash(parsed.hash.slice(1)) : null };
  }
  function decodeHash(hash) {
    try {
      return decodeURIComponent(hash);
    } catch {
      return hash;
    }
  }

  // src/runtime/page-runtime.ts
  var SCRIPT_BLOCK = 'script[type="text/x-dd-script"]';
  var FETCH_TIMEOUT_MS = 3e4;
  var PAINT_DELAY_MS = 250;
  var STORAGE_DELAY_MS = 400;
  var REPORT_DELAY_MS = 150;
  var WINDOW_EVENTS = /^(load|unload|beforeunload|resize|scroll|hashchange|popstate|message|pageshow|pagehide|online|offline|storage|focus|blur|error)$/;
  var OPENABLE = /^(https?|mailto):$/;
  var HIGHLIGHT_CSS = `::highlight(${COMMENT_HIGHLIGHT}) { background-color: rgba(212, 160, 23, 0.28); text-decoration: underline 2px rgb(212, 160, 23); }
::highlight(${FOCUS_HIGHLIGHT}) { background-color: rgba(212, 160, 23, 0.55); }`;
  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function isPageFile(value) {
    const file = record(value);
    return !!file && typeof file.content === "string" && (file.encoding === "utf8" || file.encoding === "base64") && typeof file.kind === "string";
  }
  function takeJson(doc, id) {
    const block = doc.getElementById(id);
    if (!block) return null;
    block.remove();
    try {
      return JSON.parse(block.textContent ?? "");
    } catch {
      return null;
    }
  }
  function readPageConfig(doc) {
    const raw = record(takeJson(doc, PAGE_CONFIG_ID)) ?? {};
    const strings = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : void 0;
    const scroll = record(raw.scroll);
    const config = {
      mode: raw.mode === "standalone" ? "standalone" : "frame",
      docId: typeof raw.docId === "string" ? raw.docId : "",
      path: typeof raw.path === "string" ? raw.path : ""
    };
    if (typeof raw.endpoint === "string") config.endpoint = raw.endpoint;
    if (strings(raw.files)) config.files = strings(raw.files);
    if (strings(raw.missing)) config.missing = strings(raw.missing);
    if (strings(raw.quotes)) config.quotes = strings(raw.quotes);
    if (typeof raw.hash === "string") config.hash = raw.hash;
    if (scroll && Number.isFinite(scroll.x) && Number.isFinite(scroll.y)) config.scroll = { x: scroll.x, y: scroll.y };
    const storage = record(raw.storage);
    if (storage) config.storage = Object.fromEntries(Object.entries(storage).filter((entry) => typeof entry[1] === "string"));
    return config;
  }
  function readPack(doc) {
    const pack = /* @__PURE__ */ new Map();
    for (const [path, file] of Object.entries(record(takeJson(doc, PAGE_FILES_ID)) ?? {})) {
      if (isPageFile(file)) pack.set(path, file);
    }
    return pack;
  }
  function decodeBase64(content) {
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  function fileBody(file) {
    return file.encoding === "base64" ? decodeBase64(file.content) : file.content;
  }
  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  function opensNewTab(target) {
    return !!target && !["_self", "_parent", "_top"].includes(target.trim().toLowerCase());
  }
  var MemoryStorage = class {
    #items;
    #changed;
    constructor(seed = {}, changed = () => {
    }) {
      this.#items = new Map(Object.entries(seed));
      this.#changed = changed;
    }
    get length() {
      return this.#items.size;
    }
    key(index) {
      return [...this.#items.keys()][index] ?? null;
    }
    getItem(key) {
      return this.#items.get(String(key)) ?? null;
    }
    setItem(key, value) {
      this.#items.set(String(key), String(value));
      this.#changed();
    }
    removeItem(key) {
      if (this.#items.delete(String(key))) this.#changed();
    }
    clear() {
      if (!this.#items.size) return;
      this.#items.clear();
      this.#changed();
    }
    entries() {
      return Object.fromEntries(this.#items);
    }
  };
  function ensureStorage(win, name, seed, changed) {
    try {
      if (win[name]) return null;
    } catch {
    }
    const storage = new MemoryStorage(seed, changed);
    try {
      Object.defineProperty(win, name, { configurable: true, enumerable: true, get: () => storage });
    } catch {
      return null;
    }
    return storage;
  }
  function ensureCookies(doc) {
    try {
      void doc.cookie;
      return false;
    } catch {
    }
    const jar = /* @__PURE__ */ new Map();
    Object.defineProperty(doc, "cookie", {
      configurable: true,
      get: () => [...jar].map(([key, value]) => key ? `${key}=${value}` : value).join("; "),
      set: (raw) => {
        const [pair = "", ...attributes] = String(raw).split(";");
        const eq = pair.indexOf("=");
        const key = eq < 0 ? "" : pair.slice(0, eq).trim();
        const value = (eq < 0 ? pair : pair.slice(eq + 1)).trim();
        const expired = attributes.some((attribute) => {
          const [name = "", setting = ""] = attribute.split("=").map((part) => part.trim());
          if (name.toLowerCase() === "max-age") return Number(setting) <= 0;
          return name.toLowerCase() === "expires" && Date.parse(setting) <= Date.now();
        });
        if (expired) jar.delete(key);
        else jar.set(key, value);
      }
    });
    return true;
  }
  function debounce(win, delay, run) {
    let timer;
    return () => {
      if (timer !== void 0) win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        timer = void 0;
        run();
      }, delay);
    };
  }
  function throttle(win, delay, run) {
    let timer;
    return () => {
      if (timer !== void 0) return;
      timer = win.setTimeout(() => {
        timer = void 0;
        run();
      }, delay);
    };
  }
  function override(target, name, value) {
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
  }
  function startPageRuntime(win, options = {}) {
    const doc = win.document;
    const config = readPageConfig(doc);
    const pack = readPack(doc);
    const frame = config.mode === "frame";
    const files = config.files ? new Set(config.files) : null;
    const problems = [];
    const seenProblems = /* @__PURE__ */ new Set();
    const labels = /* @__PURE__ */ new Map();
    const nativeOpen = win.open;
    let port = null;
    if (frame && win.parent && win.parent !== win && typeof win.MessageChannel === "function") {
      const channel = new win.MessageChannel();
      port = channel.port1;
      win.parent.postMessage({ dd: PAGE_HELLO }, "*", [channel.port2]);
    }
    const post = (message) => {
      try {
        port?.postMessage(message);
      } catch {
      }
    };
    const report = (problem) => {
      const key = [problem.kind, problem.message, problem.source ?? "", problem.line ?? ""].join("\0");
      if (seenProblems.has(key) || problems.length >= MAX_PAGE_PROBLEMS) return;
      seenProblems.add(key);
      problems.push(problem);
      if (port) post({ type: "problem", problem });
      else if (problem.kind !== "error") win.console?.warn?.(`[design doc] ${problem.source ? `${problem.source}: ` : ""}${problem.message}`);
    };
    const labelOf = (url) => {
      if (!url) return config.path;
      return labels.get(url) ?? (url.startsWith("dd:") ? safeDecode(url.slice(3)) : config.path);
    };
    win.addEventListener("error", (event) => {
      if (!(event instanceof win.ErrorEvent)) return;
      report({ kind: "error", message: event.message || "Script error", source: labelOf(event.filename), ...event.lineno ? { line: event.lineno } : {} });
    });
    win.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      report({ kind: "error", message: `Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`, source: config.path });
    });
    doc.addEventListener("securitypolicyviolation", (event) => {
      if (frame && event.effectiveDirective === "script-src-attr" || event.blockedURI.startsWith(PAGE_ORIGIN)) return;
      const blocked = event.blockedURI || "inline code";
      report({
        kind: "blocked",
        message: `The preview's sandbox blocked ${blocked} (${event.effectiveDirective || event.violatedDirective})`,
        source: labelOf(event.sourceFile),
        ...event.lineNumber ? { line: event.lineNumber } : {}
      });
    });
    const absoluteUrl = (raw) => {
      try {
        return new URL(raw, doc.baseURI);
      } catch {
        return null;
      }
    };
    const docTarget = (raw) => {
      const url = absoluteUrl(raw);
      return url?.origin === PAGE_ORIGIN ? pageTargetOf(url.href) : void 0;
    };
    let nextRequest = 0;
    const pending = /* @__PURE__ */ new Map();
    const load = (path) => {
      if (!frame) return Promise.resolve(pack.get(path) ?? null);
      if (!port) return Promise.resolve(null);
      const id = nextRequest++;
      return new Promise((resolve) => {
        const timer = win.setTimeout(() => settle(null), FETCH_TIMEOUT_MS);
        const settle = (file) => {
          win.clearTimeout(timer);
          pending.delete(id);
          resolve(file);
        };
        pending.set(id, settle);
        post({ type: "fetch", id, path });
      });
    };
    const loadNow = (path) => frame ? void 0 : pack.get(path) ?? null;
    const reportMissing = (path, what) => {
      const leftOut = !frame && files?.has(path);
      report({
        kind: "missing",
        message: leftOut ? `${what} ${path}, which this standalone page left out to stay small; open the doc in Zana to load it` : `${what} ${path}, which is not a file in this doc`,
        source: config.path
      });
    };
    const response = (path, file, head) => {
      const result = file ? new win.Response(head ? null : fileBody(file), { status: 200, statusText: "OK", headers: { "content-type": mediaTypeOf(path) } }) : new win.Response(head ? null : "Not found", { status: 404, statusText: "Not Found", headers: { "content-type": "text/plain;charset=utf-8" } });
      override(result, "url", pageUrl(path));
      return result;
    };
    const nativeFetch = win.fetch;
    if (typeof nativeFetch === "function") {
      win.fetch = function fetch(input, init) {
        const raw = typeof input === "object" && input && "url" in input ? input.url : String(input);
        const target = docTarget(raw);
        if (target === void 0) return nativeFetch.call(win, input, init);
        const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          report({ kind: "blocked", message: `A ${method} request to ${target?.path ?? raw} has nowhere to go: published pages are static`, source: config.path });
          return Promise.resolve(new win.Response(null, { status: 405, statusText: "Method Not Allowed" }));
        }
        if (!target) return Promise.resolve(response("", null, method === "HEAD"));
        return load(target.path).then((file) => {
          if (!file) reportMissing(target.path, "The page fetched");
          return response(target.path, file, method === "HEAD");
        });
      };
    }
    installRequests(win, { docTarget, load, loadNow, reportMissing, report, source: config.path });
    let local = null;
    const storageChanged = throttle(win, STORAGE_DELAY_MS, () => {
      const entries = local?.entries() ?? {};
      const size = Object.entries(entries).reduce((total, [key, value]) => total + key.length + value.length, 0);
      if (size <= MAX_PAGE_STORAGE_CHARS) post({ type: "storage", entries });
    });
    local = ensureStorage(win, "localStorage", config.storage, frame ? storageChanged : void 0);
    ensureStorage(win, "sessionStorage");
    ensureCookies(doc);
    const go = options.go ?? ((url, how) => {
      if (how === "tab") nativeOpen?.call(win, url, "_blank", "noopener");
      else win.location[how](url);
    });
    const standaloneUrl = (target) => {
      let path = target.path;
      if (files && !files.has(path) && files.has(`${path}/index.html`)) path = `${path}/index.html`;
      const url = new URL(`${config.endpoint ?? ""}/${fileKindOf(path) === "html" ? "page" : "file"}`, win.location.href);
      url.searchParams.set("doc", config.docId);
      url.searchParams.set("path", path);
      if (target.hash !== null) url.hash = target.hash;
      return url.href;
    };
    const scrollToFragment = (hash) => {
      if (!hash || hash.toLowerCase() === "top") {
        win.scrollTo(0, 0);
        return;
      }
      (doc.getElementById(hash) ?? doc.getElementsByName(hash)[0])?.scrollIntoView?.();
    };
    const goToHash = (hash) => {
      if (safeDecode(win.location.hash.slice(1)) !== hash) win.location.hash = hash;
      else scrollToFragment(hash);
    };
    const navigate = (target, { newTab = false, redirect = false } = {}) => {
      if (target.path === config.path && !newTab && target.hash !== null && !redirect) {
        goToHash(target.hash);
        return;
      }
      if (frame) post({ type: "navigate", path: target.path, hash: target.hash, newTab, redirect });
      else go(standaloneUrl(target), newTab ? "tab" : redirect ? "replace" : "assign");
    };
    win.open = function open(url, target, features) {
      if (url !== void 0 && String(url) !== "") {
        const link = docTarget(String(url));
        if (link) {
          navigate(link, { newTab: target === void 0 || opensNewTab(target) });
          return null;
        }
        if (link === null) {
          report({ kind: "missing", message: `window.open(${String(url)}) names no file in this doc`, source: config.path });
          return null;
        }
        const absolute = frame ? absoluteUrl(String(url)) : null;
        if (absolute && OPENABLE.test(absolute.protocol)) {
          post({ type: "open", url: absolute.href });
          return null;
        }
      }
      return nativeOpen.call(win, url, target, features);
    };
    const scriptUrl = options.scriptUrl ?? ((code) => win.URL.createObjectURL(new win.Blob([code], { type: "text/javascript" })));
    const addScript = (code, label, extra = {}) => {
      const script = doc.createElement("script");
      for (const attribute of extra.attributes ?? []) script.setAttribute(attribute.name, attribute.value);
      if (extra.module) script.type = "module";
      script.async = !!extra.async;
      const url = scriptUrl(`${code}
//# sourceURL=dd:${encodeURIComponent(label)}`);
      labels.set(url, label);
      if (url.startsWith("blob:")) script.addEventListener("load", () => win.URL.revokeObjectURL(url), { once: true });
      script.src = url;
      (doc.head ?? doc.documentElement).appendChild(script);
    };
    let parsed = false;
    let readied = false;
    const lateReady = [];
    for (const target of [doc, win]) {
      const add = target.addEventListener;
      override(target, "addEventListener", function(type, listener, more) {
        if (type === "DOMContentLoaded" && parsed && listener) {
          lateReady.push({ target, listener });
          if (readied) win.setTimeout(fireReady, 0);
          return;
        }
        add.call(this, type, listener, more);
      });
    }
    const fireReady = () => {
      for (const { target, listener } of lateReady.splice(0)) {
        const event = new win.Event("DOMContentLoaded");
        try {
          if (typeof listener === "function") listener.call(target, event);
          else listener.handleEvent(event);
        } catch (error) {
          win.console?.error?.(error);
        }
      }
    };
    const handlers = [];
    const bound = /* @__PURE__ */ new WeakMap();
    const bindHandlers = (element) => {
      let entries = bound.get(element);
      if (!entries) bound.set(element, entries = {});
      for (const name of Object.keys(entries)) {
        const entry = entries[name];
        if (element.getAttribute(name) === entry.code) continue;
        if (entry.listener) entry.target.removeEventListener(entry.type, entry.listener);
        delete entries[name];
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (!/^on[a-z]+$/.test(name) || entries[name]) continue;
        const type = name.slice(2);
        const entry = {
          element,
          name,
          type,
          code: attribute.value,
          target: element === doc.body && WINDOW_EVENTS.test(type) ? win : element
        };
        entries[name] = entry;
        handlers.push(entry);
        addScript(`window.__ddPage.bind(${handlers.length - 1}, function (event) {
${entry.code}
});`, `${config.path} (${name} on <${element.localName}>)`);
      }
    };
    const bindTree = (node) => {
      if (node.nodeType !== 1) return;
      bindHandlers(node);
      for (const element of node.querySelectorAll("*")) bindHandlers(element);
    };
    const hooks = {
      bind(index, handler) {
        const entry = handlers[index];
        if (!entry || bound.get(entry.element)?.[entry.name] !== entry) return;
        entry.listener = function(event) {
          if (handler.call(entry.target, event) === false) event.preventDefault();
        };
        entry.target.addEventListener(entry.type, entry.listener);
      },
      ready() {
        if (readied) return;
        readied = true;
        fireReady();
        if (!frame) return;
        restoreView();
        paint();
        post({ type: "ready" });
      }
    };
    Object.defineProperty(win, "__ddPage", { value: Object.freeze(hooks) });
    const runBlocks = () => {
      const ordered = [];
      const deferred = [];
      const later = [];
      let inline = 0;
      for (const block of doc.querySelectorAll(SCRIPT_BLOCK)) {
        if (block.hasAttribute("data-dd-missing")) continue;
        const label = block.getAttribute("data-dd-src") ?? `${config.path} (inline script ${inline += 1})`;
        const module = block.getAttribute("data-dd-type") === "module";
        const async = block.hasAttribute("data-dd-async");
        const attributes = [...block.attributes].filter((entry) => entry.name.startsWith("data-") && !entry.name.startsWith("data-dd-"));
        const run = () => addScript(block.textContent ?? "", label, { module, async, attributes });
        if (async) later.push(run);
        else if (module || block.hasAttribute("data-dd-defer")) deferred.push(run);
        else ordered.push(run);
      }
      for (const run of [...ordered, ...deferred]) run();
      addScript("window.__ddPage.ready();", "design doc runtime");
      for (const run of later) run();
    };
    const claims = /* @__PURE__ */ new WeakMap();
    const intercept = (event, action) => {
      const nativePrevent = event.preventDefault;
      let claimed = false;
      let pagePrevented = false;
      const claim = () => {
        if (claimed || event.defaultPrevented) return;
        claimed = true;
        override(event, "preventDefault", () => {
          pagePrevented = true;
          nativePrevent.call(event);
        });
        nativePrevent.call(event);
        win.setTimeout(() => {
          if (!pagePrevented) action();
        }, 0);
      };
      for (const name of ["stopPropagation", "stopImmediatePropagation"]) {
        const stop = event[name];
        override(event, name, () => {
          claim();
          stop.call(event);
        });
      }
      claims.set(event, claim);
    };
    const canOpen = (target) => frame || !files || files.has(target.path) || files.has(`${target.path}/index.html`);
    const linkAction = (event) => {
      if (event.button !== (event.type === "auxclick" ? 1 : 0)) return null;
      const anchor = event.target?.closest?.("a, area");
      const raw = anchor?.getAttribute("href") ?? anchor?.getAttribute("xlink:href");
      if (!anchor || raw === null || raw === void 0) return null;
      const href = raw.trim();
      const newTab = event.type === "auxclick" || event.metaKey || event.ctrlKey || event.shiftKey || opensNewTab(anchor.getAttribute("target")) || anchor.hasAttribute("download");
      if (href.startsWith("#")) return () => navigate({ path: config.path, hash: safeDecode(href.slice(1)) }, { newTab });
      if (!href) return () => navigate({ path: config.path, hash: null }, { newTab });
      const url = absoluteUrl(href);
      if (!url) return null;
      if (url.protocol === "javascript:") {
        return frame ? () => addScript(safeDecode(url.href.slice("javascript:".length)), `${config.path} (javascript: link)`) : null;
      }
      if (url.origin === PAGE_ORIGIN) {
        const target = pageTargetOf(url.href);
        if (!target) return () => report({ kind: "missing", message: `The link to ${href} names no file in this doc`, source: config.path });
        return () => {
          if (canOpen(target)) navigate(target, { newTab });
          else reportMissing(target.path, "A link points to");
        };
      }
      if (frame && OPENABLE.test(url.protocol)) return () => post({ type: "open", url: url.href });
      return null;
    };
    const onActivate = (event) => {
      const action = linkAction(event);
      if (action) intercept(event, action);
    };
    win.addEventListener("click", onActivate, true);
    win.addEventListener("auxclick", onActivate, true);
    const formBlocked = () => report({ kind: "blocked", message: "A form tried to submit; published pages are static, so handle submit in a script", source: config.path });
    win.addEventListener("submit", (event) => intercept(event, formBlocked), true);
    for (const type of ["click", "auxclick", "submit"]) win.addEventListener(type, (event) => claims.get(event)?.());
    win.navigation?.addEventListener("navigate", (raw) => {
      const event = raw;
      if (!event.cancelable || event.hashChange || event.downloadRequest || event.navigationType === "traverse" || event.navigationType === "reload") return;
      const url = absoluteUrl(event.destination?.url ?? "");
      if (!url) return;
      if (url.origin !== PAGE_ORIGIN) {
        if (frame && OPENABLE.test(url.protocol)) {
          event.preventDefault();
          post({ type: "open", url: url.href });
        }
        return;
      }
      event.preventDefault();
      const target = pageTargetOf(url.href);
      if (event.formData) formBlocked();
      else if (!target) report({ kind: "missing", message: `The page tried to open ${url.href}, which names no file in this doc`, source: config.path });
      else if (canOpen(target)) navigate(target, { redirect: event.navigationType === "replace" });
      else reportMissing(target.path, "The page tried to open");
    });
    const imageUrls = /* @__PURE__ */ new Map();
    const fixImage = (image) => {
      const raw = image.getAttribute("src");
      const target = raw ? docTarget(raw) : void 0;
      if (!target) return;
      let url = imageUrls.get(target.path);
      if (!url) {
        url = load(target.path).then((file) => file ? win.URL.createObjectURL(new win.Blob([fileBody(file)], { type: mediaTypeOf(target.path) })) : null);
        imageUrls.set(target.path, url);
      }
      void url.then((blob) => {
        if (!blob) reportMissing(target.path, "An image shows");
        else if (image.getAttribute("src") === raw) image.src = blob;
      });
    };
    const fixImages = (node) => {
      if (node.nodeType !== 1) return;
      if (node.localName === "img") fixImage(node);
      for (const image of node.querySelectorAll("img[src]")) fixImage(image);
    };
    let quotes = config.quotes ?? [];
    const owner = {};
    let anchors = "";
    const root = () => doc.body ?? doc.documentElement;
    function paint() {
      if (!frame) return;
      const ranges = quotes.length ? findQuoteRanges(root(), quotes) : /* @__PURE__ */ new Map();
      paintRanges(COMMENT_HIGHLIGHT, owner, [...ranges.values()]);
      const found = quotes.filter((quote) => ranges.has(quote));
      const missing = quotes.filter((quote) => !ranges.has(quote));
      const key = JSON.stringify([found, missing]);
      if (key === anchors) return;
      anchors = key;
      post({ type: "anchors", found, missing });
    }
    const schedulePaint = throttle(win, PAINT_DELAY_MS, paint);
    const focusQuote = (quote) => {
      const range = findQuoteRanges(root(), [quote]).get(quote);
      if (range) {
        range.startContainer.parentElement?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        paintRanges(FOCUS_HIGHLIGHT, owner, [range]);
        win.setTimeout(() => paintRanges(FOCUS_HIGHLIGHT, owner, []), 1800);
      }
      post({ type: "focused", quote, found: !!range });
    };
    let selected = "";
    const reportSelection = () => {
      const selection = win.getSelection();
      const text = selection && !selection.isCollapsed && selection.rangeCount ? selection.toString().trim().slice(0, MAX_QUOTE_LENGTH) : "";
      if (!text) {
        if (selected) post({ type: "selection", text: "", rect: null });
        selected = "";
        return;
      }
      selected = text;
      const box = selection.getRangeAt(0).getBoundingClientRect();
      post({ type: "selection", text, rect: { top: box.top, left: box.left, bottom: box.bottom, right: box.right } });
    };
    const reportScroll = throttle(win, REPORT_DELAY_MS, () => {
      post({ type: "scroll", x: win.scrollX, y: win.scrollY });
      if (selected) reportSelection();
    });
    function restoreView() {
      const scroll = config.scroll;
      if (scroll) {
        win.scrollTo(scroll.x, scroll.y);
        win.addEventListener("load", () => win.scrollTo(scroll.x, scroll.y), { once: true });
      } else if (config.hash) {
        scrollToFragment(config.hash);
      }
    }
    if (frame) {
      if (config.hash) {
        try {
          win.history.replaceState(win.history.state, "", `${win.location.href.split("#")[0]}#${encodeURI(config.hash)}`);
        } catch {
        }
      }
      const style = doc.createElement("style");
      style.setAttribute("data-dd-runtime", "");
      style.textContent = HIGHLIGHT_CSS;
      (doc.head ?? doc.documentElement).appendChild(style);
      doc.addEventListener("selectionchange", debounce(win, REPORT_DELAY_MS, reportSelection));
      win.addEventListener("scroll", reportScroll, { passive: true });
      const reportHash = () => post({ type: "hash", hash: win.location.hash ? safeDecode(win.location.hash.slice(1)) : null });
      win.addEventListener("hashchange", reportHash);
      win.addEventListener("popstate", reportHash);
      if (port) {
        port.onmessage = (event) => {
          const message = record(event.data);
          if (message?.type === "file") pending.get(message.id)?.(isPageFile(message.file) ? message.file : null);
          else if (message?.type === "highlight" && Array.isArray(message.quotes)) {
            quotes = message.quotes.filter((quote) => typeof quote === "string");
            paint();
          } else if (message?.type === "focus" && typeof message.quote === "string") focusQuote(message.quote);
          else if (message?.type === "clear-selection") win.getSelection()?.removeAllRanges();
        };
      }
    } else {
      for (const path of config.missing ?? []) report({ kind: "missing", message: `The page uses ${path}, which is not a file in this doc`, source: config.path });
    }
    const start = () => {
      parsed = true;
      if (frame) bindTree(doc.documentElement);
      fixImages(doc.documentElement);
      runBlocks();
      const refresh = doc.querySelector('meta[name="dd-refresh"]')?.getAttribute("content")?.match(/^(\d+(?:\.\d+)?);(.+)$/);
      const redirect = refresh ? docTarget(refresh[2]) : void 0;
      if (redirect) win.setTimeout(() => navigate(redirect, { redirect: true }), Number(refresh[1]) * 1e3);
      new win.MutationObserver((records) => {
        let textChanged = false;
        for (const entry of records) {
          if (entry.type === "attributes") {
            const name = entry.attributeName ?? "";
            if (frame && name.startsWith("on")) bindHandlers(entry.target);
            if (name === "src" && entry.target.localName === "img") fixImage(entry.target);
            continue;
          }
          textChanged = true;
          entry.addedNodes.forEach((node) => {
            if (frame) bindTree(node);
            fixImages(node);
          });
        }
        if (textChanged && quotes.length) schedulePaint();
      }).observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    return { config, problems, load };
  }
  var STATE = ["readyState", "status", "statusText", "responseText", "response", "responseURL", "responseXML"];
  function installRequests(win, deps) {
    const Native = win.XMLHttpRequest;
    if (typeof Native !== "function") return;
    const nativeOpen = Native.prototype.open;
    class PageRequest extends Native {
      #doc = null;
      #sync = false;
      open(...args) {
        const [method, url, async] = args;
        const target = deps.docTarget(String(url));
        if (target === void 0) {
          if (this.#doc) for (const name of STATE) delete this[name];
          this.#doc = null;
          nativeOpen.apply(this, args);
          return;
        }
        if (async === false && deps.loadNow(target?.path ?? "") === void 0) {
          deps.report({ kind: "blocked", message: `A synchronous request for ${target?.path ?? String(url)} cannot be answered in previews; make it async`, source: deps.source });
          throw new DOMException("Synchronous requests for doc files are not supported here", "InvalidAccessError");
        }
        this.#doc = { path: target?.path ?? null, method: String(method).toUpperCase(), aborted: false, type: "" };
        this.#set({ readyState: 1, status: 0, statusText: "", responseText: "", response: "", responseURL: "", responseXML: null });
        this.#sync = async === false;
        this.#fire("readystatechange");
      }
      send(body) {
        const request = this.#doc;
        if (!request) {
          super.send(body);
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          deps.report({ kind: "blocked", message: `A ${request.method} request to ${request.path} has nowhere to go: published pages are static`, source: deps.source });
          this.#finish(null, 405);
          return;
        }
        if (!request.path) {
          this.#finish(null, 404);
          return;
        }
        const path = request.path;
        if (this.#sync) {
          this.#finish(deps.loadNow(path) ?? null, void 0, path);
          return;
        }
        void deps.load(path).then((file) => {
          if (!request.aborted) this.#finish(file, void 0, path);
        });
      }
      setRequestHeader(name, value) {
        if (!this.#doc) super.setRequestHeader(name, value);
      }
      overrideMimeType(mime) {
        if (!this.#doc) super.overrideMimeType(mime);
      }
      getResponseHeader(name) {
        if (!this.#doc) return super.getResponseHeader(name);
        return name.toLowerCase() === "content-type" && this.#doc.type ? this.#doc.type : null;
      }
      getAllResponseHeaders() {
        if (!this.#doc) return super.getAllResponseHeaders();
        return this.#doc.type ? `content-type: ${this.#doc.type}\r
` : "";
      }
      abort() {
        if (!this.#doc) {
          super.abort();
          return;
        }
        if (this.#doc.aborted) return;
        this.#doc.aborted = true;
        this.#set({ readyState: 0, status: 0 });
        this.#fire("abort");
        this.#fire("loadend");
      }
      #finish(file, status, path) {
        const request = this.#doc;
        const code = status ?? (file ? 200 : 404);
        if (!file && path) deps.reportMissing(path, "The page requested");
        request.type = file && path ? mediaTypeOf(path) : "";
        const head = request.method === "HEAD";
        const text = head ? "" : file?.encoding === "utf8" ? file.content : file ? "" : code === 404 ? "Not found" : "";
        const bytes = () => file ? fileBody(file) : new Uint8Array(0);
        let response = text;
        if (this.responseType === "json") {
          try {
            response = JSON.parse(text);
          } catch {
            response = null;
          }
        } else if (this.responseType === "arraybuffer") {
          response = file?.encoding === "base64" && !head ? bytes().buffer : new TextEncoder().encode(text).buffer;
        } else if (this.responseType === "blob") {
          response = new win.Blob([file?.encoding === "base64" && !head ? bytes() : text], { type: request.type });
        } else if (this.responseType === "document") {
          response = null;
        }
        const statusText = code === 200 ? "OK" : code === 404 ? "Not Found" : "Method Not Allowed";
        this.#set({ readyState: 4, status: code, statusText, responseText: text, response, responseURL: path ? pageUrl(path) : "" });
        this.#fire("readystatechange");
        const size = text.length || (file && !head ? bytes().length : 0);
        this.#fire("load", size);
        this.#fire("loadend", size);
      }
      #set(values) {
        for (const [name, value] of Object.entries(values)) Object.defineProperty(this, name, { configurable: true, get: () => value });
      }
      #fire(type, size = 0) {
        const event = type === "readystatechange" || typeof win.ProgressEvent !== "function" ? new win.Event(type) : new win.ProgressEvent(type, { lengthComputable: size > 0, loaded: size, total: size });
        this.dispatchEvent(event);
      }
    }
    win.XMLHttpRequest = PageRequest;
  }

  // src/runtime/entry.ts
  if (!("__ddPage" in window)) startPageRuntime(window);
  document.currentScript?.remove();
})();
