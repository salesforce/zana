// zcc-host-react:react
var React = globalThis.__ZCC_HOST_REACT__;
var Children = React.Children;
var Component = React.Component;
var Fragment = React.Fragment;
var StrictMode = React.StrictMode;
var Suspense = React.Suspense;
var cloneElement = React.cloneElement;
var createContext = React.createContext;
var createElement = React.createElement;
var createRef = React.createRef;
var forwardRef = React.forwardRef;
var isValidElement = React.isValidElement;
var lazy = React.lazy;
var memo = React.memo;
var startTransition = React.startTransition;
var useCallback = React.useCallback;
var useContext = React.useContext;
var useDebugValue = React.useDebugValue;
var useDeferredValue = React.useDeferredValue;
var useEffect = React.useEffect;
var useId = React.useId;
var useImperativeHandle = React.useImperativeHandle;
var useInsertionEffect = React.useInsertionEffect;
var useLayoutEffect = React.useLayoutEffect;
var useMemo = React.useMemo;
var useReducer = React.useReducer;
var useRef = React.useRef;
var useState = React.useState;
var useSyncExternalStore = React.useSyncExternalStore;
var useTransition = React.useTransition;
var version = React.version;

// ../../packages/plugin-sdk/src/app.ts
function pluginHost() {
  const host = globalThis.__ZCC_PLUGIN_HOST__;
  if (!host) throw new Error("plugin host is not available");
  return host;
}
async function callPluginRpc(pluginId, method, args) {
  return pluginHost().callRpc(pluginId, method, args);
}
function definePluginApp(setup) {
  return { __zccPluginApp: true, setup };
}

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
var toCamelCase = (string) => string.replace(
  /^([A-Z])|[\s-_]+(\w)/g,
  (match, p1, p2) => p2 ? p2.toUpperCase() : p1.toLowerCase()
);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs
var toPascalCase = (string) => {
  const camelCase = toCamelCase(string);
  return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
};

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/defaultAttributes.mjs
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
var hasA11yProp = (props) => {
  for (const prop in props) {
    if (prop.startsWith("aria-") || prop === "role" || prop === "title") {
      return true;
    }
  }
  return false;
};

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/context.mjs
var LucideContext = createContext({});
var useLucideContext = () => useContext(LucideContext);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/Icon.mjs
var Icon = forwardRef(
  ({ color, size, strokeWidth, absoluteStrokeWidth, className = "", children, iconNode, ...rest }, ref) => {
    const {
      size: contextSize = 24,
      strokeWidth: contextStrokeWidth = 2,
      absoluteStrokeWidth: contextAbsoluteStrokeWidth = false,
      color: contextColor = "currentColor",
      className: contextClass = ""
    } = useLucideContext() ?? {};
    const calculatedStrokeWidth = absoluteStrokeWidth ?? contextAbsoluteStrokeWidth ? Number(strokeWidth ?? contextStrokeWidth) * 24 / Number(size ?? contextSize) : strokeWidth ?? contextStrokeWidth;
    return createElement(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size ?? contextSize ?? defaultAttributes.width,
        height: size ?? contextSize ?? defaultAttributes.height,
        stroke: color ?? contextColor,
        strokeWidth: calculatedStrokeWidth,
        className: mergeClasses("lucide", contextClass, className),
        ...!children && !hasA11yProp(rest) && { "aria-hidden": "true" },
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/createLucideIcon.mjs
var createLucideIcon = (iconName, iconNode) => {
  const Component2 = forwardRef(
    ({ className, ...props }, ref) => createElement(Icon, {
      ref,
      iconNode,
      className: mergeClasses(
        `lucide-${toKebabCase(toPascalCase(iconName))}`,
        `lucide-${iconName}`,
        className
      ),
      ...props
    })
  );
  Component2.displayName = toPascalCase(iconName);
  return Component2;
};

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/arrow-down.mjs
var __iconNode = [
  ["path", { d: "M12 5v14", key: "s699le" }],
  ["path", { d: "m19 12-7 7-7-7", key: "1idqje" }]
];
var ArrowDown = createLucideIcon("arrow-down", __iconNode);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/arrow-left.mjs
var __iconNode2 = [
  ["path", { d: "m12 19-7-7 7-7", key: "1l729n" }],
  ["path", { d: "M19 12H5", key: "x3x0zl" }]
];
var ArrowLeft = createLucideIcon("arrow-left", __iconNode2);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/arrow-up.mjs
var __iconNode3 = [
  ["path", { d: "m5 12 7-7 7 7", key: "hav0vg" }],
  ["path", { d: "M12 19V5", key: "x0mq9r" }]
];
var ArrowUp = createLucideIcon("arrow-up", __iconNode3);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/bell-off.mjs
var __iconNode4 = [
  ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0", key: "vwvbt9" }],
  [
    "path",
    {
      d: "M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742",
      key: "178tsu"
    }
  ],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }],
  ["path", { d: "M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05", key: "1hqiys" }]
];
var BellOff = createLucideIcon("bell-off", __iconNode4);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/bell.mjs
var __iconNode5 = [
  ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0", key: "vwvbt9" }],
  [
    "path",
    {
      d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
      key: "11g9vi"
    }
  ]
];
var Bell = createLucideIcon("bell", __iconNode5);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/book-marked.mjs
var __iconNode6 = [
  ["path", { d: "M10 2v8l3-3 3 3V2", key: "sqw3rj" }],
  [
    "path",
    {
      d: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20",
      key: "k3hazp"
    }
  ]
];
var BookMarked = createLucideIcon("book-marked", __iconNode6);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/building-2.mjs
var __iconNode7 = [
  ["path", { d: "M10 12h4", key: "a56b0p" }],
  ["path", { d: "M10 8h4", key: "1sr2af" }],
  ["path", { d: "M14 21v-3a2 2 0 0 0-4 0v3", key: "1rgiei" }],
  [
    "path",
    {
      d: "M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2",
      key: "secmi2"
    }
  ],
  ["path", { d: "M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16", key: "16ra0t" }]
];
var Building2 = createLucideIcon("building-2", __iconNode7);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/check.mjs
var __iconNode8 = [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]];
var Check = createLucideIcon("check", __iconNode8);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/chevron-down.mjs
var __iconNode9 = [["path", { d: "m6 9 6 6 6-6", key: "qrunsl" }]];
var ChevronDown = createLucideIcon("chevron-down", __iconNode9);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/chevron-right.mjs
var __iconNode10 = [["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]];
var ChevronRight = createLucideIcon("chevron-right", __iconNode10);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/circle-alert.mjs
var __iconNode11 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "12", x2: "12", y1: "8", y2: "12", key: "1pkeuh" }],
  ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16", key: "4dfq90" }]
];
var CircleAlert = createLucideIcon("circle-alert", __iconNode11);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/circle-check.mjs
var __iconNode12 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
];
var CircleCheck = createLucideIcon("circle-check", __iconNode12);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/circle-dashed.mjs
var __iconNode13 = [
  ["path", { d: "M10.1 2.182a10 10 0 0 1 3.8 0", key: "5ilxe3" }],
  ["path", { d: "M13.9 21.818a10 10 0 0 1-3.8 0", key: "11zvb9" }],
  ["path", { d: "M17.609 3.721a10 10 0 0 1 2.69 2.7", key: "1iw5b2" }],
  ["path", { d: "M2.182 13.9a10 10 0 0 1 0-3.8", key: "c0bmvh" }],
  ["path", { d: "M20.279 17.609a10 10 0 0 1-2.7 2.69", key: "1ruxm7" }],
  ["path", { d: "M21.818 10.1a10 10 0 0 1 0 3.8", key: "qkgqxc" }],
  ["path", { d: "M3.721 6.391a10 10 0 0 1 2.7-2.69", key: "1mcia2" }],
  ["path", { d: "M6.391 20.279a10 10 0 0 1-2.69-2.7", key: "1fvljs" }]
];
var CircleDashed = createLucideIcon("circle-dashed", __iconNode13);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/circle-question-mark.mjs
var __iconNode14 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", key: "1u773s" }],
  ["path", { d: "M12 17h.01", key: "p32p05" }]
];
var CircleQuestionMark = createLucideIcon("circle-question-mark", __iconNode14);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/circle-x.mjs
var __iconNode15 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "m15 9-6 6", key: "1uzhvr" }],
  ["path", { d: "m9 9 6 6", key: "z0biqf" }]
];
var CircleX = createLucideIcon("circle-x", __iconNode15);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/clock.mjs
var __iconNode16 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 6v6l4 2", key: "mmk7yg" }]
];
var Clock = createLucideIcon("clock", __iconNode16);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/cloud-off.mjs
var __iconNode17 = [
  ["path", { d: "M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057", key: "1uxyv8" }],
  ["path", { d: "M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78", key: "99tcn7" }],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }]
];
var CloudOff = createLucideIcon("cloud-off", __iconNode17);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/columns-3.mjs
var __iconNode18 = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }],
  ["path", { d: "M15 3v18", key: "14nvp0" }]
];
var Columns3 = createLucideIcon("columns-3", __iconNode18);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/download.mjs
var __iconNode19 = [
  ["path", { d: "M12 15V3", key: "m9g1x1" }],
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["path", { d: "m7 10 5 5 5-5", key: "brsn70" }]
];
var Download = createLucideIcon("download", __iconNode19);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/external-link.mjs
var __iconNode20 = [
  ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
  ["path", { d: "M10 14 21 3", key: "gplh6r" }],
  ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", key: "a6xqqp" }]
];
var ExternalLink = createLucideIcon("external-link", __iconNode20);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/eye-off.mjs
var __iconNode21 = [
  [
    "path",
    {
      d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      key: "ct8e1f"
    }
  ],
  ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242", key: "151rxh" }],
  [
    "path",
    {
      d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      key: "13bj9a"
    }
  ],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }]
];
var EyeOff = createLucideIcon("eye-off", __iconNode21);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/eye.mjs
var __iconNode22 = [
  [
    "path",
    {
      d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
      key: "1nclc0"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
];
var Eye = createLucideIcon("eye", __iconNode22);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/folder-git-2.mjs
var __iconNode23 = [
  ["path", { d: "M18 19a5 5 0 0 1-5-5v8", key: "sz5oeg" }],
  [
    "path",
    {
      d: "M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5",
      key: "1w6njk"
    }
  ],
  ["circle", { cx: "13", cy: "12", r: "2", key: "1j92g6" }],
  ["circle", { cx: "20", cy: "19", r: "2", key: "1obnsp" }]
];
var FolderGit2 = createLucideIcon("folder-git-2", __iconNode23);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/folder-search.mjs
var __iconNode24 = [
  [
    "path",
    {
      d: "M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1",
      key: "1bw5m7"
    }
  ],
  ["path", { d: "m21 21-1.9-1.9", key: "1g2n9r" }],
  ["circle", { cx: "17", cy: "17", r: "3", key: "18b49y" }]
];
var FolderSearch = createLucideIcon("folder-search", __iconNode24);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/git-branch.mjs
var __iconNode25 = [
  ["path", { d: "M15 6a9 9 0 0 0-9 9V3", key: "1cii5b" }],
  ["circle", { cx: "18", cy: "6", r: "3", key: "1h7g24" }],
  ["circle", { cx: "6", cy: "18", r: "3", key: "fqmcym" }]
];
var GitBranch = createLucideIcon("git-branch", __iconNode25);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/git-merge.mjs
var __iconNode26 = [
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M6 21V9a9 9 0 0 0 9 9", key: "7kw0sc" }]
];
var GitMerge = createLucideIcon("git-merge", __iconNode26);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/git-pull-request-closed.mjs
var __iconNode27 = [
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M6 9v12", key: "1sc30k" }],
  ["path", { d: "m21 3-6 6", key: "16nqsk" }],
  ["path", { d: "m21 9-6-6", key: "9j17rh" }],
  ["path", { d: "M18 11.5V15", key: "65xf6f" }],
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }]
];
var GitPullRequestClosed = createLucideIcon("git-pull-request-closed", __iconNode27);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/git-pull-request-draft.mjs
var __iconNode28 = [
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M18 6V5", key: "1oao2s" }],
  ["path", { d: "M18 11v-1", key: "11c8tz" }],
  ["line", { x1: "6", x2: "6", y1: "9", y2: "21", key: "rroup" }]
];
var GitPullRequestDraft = createLucideIcon("git-pull-request-draft", __iconNode28);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/git-pull-request.mjs
var __iconNode29 = [
  ["circle", { cx: "18", cy: "18", r: "3", key: "1xkwt0" }],
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M13 6h3a2 2 0 0 1 2 2v7", key: "1yeb86" }],
  ["line", { x1: "6", x2: "6", y1: "9", y2: "21", key: "rroup" }]
];
var GitPullRequest = createLucideIcon("git-pull-request", __iconNode29);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/globe.mjs
var __iconNode30 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", key: "13o1zl" }],
  ["path", { d: "M2 12h20", key: "9i4pu4" }]
];
var Globe = createLucideIcon("globe", __iconNode30);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/layout-list.mjs
var __iconNode31 = [
  ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1", key: "1g98yp" }],
  ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1", key: "1bb6yr" }],
  ["path", { d: "M14 4h7", key: "3xa0d5" }],
  ["path", { d: "M14 9h7", key: "1icrd9" }],
  ["path", { d: "M14 15h7", key: "1mj8o2" }],
  ["path", { d: "M14 20h7", key: "11slyb" }]
];
var LayoutList = createLucideIcon("layout-list", __iconNode31);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/link-2.mjs
var __iconNode32 = [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2", key: "8i5ue5" }],
  ["path", { d: "M15 7h2a5 5 0 1 1 0 10h-2", key: "1b9ql8" }],
  ["line", { x1: "8", x2: "16", y1: "12", y2: "12", key: "1jonct" }]
];
var Link2 = createLucideIcon("link-2", __iconNode32);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/loader-circle.mjs
var __iconNode33 = [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56", key: "13zald" }]];
var LoaderCircle = createLucideIcon("loader-circle", __iconNode33);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/mail-open.mjs
var __iconNode34 = [
  [
    "path",
    {
      d: "M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",
      key: "1jhwl8"
    }
  ],
  ["path", { d: "m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10", key: "1qfld7" }]
];
var MailOpen = createLucideIcon("mail-open", __iconNode34);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/mail.mjs
var __iconNode35 = [
  ["path", { d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7", key: "132q7q" }],
  ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "2", key: "izxlao" }]
];
var Mail = createLucideIcon("mail", __iconNode35);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/panel-left-close.mjs
var __iconNode36 = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M9 3v18", key: "fh3hqa" }],
  ["path", { d: "m16 15-3-3 3-3", key: "14y99z" }]
];
var PanelLeftClose = createLucideIcon("panel-left-close", __iconNode36);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/pen.mjs
var __iconNode37 = [
  [
    "path",
    {
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      key: "1a8usu"
    }
  ]
];
var Pen = createLucideIcon("pen", __iconNode37);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/plus.mjs
var __iconNode38 = [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
];
var Plus = createLucideIcon("plus", __iconNode38);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/refresh-cw.mjs
var __iconNode39 = [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
];
var RefreshCw = createLucideIcon("refresh-cw", __iconNode39);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/search.mjs
var __iconNode40 = [
  ["path", { d: "m21 21-4.34-4.34", key: "14j7rj" }],
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }]
];
var Search = createLucideIcon("search", __iconNode40);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/settings.mjs
var __iconNode41 = [
  [
    "path",
    {
      d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
      key: "1i5ecw"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
];
var Settings = createLucideIcon("settings", __iconNode41);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/shield-alert.mjs
var __iconNode42 = [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "M12 8v4", key: "1got3b" }],
  ["path", { d: "M12 16h.01", key: "1drbdi" }]
];
var ShieldAlert = createLucideIcon("shield-alert", __iconNode42);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/sparkles.mjs
var __iconNode43 = [
  [
    "path",
    {
      d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
      key: "1s2grr"
    }
  ],
  ["path", { d: "M20 2v4", key: "1rf3ol" }],
  ["path", { d: "M22 4h-4", key: "gwowj6" }],
  ["circle", { cx: "4", cy: "20", r: "2", key: "6kqj1y" }]
];
var Sparkles = createLucideIcon("sparkles", __iconNode43);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/square-check-big.mjs
var __iconNode44 = [
  [
    "path",
    { d: "M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344", key: "2acyp4" }
  ],
  ["path", { d: "m9 11 3 3L22 4", key: "1pflzl" }]
];
var SquareCheckBig = createLucideIcon("square-check-big", __iconNode44);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/star.mjs
var __iconNode45 = [
  [
    "path",
    {
      d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
      key: "r04s7s"
    }
  ]
];
var Star = createLucideIcon("star", __iconNode45);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/trash-2.mjs
var __iconNode46 = [
  ["path", { d: "M10 11v6", key: "nco0om" }],
  ["path", { d: "M14 11v6", key: "outv1u" }],
  ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", key: "miytrc" }],
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", key: "e791ji" }]
];
var Trash2 = createLucideIcon("trash-2", __iconNode46);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/triangle-alert.mjs
var __iconNode47 = [
  [
    "path",
    {
      d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      key: "wmoenq"
    }
  ],
  ["path", { d: "M12 9v4", key: "juzpu7" }],
  ["path", { d: "M12 17h.01", key: "p32p05" }]
];
var TriangleAlert = createLucideIcon("triangle-alert", __iconNode47);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/users.mjs
var __iconNode48 = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["path", { d: "M16 3.128a4 4 0 0 1 0 7.744", key: "16gr8j" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }]
];
var Users = createLucideIcon("users", __iconNode48);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/wifi-off.mjs
var __iconNode49 = [
  ["path", { d: "M12 20h.01", key: "zekei9" }],
  ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0", key: "1bycff" }],
  ["path", { d: "M5 12.859a10 10 0 0 1 5.17-2.69", key: "1dl1wf" }],
  ["path", { d: "M19 12.859a10 10 0 0 0-2.007-1.523", key: "4k23kn" }],
  ["path", { d: "M2 8.82a15 15 0 0 1 4.177-2.643", key: "1grhjp" }],
  ["path", { d: "M22 8.82a15 15 0 0 0-11.288-3.764", key: "z3jwby" }],
  ["path", { d: "m2 2 20 20", key: "1ooewy" }]
];
var WifiOff = createLucideIcon("wifi-off", __iconNode49);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/wifi.mjs
var __iconNode50 = [
  ["path", { d: "M12 20h.01", key: "zekei9" }],
  ["path", { d: "M2 8.82a15 15 0 0 1 20 0", key: "dnpr2z" }],
  ["path", { d: "M5 12.859a10 10 0 0 1 14 0", key: "1x1e6c" }],
  ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0", key: "1bycff" }]
];
var Wifi = createLucideIcon("wifi", __iconNode50);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/wrench.mjs
var __iconNode51 = [
  [
    "path",
    {
      d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
      key: "1ngwbx"
    }
  ]
];
var Wrench = createLucideIcon("wrench", __iconNode51);

// ../../node_modules/.pnpm/lucide-react@1.31.0_react@19.2.8/node_modules/lucide-react/dist/esm/icons/x.mjs
var __iconNode52 = [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
];
var X = createLucideIcon("x", __iconNode52);

// lib/types.ts
var TIS_PRESETS = {
  fast: { id: "fast", label: "Fast", warnHours: 1, dangerHours: 2 },
  standard: { id: "standard", label: "Standard", warnHours: 4, dangerHours: 6 },
  "long-running": { id: "long-running", label: "Long-running", warnHours: 12, dangerHours: 24 }
};
var DEFAULT_TIS_PRESET = "standard";
var REVIEW_TIS_PRESETS = {
  fast: { id: "fast", label: "Fast", warnDays: 1, dangerDays: 2 },
  standard: { id: "standard", label: "Standard", warnDays: 3, dangerDays: 5 },
  "long-running": { id: "long-running", label: "Long-running", warnDays: 7, dangerDays: 14 }
};
var DEFAULT_REVIEW_TIS_PRESET = "standard";
function repoBuildPresetId(rec) {
  const id = rec?.buildTisPreset ?? rec?.tisPreset;
  return id && id in TIS_PRESETS ? id : DEFAULT_TIS_PRESET;
}
function findRepo(repoFullName, repositories) {
  const key = (repoFullName ?? "").toLowerCase();
  return key ? (repositories ?? []).find((r) => `${r.owner}/${r.repo}`.toLowerCase() === key) : void 0;
}
function resolveBuildThresholds(repoFullName, repositories, globalWarnHours, globalDangerHours) {
  const rec = findRepo(repoFullName, repositories);
  if (rec) {
    const preset = TIS_PRESETS[repoBuildPresetId(rec)];
    return { warnHours: preset.warnHours, dangerHours: preset.dangerHours };
  }
  return { warnHours: globalWarnHours, dangerHours: globalDangerHours };
}
function resolveReviewThresholds(repoFullName, repositories, globalWarnDays, globalDangerDays) {
  const rec = findRepo(repoFullName, repositories);
  if (rec) {
    const id = rec.reviewTisPreset && rec.reviewTisPreset in REVIEW_TIS_PRESETS ? rec.reviewTisPreset : DEFAULT_REVIEW_TIS_PRESET;
    const preset = REVIEW_TIS_PRESETS[id];
    return { warnDays: preset.warnDays, dangerDays: preset.dangerDays };
  }
  return { warnDays: globalWarnDays, dangerDays: globalDangerDays };
}
var EMPTY_SYNC_HEALTH = {
  disconnectedHosts: [],
  outageHosts: [],
  remoteGone: [],
  keptGone: []
};
var DEFAULT_SETTINGS_NAV = "organizations";
var DEFAULT_PR_MONITOR_SETTINGS = {
  pollIntervalMinutes: 15,
  notifyOnChange: true,
  badgeMode: "total",
  watchedRepos: [],
  watchedPeople: [],
  relevanceModes: {
    authored: true,
    reviewRequested: true,
    involved: true
  },
  autoDiscover: false,
  discoverHosts: void 0,
  tisWarnHours: 4,
  tisDangerHours: 6,
  reviewWarnDays: 3,
  reviewDangerDays: 5,
  gusLocatorBaseUrl: void 0,
  settingsActiveNav: DEFAULT_SETTINGS_NAV,
  organizations: [],
  repositories: [],
  orgDiscovered: false,
  authorDiscovered: false,
  notifyInApp: true,
  sendToInbox: false,
  autoSyncEnabled: true
};
var MONITORED_COUNT_CACHE_KEY = "monitoredCount";
var MONITORED_PRS_CACHE_KEY = "monitoredPrs";
var SETTINGS_STORAGE_KEY = "settings";
var PREFETCH_ORGS_CACHE_KEY = "prefetch:orgs";
var PREFETCH_REPOS_CACHE_KEY = "prefetch:repos";
var PREFETCH_AUTHOR_CACHE_KEY = "prefetch:author";
var GITHUB_PR_URL_RE = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;
function hostOf(url) {
  const m = GITHUB_PR_URL_RE.exec(url);
  if (!m) {
    throw new Error(`Not a GitHub PR URL: ${url}`);
  }
  return m[1];
}
var STATUS_PRIORITY = {
  failed: 7,
  conflict: 6,
  yellow: 5,
  "review-required": 4,
  pending: 3,
  integrating: 2,
  green: 1,
  "closed-abandoned": 0,
  "closed-merged": 0
};
function statusPriority(status) {
  return STATUS_PRIORITY[status];
}
var TRIAGE_SEVERITY_RANK = {
  conflict: 1,
  failed: 2,
  yellow: 3,
  "review-required": 4,
  pending: 5,
  integrating: 6,
  green: 7,
  "closed-merged": 8,
  "closed-abandoned": 9
};
function triageSeverityRank(status) {
  return TRIAGE_SEVERITY_RANK[status];
}
var WORK_ITEM_RE = /\bW-\d{8}\b/i;
function extractWorkItem(title, branch, body) {
  for (const source of [title, branch, body]) {
    if (typeof source !== "string" || !source) continue;
    const m = WORK_ITEM_RE.exec(source);
    if (m) return m[0].toUpperCase();
  }
  return void 0;
}
function buildWorkItemLink(id, locatorBase) {
  if (!id || !locatorBase) return null;
  if (!/^W-\d{8}$/i.test(id)) return null;
  let base;
  try {
    base = new URL(locatorBase);
  } catch {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return null;
  const trimmed = locatorBase.replace(/\/+$/, "");
  return `${trimmed}/${encodeURIComponent(id.toUpperCase())}`;
}

// zcc-host-react:react/jsx-runtime
var React2 = globalThis.__ZCC_HOST_REACT__;
var Fragment2 = React2.Fragment;
function jsx(type, props, key) {
  return React2.createElement(type, key === void 0 ? props : { ...props, key });
}
var jsxs = jsx;

// src/app/SetupGate.tsx
function SetupGate({ onSave }) {
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await onSave({ ...DEFAULT_PR_MONITOR_SETTINGS });
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ jsx("div", { className: "prm-setup-gate", children: /* @__PURE__ */ jsxs("div", { className: "prm-setup", children: [
    /* @__PURE__ */ jsx(GitPullRequest, { size: 32, "aria-hidden": true }),
    /* @__PURE__ */ jsx("h3", { children: "Set up PR Monitor" }),
    /* @__PURE__ */ jsx("p", { children: "Track the pull requests you care about \u2014 in the global sidebar and on each project's PRs tab. Add PRs by URL, or turn on auto-discovery in Settings to surface the ones you author, review, or are mentioned in." }),
    /* @__PURE__ */ jsx("div", { className: "prm-empty-actions", children: /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "prm-btn prm-btn--primary",
        onClick: () => void submit(),
        disabled: saving,
        children: saving ? "Saving\u2026" : "Get started"
      }
    ) })
  ] }) });
}

// src/app/formatHelpers.ts
function formatRelative(epochMs) {
  const now = Date.now();
  const delta = Math.max(0, now - epochMs);
  const s = Math.floor(delta / 1e3);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
var STATUS_LABELS = {
  pending: "Pending",
  failed: "Failing",
  conflict: "Merge conflict",
  yellow: "Merge blocked",
  "review-required": "Review required",
  integrating: "Merging",
  green: "All checks passing",
  "closed-merged": "Merged",
  "closed-abandoned": "Closed"
};
function statusLabel(s) {
  return STATUS_LABELS[s];
}
function shortHost(host) {
  return host.endsWith(".salesforce.com") ? host.slice(0, -".salesforce.com".length) : host;
}
function summarizeChecks(checks) {
  let pass = 0;
  let fail = 0;
  let pending = 0;
  for (const c of checks) {
    const s = c.state.toUpperCase();
    if (s === "SUCCESS" || s === "PASS" || s === "PASSED") pass++;
    else if (s === "FAILURE" || s === "FAILED" || s === "ERROR" || s === "CANCELLED") fail++;
    else pending++;
  }
  return { pass, fail, pending };
}
var CHECK_STATE_CLASS = {
  SUCCESS: "pass",
  PASS: "pass",
  PASSED: "pass",
  FAILURE: "fail",
  FAILED: "fail",
  ERROR: "fail",
  CANCELLED: "fail"
};
function checkStateClass(state) {
  return CHECK_STATE_CLASS[state.toUpperCase()] ?? "pending";
}
function statusPill(status) {
  return {
    label: statusLabel(status),
    className: `prm-status-pill--${status}`
  };
}
var DEFAULT_TIS_WARN_HOURS = 4;
var DEFAULT_TIS_DANGER_HOURS = 6;
var DEFAULT_REVIEW_TIS_WARN_DAYS = 3;
var DEFAULT_REVIEW_TIS_DANGER_DAYS = 5;
function formatTimeInStatus(since) {
  if (!since) return "";
  const delta = Math.max(0, Date.now() - since);
  const m = Math.floor(delta / (1e3 * 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
function tisLabel(level, gate) {
  const noun = gate === "build" ? "Build" : "Review";
  if (level === "danger") return `${noun} stalled`;
  if (level === "warn") return `${noun} slow`;
  return "";
}
function initialsOf(who) {
  const src = who.name || who.login;
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

// lib/pillState.ts
var FAIL = /* @__PURE__ */ new Set(["fail", "failure"]);
var RUNNING = /* @__PURE__ */ new Set(["pending", "in_progress", "queued"]);
function normalize(s) {
  return (s ?? "").toLowerCase().trim() || "pending";
}
function isIgnoredFailingCheck(name, ignored) {
  if (!ignored || ignored.length === 0) return false;
  const n = (name ?? "").toLowerCase();
  return ignored.some((entry) => {
    const e = (entry ?? "").toLowerCase();
    return e.length > 0 && n.includes(e);
  });
}
function isBuildHappy(checks, opts = {}) {
  if (!checks || checks.length === 0) return false;
  const ignored = opts.ignoredFailingChecks;
  for (const c of checks) {
    const st = normalize(c.bucket || c.state);
    if (RUNNING.has(st)) return false;
    if (FAIL.has(st) && !isIgnoredFailingCheck(c.name, ignored)) return false;
  }
  return true;
}
function buildStallState(input) {
  const { status, buildHappy, reviewApproved, sfciGated, hasSfciJob, elapsedHours, warnHours, dangerHours } = input;
  if (status === "integrating" || status === "closed-merged" || status === "closed-abandoned") {
    return "done";
  }
  const gatedBlocked = sfciGated && !hasSfciJob;
  const inMergeStep = buildHappy && reviewApproved && status === "yellow";
  if (inMergeStep) {
    if (gatedBlocked) return "blocked";
    if (elapsedHours >= dangerHours) return "merge-stall";
    if (elapsedHours >= warnHours) return "warn";
    return "ok";
  }
  if (buildHappy) return "done";
  if (gatedBlocked) return "blocked";
  if (elapsedHours >= dangerHours) return "danger";
  if (elapsedHours >= warnHours) return "warn";
  return "ok";
}
function reviewState(input) {
  const { reviewApproved, merged, elapsedDays, warnDays, dangerDays } = input;
  if (reviewApproved && !merged) return "done";
  if (elapsedDays >= dangerDays) return "danger";
  if (elapsedDays >= warnDays) return "warn";
  return "ok";
}

// src/app/clipboard.ts
function copyViaTextarea(text) {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.setAttribute("readonly", "");
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
  }
  return copyViaTextarea(text);
}

// src/app/portal.ts
var REACT_PORTAL_TYPE = Symbol.for("react.portal");
function portal(children, container) {
  return {
    $$typeof: REACT_PORTAL_TYPE,
    key: null,
    children,
    containerInfo: container,
    implementation: null
  };
}

// src/app/PrProjectControl.tsx
var MENU_GAP = 4;
var VIEWPORT_GUTTER = 8;
var MENU_MIN_HEIGHT = 120;
var MENU_MAX_HEIGHT = 320;
var MENU_MAX_WIDTH = 280;
function positionProjectPicker(rect, viewport) {
  const below = viewport.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_GUTTER;
  const above = rect.top - MENU_GAP - VIEWPORT_GUTTER;
  const openAbove = below < MENU_MIN_HEIGHT && above > below;
  const maxHeight = Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, openAbove ? above : below));
  const left = Math.max(VIEWPORT_GUTTER, Math.min(rect.left, viewport.innerWidth - MENU_MAX_WIDTH - VIEWPORT_GUTTER));
  return openAbove ? { left, bottom: viewport.innerHeight - rect.top + MENU_GAP, maxHeight } : { left, top: rect.bottom + MENU_GAP, maxHeight };
}
function PrProjectControl({ projectId, projects, onAssign }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const assigned = projects.find((p) => p.id === projectId);
  const associated = Boolean(assigned);
  useEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    setPos(positionProjectPicker(el.getBoundingClientRect(), window));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const title = associated ? `Associated with ${assigned.name} \u2014 change or clear the Project` : "Not associated with a project \u2014 inbox notifications disabled. Click to associate a Project.";
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        ref: anchorRef,
        type: "button",
        className: `prm-project-row ${associated ? "prm-project-row--associated" : "prm-project-row--unassociated"}`,
        title,
        "aria-label": title,
        onClick: (e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        },
        children: [
          /* @__PURE__ */ jsx(FolderGit2, { size: 11, className: "prm-project-row-icon", "aria-hidden": true }),
          /* @__PURE__ */ jsx("span", { className: "prm-project-row-name", children: associated ? assigned.name : "Not associated with a project" })
        ]
      }
    ),
    open && pos && typeof document !== "undefined" && portal(
      /* @__PURE__ */ jsxs(Fragment2, { children: [
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "prm-project-menu-backdrop",
            onMouseDown: (e) => {
              e.stopPropagation();
              setOpen(false);
            }
          }
        ),
        /* @__PURE__ */ jsxs(
          "div",
          {
            className: "prm-tile-menu prm-project-picker",
            style: { position: "fixed", ...pos },
            role: "menu",
            children: [
              projects.length === 0 && /* @__PURE__ */ jsx("div", { className: "prm-project-menu-empty", children: "No projects" }),
              associated && /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: "prm-project-menu-item",
                  role: "menuitem",
                  onClick: (e) => {
                    e.stopPropagation();
                    onAssign(null);
                    setOpen(false);
                  },
                  children: "Clear association"
                }
              ),
              projects.map((p) => /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: `prm-project-menu-item ${p.id === projectId ? "is-active" : ""}`,
                  role: "menuitem",
                  onClick: (e) => {
                    e.stopPropagation();
                    onAssign(p.id);
                    setOpen(false);
                  },
                  children: p.name
                },
                p.id
              ))
            ]
          }
        )
      ] }),
      document.body
    )
  ] });
}

// src/app/PrChecksCollapse.tsx
function PrChecksCollapse({ checks }) {
  if (checks.length === 0) {
    return /* @__PURE__ */ jsx("div", { className: "prm-checks-empty", children: "No check runs reported." });
  }
  return /* @__PURE__ */ jsx("ul", { className: "prm-checks-list", role: "list", children: checks.map((c) => {
    const cls = checkStateClass(c.state);
    return /* @__PURE__ */ jsxs("li", { className: "prm-check-row", children: [
      /* @__PURE__ */ jsx("span", { className: `prm-check-state-pip prm-check-state-pip--${cls}`, "aria-hidden": true }),
      /* @__PURE__ */ jsx("span", { className: "prm-check-name", children: c.name }),
      c.bucket && /* @__PURE__ */ jsx("span", { className: "prm-check-bucket", children: c.bucket }),
      /* @__PURE__ */ jsx("span", { className: "prm-check-state", title: c.state, children: c.state.toLowerCase() })
    ] }, `${c.bucket ?? ""}/${c.name}`);
  }) });
}

// src/app/PrTile.tsx
function isSafeExternalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
var REVIEWER_GROUPS = [
  { state: "changes-requested", label: "Changes requested", className: "prm-reviewers--changes" },
  { state: "review-requested", label: "Review requested", className: "prm-reviewers--requested" },
  { state: "approved", label: "Approved", className: "prm-reviewers--approved" }
];
var ROW_ACTIONS = ["seen", "favorite", "mute", "dismiss"];
function PrTile({
  pr,
  host,
  projects,
  tisWarnHours,
  tisDangerHours,
  reviewWarnDays,
  reviewDangerDays,
  sfciGated = false,
  ignoredFailingChecks,
  workItemLocatorBase,
  selected,
  onToggleSelect,
  onDismiss,
  onProjectAssign
}) {
  const [checksOpen, setChecksOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const hasUnseenChanges = pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
  const workItem = pr.workItem ?? extractWorkItem(pr.title, pr.headRefName, pr.body);
  const workItemLink = buildWorkItemLink(workItem, workItemLocatorBase);
  const pill = statusPill(pr.status);
  const closed = pr.status === "closed-merged" || pr.status === "closed-abandoned";
  const muted = Boolean(pr.muted);
  const favorite = Boolean(pr.favorite);
  const hasSyncError = Boolean(pr.syncError);
  const checks = pr.checks ?? [];
  const checkCounts = summarizeChecks(checks);
  const reviewApproved = pr.reviewDecision === "APPROVED";
  const buildHappy = pr.buildHappy ?? isBuildHappy(checks, { ignoredFailingChecks });
  const build = buildStallState({
    status: pr.status,
    buildHappy,
    reviewApproved,
    sfciGated,
    hasSfciJob: Boolean(pr.hasSfciJob),
    elapsedHours: pr.lastStatusChange ? Math.max(0, Date.now() - pr.lastStatusChange) / 36e5 : 0,
    warnHours: tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
    dangerHours: tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS
  });
  const buildStr = formatTimeInStatus(pr.lastStatusChange);
  const buildColor = build === "merge-stall" || build === "danger" ? "danger" : build === "warn" ? "warn" : "ok";
  const buildPillLabel = build === "done" ? "Build \u2713" : build === "merge-stall" ? "Merge stalled" : tisLabel(buildColor, "build");
  const buildStateClass = build === "done" ? "done" : buildColor;
  const showReviewPill = !pr.isDraft && !closed;
  const merged = pr.status === "closed-merged";
  const review = reviewState({
    reviewApproved,
    merged,
    elapsedDays: pr.reviewClockStartedAt ? Math.max(0, Date.now() - pr.reviewClockStartedAt) / 864e5 : 0,
    warnDays: reviewWarnDays ?? DEFAULT_REVIEW_TIS_WARN_DAYS,
    dangerDays: reviewDangerDays ?? DEFAULT_REVIEW_TIS_DANGER_DAYS
  });
  const reviewStr = formatTimeInStatus(pr.reviewClockStartedAt);
  const reviewColor = review === "danger" ? "danger" : review === "warn" ? "warn" : "ok";
  const reviewPillLabel = review === "done" ? "Review \u2713" : tisLabel(reviewColor, "review");
  const reviewStateClass = review === "done" ? "done" : reviewColor;
  const reviewers = pr.reviewers ?? [];
  const reviewersByState = {
    "changes-requested": reviewers.filter((r) => r.state === "changes-requested"),
    "review-requested": reviewers.filter((r) => r.state === "review-requested"),
    approved: reviewers.filter((r) => r.state === "approved")
  };
  const hasReviewers = reviewers.length > 0;
  const openPr = () => {
    if (isSafeExternalUrl(pr.url)) {
      host.openExternal(pr.url);
    } else {
      host.toast("Refusing to open a non-http(s) URL", "error");
    }
  };
  const StateIcon = pr.isDraft ? GitPullRequestDraft : pr.status === "closed-merged" ? GitMerge : pr.status === "closed-abandoned" ? GitPullRequestClosed : GitPullRequest;
  const applyResult = (result) => {
    if (result?.ok && result.prs) {
      host.cache.set(MONITORED_PRS_CACHE_KEY, result.prs);
      host.cache.set(MONITORED_COUNT_CACHE_KEY, result.prs.length);
      host.cache.refreshBadge();
    }
  };
  const handleTileClick = async () => {
    if (hasUnseenChanges) {
      const result = await host.call("markPrAsSeen", { url: pr.url });
      applyResult(result);
    }
  };
  const toggleSeen = async () => {
    const handler = hasUnseenChanges ? "markPrAsSeen" : "markPrAsUnseen";
    const result = await host.call(handler, { url: pr.url });
    applyResult(result);
  };
  const toggleMute = async () => {
    const result = await host.call("setPrMuted", {
      url: pr.url,
      muted: !muted
    });
    applyResult(result);
  };
  const toggleFavorite = async () => {
    const result = await host.call("setPrFavorite", {
      url: pr.url,
      favorite: !favorite
    });
    applyResult(result);
  };
  const retrySync = async (e) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      const result = await host.call("retryPr", { url: pr.url });
      applyResult(result);
    } finally {
      setRetrying(false);
    }
  };
  const copyToClipboard = async (text, label) => {
    if (await copyText(text)) {
      host.toast(`${label} copied`, "info");
    } else {
      host.toast(`Failed to copy ${label}`, "error");
    }
  };
  const canToggleChecks = checks.length > 0;
  const checksVerb = canToggleChecks ? ` \u2014 click to ${checksOpen ? "hide" : "show"} checks` : "";
  const toggleChecks = (e) => {
    e.stopPropagation();
    setChecksOpen((v) => !v);
  };
  const onChecksKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleChecks(e);
    }
  };
  const checksToggleAttrs = (tip) => canToggleChecks ? {
    role: "button",
    tabIndex: 0,
    "aria-expanded": checksOpen,
    title: tip,
    "data-tip": tip,
    onClick: toggleChecks,
    onKeyDown: onChecksKey
  } : {};
  const checksToggleClass = canToggleChecks ? " prm-tip prm-checks-trigger" : "";
  const statusTip = `${pill.label} \u2014 overall PR status${checksVerb}`;
  const checksSummary = `${checkCounts.pass} passing, ${checkCounts.fail} failing, ${checkCounts.pending} running`;
  const buildStateWord = build === "done" ? "Build passing" : build === "merge-stall" ? "Merge stalled" : build === "blocked" ? "Build waiting (SFCI job not yet created)" : buildPillLabel || "Build running";
  const buildTip = `${buildStateWord} \xB7 ${buildStr} in build phase \xB7 ${checksSummary}${checksVerb}`;
  const reviewStateWord = review === "done" ? "Review approved" : reviewPillLabel || "Awaiting review";
  const reviewTip = `${reviewStateWord} \xB7 ${reviewStr} in review${checksVerb}`;
  const pipsTip = `${checksSummary}${checksVerb}`;
  const rowActionMeta = {
    seen: {
      Icon: hasUnseenChanges ? MailOpen : Mail,
      label: hasUnseenChanges ? "Mark read" : "Mark unread",
      title: hasUnseenChanges ? "Mark this PR as read (seen)" : "Mark this PR as unread"
    },
    favorite: {
      // The star is a stateful toggle: filled (via the --active class) when the PR
      // is a favorite, hollow otherwise. Label/title state the ACTION the click
      // takes, matching the mute action's convention.
      Icon: Star,
      label: favorite ? "Unfavorite" : "Favorite",
      title: favorite ? "Unfavorite \u2014 remove this PR from favorites" : "Favorite \u2014 mark this PR to find it faster",
      active: favorite
    },
    mute: {
      // Icon mirrors the CURRENT state (matching the .prm-mute-indicator badge,
      // where BellOff = muted): a muted PR shows the silenced bell, an active one
      // shows the ringing bell. The label/title state the ACTION the click takes.
      Icon: muted ? BellOff : Bell,
      label: muted ? "Unmute" : "Mute",
      title: muted ? "Unmute \u2014 resume notifications for this PR" : "Mute \u2014 silence notifications for this PR"
    },
    dismiss: {
      Icon: Trash2,
      label: "Dismiss",
      title: "Dismiss \u2014 remove this PR from the monitored list",
      danger: true
    }
  };
  const runRowAction = (id) => {
    if (id === "seen") void toggleSeen();
    else if (id === "favorite") void toggleFavorite();
    else if (id === "mute") void toggleMute();
    else onDismiss(pr.url);
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `prm-tile ${hasUnseenChanges ? "prm-tile--unread" : ""} ${closed ? "prm-tile--closed" : ""} ${hasSyncError ? "prm-tile--stale" : ""} ${favorite ? "prm-tile--favorite" : ""} ${selected ? "prm-tile--selected" : ""}`,
      onClick: handleTileClick,
      role: "button",
      tabIndex: 0,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void handleTileClick();
        }
      },
      children: [
        /* @__PURE__ */ jsxs("div", { className: "prm-tile-line1", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "checkbox",
              className: "prm-tile-select",
              checked: selected,
              title: selected ? "Deselect this PR" : "Select this PR",
              "aria-label": selected ? "Deselect this PR" : "Select this PR",
              onClick: (e) => e.stopPropagation(),
              onChange: (e) => {
                e.stopPropagation();
                onToggleSelect(pr.url);
              }
            }
          ),
          /* @__PURE__ */ jsx(StateIcon, { size: 14, className: "prm-tile-state-icon", "aria-hidden": true }),
          /* @__PURE__ */ jsxs("span", { className: "prm-tile-title", children: [
            workItem && /* @__PURE__ */ jsxs("span", { className: "prm-tile-workitem-inline", children: [
              "@",
              workItem,
              ": "
            ] }),
            pr.title.replace(new RegExp(`(?:^|@)${workItem}[:\\s]*`, "i"), "")
          ] }),
          /* @__PURE__ */ jsx(
            "span",
            {
              className: `prm-status-pill ${pill.className} prm-tip${checksToggleClass}`,
              title: statusTip,
              "data-tip": statusTip,
              ...checksToggleAttrs(statusTip),
              children: pill.label
            }
          ),
          canToggleChecks ? /* @__PURE__ */ jsxs(
            "span",
            {
              className: `prm-tis prm-tis--${buildStateClass} prm-tip prm-checks-trigger`,
              role: "button",
              tabIndex: 0,
              "aria-expanded": checksOpen,
              title: buildTip,
              "data-tip": buildTip,
              "aria-label": `${buildStateWord}, ${buildStr} in build phase`,
              onClick: toggleChecks,
              onKeyDown: onChecksKey,
              children: [
                buildStr,
                buildPillLabel && /* @__PURE__ */ jsxs("span", { className: "prm-tis-cue", children: [
                  " ",
                  buildPillLabel
                ] })
              ]
            }
          ) : /* @__PURE__ */ jsxs(
            "span",
            {
              className: `prm-tis prm-tis--${buildStateClass} prm-tip`,
              title: buildTip,
              "data-tip": buildTip,
              "aria-label": `${buildStateWord}, ${buildStr} in build phase`,
              children: [
                buildStr,
                buildPillLabel && /* @__PURE__ */ jsxs("span", { className: "prm-tis-cue", children: [
                  " ",
                  buildPillLabel
                ] })
              ]
            }
          ),
          showReviewPill && (reviewStr || reviewPillLabel) && (canToggleChecks ? /* @__PURE__ */ jsxs(
            "span",
            {
              className: `prm-tis prm-tis--review prm-tis--${reviewStateClass} prm-tip prm-checks-trigger`,
              role: "button",
              tabIndex: 0,
              "aria-expanded": checksOpen,
              title: reviewTip,
              "data-tip": reviewTip,
              "aria-label": `${reviewStateWord}, ${reviewStr} in review`,
              onClick: toggleChecks,
              onKeyDown: onChecksKey,
              children: [
                reviewStr,
                reviewPillLabel && /* @__PURE__ */ jsxs("span", { className: "prm-tis-cue", children: [
                  " ",
                  reviewPillLabel
                ] })
              ]
            }
          ) : /* @__PURE__ */ jsxs(
            "span",
            {
              className: `prm-tis prm-tis--review prm-tis--${reviewStateClass} prm-tip`,
              title: reviewTip,
              "data-tip": reviewTip,
              "aria-label": `${reviewStateWord}, ${reviewStr} in review`,
              children: [
                reviewStr,
                reviewPillLabel && /* @__PURE__ */ jsxs("span", { className: "prm-tis-cue", children: [
                  " ",
                  reviewPillLabel
                ] })
              ]
            }
          )),
          checks.length > 0 && /* @__PURE__ */ jsxs(
            "span",
            {
              className: "prm-check-pips prm-tip prm-checks-trigger",
              "aria-label": `Checks: ${checkCounts.pass} passed, ${checkCounts.fail} failed, ${checkCounts.pending} running`,
              ...checksToggleAttrs(pipsTip),
              children: [
                checkCounts.pass > 0 && /* @__PURE__ */ jsxs("span", { className: "prm-check-pip prm-check-pip--pass", children: [
                  /* @__PURE__ */ jsx(Check, { size: 9 }),
                  " ",
                  checkCounts.pass
                ] }),
                checkCounts.fail > 0 && /* @__PURE__ */ jsxs("span", { className: "prm-check-pip prm-check-pip--fail", children: [
                  /* @__PURE__ */ jsx(X, { size: 9 }),
                  " ",
                  checkCounts.fail
                ] }),
                checkCounts.pending > 0 && /* @__PURE__ */ jsxs("span", { className: "prm-check-pip prm-check-pip--pending", children: [
                  /* @__PURE__ */ jsx(Clock, { size: 9 }),
                  " ",
                  checkCounts.pending
                ] })
              ]
            }
          ),
          muted && /* @__PURE__ */ jsx("span", { className: "prm-mute-indicator", title: "Muted \u2014 notifications silenced for this PR", "aria-label": "Muted", children: /* @__PURE__ */ jsx(BellOff, { size: 11 }) }),
          hasSyncError && /* @__PURE__ */ jsxs("span", { className: "prm-sync-error", title: `Couldn't sync this PR: ${pr.syncError}. Showing last-known (stale) status.`, children: [
            /* @__PURE__ */ jsx(CircleAlert, { size: 11, className: "prm-sync-error-icon", "aria-hidden": true }),
            /* @__PURE__ */ jsx("span", { className: "prm-sync-error-text", children: "stale" }),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "prm-tile-icon-btn prm-tip",
                title: "Retry \u2014 re-fetch just this PR",
                "data-tip": "Retry sync",
                "aria-label": "Retry syncing this PR",
                disabled: retrying,
                onClick: (e) => void retrySync(e),
                children: /* @__PURE__ */ jsx(RefreshCw, { size: 10, className: retrying ? "prm-spin" : "" })
              }
            )
          ] }),
          /* @__PURE__ */ jsx("span", { className: "prm-tile-actions", children: ROW_ACTIONS.map((id) => {
            const meta = rowActionMeta[id];
            const Icon2 = meta.Icon;
            return /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: `prm-tile-icon-btn prm-tip${meta.danger ? " prm-tile-icon-btn--danger" : ""}${meta.active ? " prm-tile-icon-btn--active" : ""}`,
                title: meta.title,
                "data-tip": meta.label,
                "aria-label": meta.label,
                "aria-pressed": meta.active,
                onClick: (e) => {
                  e.stopPropagation();
                  runRowAction(id);
                },
                children: /* @__PURE__ */ jsx(Icon2, { size: 13, ...meta.active ? { fill: "currentColor" } : {} })
              },
              id
            );
          }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-tile-line2", children: [
          workItem && (workItemLink ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "prm-workitem-chip prm-workitem-chip--link",
              title: `Open ${workItem}`,
              onClick: (e) => {
                e.stopPropagation();
                if (isSafeExternalUrl(workItemLink)) host.openExternal(workItemLink);
              },
              children: workItem
            }
          ) : /* @__PURE__ */ jsx("span", { className: "prm-workitem-chip", children: workItem })),
          /* @__PURE__ */ jsx("span", { className: "prm-tile-repo", children: pr.repo }),
          /* @__PURE__ */ jsxs("span", { className: "prm-tile-number", children: [
            "#",
            pr.number,
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "prm-tile-icon-btn prm-tip",
                title: "Open on GitHub",
                "data-tip": "Open on GitHub",
                "aria-label": "Open on GitHub",
                onClick: (e) => {
                  e.stopPropagation();
                  openPr();
                },
                children: /* @__PURE__ */ jsx(ExternalLink, { size: 10 })
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "prm-tile-icon-btn prm-tip",
                title: "Copy link",
                "data-tip": "Copy link",
                "aria-label": "Copy link",
                onClick: (e) => {
                  e.stopPropagation();
                  void copyToClipboard(pr.url, "PR link");
                },
                children: /* @__PURE__ */ jsx(Link2, { size: 10 })
              }
            )
          ] }),
          pr.author && /* @__PURE__ */ jsxs("span", { className: "prm-author", children: [
            /* @__PURE__ */ jsx("span", { className: "prm-avatar prm-avatar--initials", children: initialsOf(pr.author) }),
            /* @__PURE__ */ jsx("span", { className: "prm-author-name", children: pr.author.name || pr.author.login })
          ] }),
          pr.isDraft && /* @__PURE__ */ jsx("span", { className: "prm-draft-pill", children: "Draft" })
        ] }),
        (pr.headRefName || pr.baseRefName) && /* @__PURE__ */ jsxs("div", { className: "prm-tile-line3", children: [
          /* @__PURE__ */ jsx(GitBranch, { size: 10, className: "prm-branch-icon", "aria-hidden": true }),
          /* @__PURE__ */ jsxs("span", { className: "prm-branch", children: [
            pr.headRefName || "?",
            " \u2192 ",
            pr.baseRefName || "?"
          ] }),
          pr.headRefName && /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "prm-tile-icon-btn prm-tip",
              title: "Copy branch",
              "data-tip": "Copy branch",
              "aria-label": "Copy branch name",
              onClick: (e) => {
                e.stopPropagation();
                void copyToClipboard(pr.headRefName, "Branch name");
              },
              children: /* @__PURE__ */ jsx(Link2, { size: 10 })
            }
          )
        ] }),
        hasReviewers && /* @__PURE__ */ jsx("div", { className: "prm-reviewers", children: REVIEWER_GROUPS.map(({ state, label, className }) => {
          const group = reviewersByState[state];
          if (group.length === 0) return null;
          return /* @__PURE__ */ jsxs("span", { className: `prm-reviewers-group ${className}`, title: label, children: [
            /* @__PURE__ */ jsx("span", { className: "prm-reviewers-label", children: label }),
            group.map((r) => /* @__PURE__ */ jsx(
              "span",
              {
                className: "prm-avatar prm-avatar--initials prm-reviewer-avatar",
                title: r.name || r.login,
                "aria-label": `${label}: ${r.name || r.login}`,
                children: initialsOf(r)
              },
              r.login
            ))
          ] }, state);
        }) }),
        pr.body && /* @__PURE__ */ jsx("div", { className: "prm-desc", children: pr.body }),
        /* @__PURE__ */ jsx(
          PrProjectControl,
          {
            projectId: pr.projectId,
            projects,
            onAssign: (projectId) => onProjectAssign(pr.url, projectId)
          }
        ),
        checksOpen && checks.length > 0 && /* @__PURE__ */ jsx("div", { className: "prm-tile-checks", onClick: (e) => e.stopPropagation(), children: /* @__PURE__ */ jsx(PrChecksCollapse, { checks }) })
      ]
    }
  );
}

// src/app/HostFilterMenu.tsx
function HostFilterMenu({
  anchorRef,
  hosts,
  selectedHosts,
  onClose,
  onToggleHost,
  onSelectAll,
  shortHost: shortHost2
}) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [anchorRef]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!pos || typeof document === "undefined") return null;
  const allSelected = selectedHosts.length === 0;
  return portal(
    /* @__PURE__ */ jsxs(Fragment2, { children: [
      /* @__PURE__ */ jsx(
        "div",
        {
          className: "prm-project-menu-backdrop",
          onMouseDown: (e) => {
            e.stopPropagation();
            onClose();
          }
        }
      ),
      /* @__PURE__ */ jsxs(
        "div",
        {
          className: "prm-tile-menu prm-host-filter",
          style: { position: "fixed", top: pos.top, left: pos.left },
          role: "menu",
          children: [
            /* @__PURE__ */ jsxs("div", { className: "prm-sync-filter-header", children: [
              /* @__PURE__ */ jsx("strong", { children: "Host" }),
              /* @__PURE__ */ jsx("span", { className: "prm-sync-filter-desc", children: "Show PRs from specific git hosts." })
            ] }),
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: `prm-project-menu-item ${allSelected ? "is-active" : ""}`,
                role: "menuitemcheckbox",
                "aria-checked": allSelected,
                onClick: (e) => {
                  e.stopPropagation();
                  onSelectAll();
                },
                title: "Show PRs from all hosts",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "prm-sync-filter-check", children: allSelected && /* @__PURE__ */ jsx(Check, { size: 12 }) }),
                  "All hosts"
                ]
              }
            ),
            hosts.map((h) => {
              const checked = selectedHosts.includes(h);
              return /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  className: `prm-project-menu-item ${checked ? "is-active" : ""}`,
                  role: "menuitemcheckbox",
                  "aria-checked": checked,
                  onClick: (e) => {
                    e.stopPropagation();
                    onToggleHost(h);
                  },
                  title: `Filter to ${h}`,
                  children: [
                    /* @__PURE__ */ jsx("span", { className: "prm-sync-filter-check", children: checked && /* @__PURE__ */ jsx(Check, { size: 12 }) }),
                    shortHost2(h)
                  ]
                },
                h
              );
            })
          ]
        }
      )
    ] }),
    document.body
  );
}

// src/app/pr-board.ts
var BOARD_COLUMNS = [
  "conflict",
  "failed",
  "yellow",
  "review-required",
  "pending",
  "integrating",
  "green"
];
var TERMINAL_BOARD_COLUMNS = [
  "closed-merged",
  "closed-abandoned"
];
var BOARD_COLUMN_LABELS = {
  conflict: "Conflict",
  failed: "Failing",
  yellow: "Blocked",
  "review-required": "Review",
  pending: "Pending",
  integrating: "Merging",
  green: "Ready",
  "closed-merged": "Merged",
  "closed-abandoned": "Closed"
};
function isListViewMode(value) {
  return value === "list" || value === "board";
}
function emptyBoardColumns() {
  return {
    conflict: [],
    failed: [],
    yellow: [],
    "review-required": [],
    pending: [],
    integrating: [],
    green: [],
    "closed-merged": [],
    "closed-abandoned": []
  };
}
function groupPrsByStatus(prs) {
  const columns = emptyBoardColumns();
  for (const pr of prs) columns[pr.status].push(pr);
  return columns;
}
function boardColumnCounts(columns) {
  return {
    conflict: columns.conflict.length,
    failed: columns.failed.length,
    yellow: columns.yellow.length,
    "review-required": columns["review-required"].length,
    pending: columns.pending.length,
    integrating: columns.integrating.length,
    green: columns.green.length,
    "closed-merged": columns["closed-merged"].length,
    "closed-abandoned": columns["closed-abandoned"].length
  };
}
var ALL_BOARD_STATUSES = [
  ...BOARD_COLUMNS,
  ...TERMINAL_BOARD_COLUMNS
];
function isPrRollupStatus(value) {
  return typeof value === "string" && ALL_BOARD_STATUSES.includes(value);
}
function visibleBoardColumns(columns, opts = {}) {
  const counts = boardColumnCounts(columns);
  if (!opts.showEmpty) {
    return ALL_BOARD_STATUSES.filter((status) => counts[status] > 0);
  }
  return [
    ...BOARD_COLUMNS,
    ...TERMINAL_BOARD_COLUMNS.filter((status) => counts[status] > 0)
  ];
}
function emptyActiveColumnCount(columns) {
  const counts = boardColumnCounts(columns);
  return BOARD_COLUMNS.filter((status) => counts[status] === 0).length;
}
function shortRepoName(repo) {
  const i = repo.lastIndexOf("/");
  return i >= 0 ? repo.slice(i + 1) : repo;
}

// src/app/PrBoardCard.tsx
function isSafeExternalUrl2(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function isUnread(pr) {
  return pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
}
function PrBoardCard({
  pr,
  host,
  tisWarnHours,
  tisDangerHours,
  ignoredFailingChecks,
  selected,
  selectionActive = false,
  selectMode = false,
  onToggleSelect,
  onDismiss
}) {
  const [retrying, setRetrying] = useState(false);
  const unread = isUnread(pr);
  const closed = pr.status === "closed-merged" || pr.status === "closed-abandoned";
  const favorite = Boolean(pr.favorite);
  const hasSyncError = Boolean(pr.syncError);
  const workItem = pr.workItem ?? extractWorkItem(pr.title, pr.headRefName, pr.body);
  const title = workItem ? pr.title.replace(new RegExp(`(?:^|@)${workItem}[:\\s]*`, "i"), "") : pr.title;
  const checks = pr.checks ?? [];
  const checkCounts = summarizeChecks(checks);
  const updated = pr.updatedAt || pr.lastChecked || pr.lastStatusChange;
  const buildHappy = pr.buildHappy ?? isBuildHappy(checks, { ignoredFailingChecks });
  const build = buildStallState({
    status: pr.status,
    buildHappy,
    reviewApproved: pr.reviewDecision === "APPROVED",
    sfciGated: false,
    hasSfciJob: Boolean(pr.hasSfciJob),
    elapsedHours: pr.lastStatusChange ? Math.max(0, Date.now() - pr.lastStatusChange) / 36e5 : 0,
    warnHours: tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
    dangerHours: tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS
  });
  const stallCue = build === "merge-stall" ? "Merge stalled" : build === "warn" || build === "danger" ? tisLabel(build, "build") : "";
  const stallClass = build === "merge-stall" || build === "danger" ? "danger" : build === "warn" ? "warn" : "";
  const showCheckbox = selected || selectMode || selectionActive;
  const applyResult = (result) => {
    if (result?.ok && result.prs) {
      host.cache.set(MONITORED_PRS_CACHE_KEY, result.prs);
      host.cache.set(MONITORED_COUNT_CACHE_KEY, result.prs.length);
      host.cache.refreshBadge();
    }
  };
  const markSeen = async () => {
    if (!unread) return;
    const result = await host.call("markPrAsSeen", { url: pr.url });
    applyResult(result);
  };
  const toggleFavorite = async () => {
    const result = await host.call("setPrFavorite", {
      url: pr.url,
      favorite: !favorite
    });
    applyResult(result);
  };
  const openPr = () => {
    if (isSafeExternalUrl2(pr.url)) host.openExternal(pr.url);
    else host.toast("Refusing to open a non-http(s) URL", "error");
  };
  const retrySync = async () => {
    setRetrying(true);
    try {
      const result = await host.call("retryPr", { url: pr.url });
      applyResult(result);
    } finally {
      setRetrying(false);
    }
  };
  const handleCardClick = (e) => {
    if (e.metaKey || e.ctrlKey || selectMode) {
      onToggleSelect(pr.url);
      return;
    }
    void markSeen();
  };
  return /* @__PURE__ */ jsxs(
    "article",
    {
      className: [
        "prm-board-card",
        unread ? "prm-board-card--unread" : "",
        closed ? "prm-board-card--closed" : "",
        favorite ? "prm-board-card--favorite" : "",
        selected ? "prm-board-card--selected" : "",
        hasSyncError ? "prm-board-card--stale" : "",
        showCheckbox ? "prm-board-card--selectable" : "",
        selectMode ? "prm-board-card--select-mode" : ""
      ].filter(Boolean).join(" "),
      onClick: handleCardClick,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selectMode) onToggleSelect(pr.url);
          else void markSeen();
        }
      },
      role: "listitem",
      tabIndex: 0,
      "aria-label": `${pr.repo} #${pr.number}: ${pr.title}`,
      children: [
        /* @__PURE__ */ jsxs("div", { className: "prm-board-card-top", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "checkbox",
              className: "prm-board-card-select",
              checked: selected,
              title: selected ? "Deselect this PR" : "Select this PR",
              "aria-label": selected ? "Deselect this PR" : "Select this PR",
              onClick: (e) => e.stopPropagation(),
              onChange: (e) => {
                e.stopPropagation();
                onToggleSelect(pr.url);
              }
            }
          ),
          /* @__PURE__ */ jsxs("span", { className: "prm-board-card-id", children: [
            /* @__PURE__ */ jsxs("span", { className: "prm-board-card-num", children: [
              "#",
              pr.number
            ] }),
            /* @__PURE__ */ jsx("span", { className: "prm-board-card-repo", children: shortRepoName(pr.repo) })
          ] }),
          workItem && /* @__PURE__ */ jsx("span", { className: "prm-workitem-chip prm-board-card-wi", children: workItem }),
          /* @__PURE__ */ jsxs("span", { className: "prm-board-card-actions", children: [
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: `prm-tile-icon-btn prm-tip${favorite ? " prm-tile-icon-btn--active" : ""}`,
                title: favorite ? "Unfavorite" : "Favorite",
                "data-tip": favorite ? "Unfavorite" : "Favorite",
                "aria-label": favorite ? "Unfavorite" : "Favorite",
                "aria-pressed": favorite,
                onClick: (e) => {
                  e.stopPropagation();
                  void toggleFavorite();
                },
                children: /* @__PURE__ */ jsx(Star, { size: 12, ...favorite ? { fill: "currentColor" } : {} })
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "prm-tile-icon-btn prm-tip",
                title: "Open on GitHub",
                "data-tip": "Open on GitHub",
                "aria-label": "Open on GitHub",
                onClick: (e) => {
                  e.stopPropagation();
                  openPr();
                },
                children: /* @__PURE__ */ jsx(ExternalLink, { size: 12 })
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "prm-tile-icon-btn prm-tip prm-tile-icon-btn--danger",
                title: "Dismiss",
                "data-tip": "Dismiss",
                "aria-label": "Dismiss",
                onClick: (e) => {
                  e.stopPropagation();
                  onDismiss(pr.url);
                },
                children: /* @__PURE__ */ jsx(Trash2, { size: 12 })
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "prm-board-card-title", children: title }),
        /* @__PURE__ */ jsxs("div", { className: "prm-board-card-meta", children: [
          pr.author && /* @__PURE__ */ jsx("span", { className: "prm-avatar prm-avatar--initials", title: pr.author.name || pr.author.login, children: initialsOf(pr.author) }),
          stallCue ? /* @__PURE__ */ jsxs("span", { className: `prm-tis prm-tis--${stallClass} prm-board-card-stall`, children: [
            formatTimeInStatus(pr.lastStatusChange),
            " ",
            stallCue
          ] }) : updated > 0 && /* @__PURE__ */ jsx("span", { className: "prm-board-card-time", children: formatRelative(updated) }),
          checkCounts.fail > 0 && /* @__PURE__ */ jsxs("span", { className: "prm-check-pip prm-check-pip--fail", "aria-label": `${checkCounts.fail} checks failing`, children: [
            /* @__PURE__ */ jsx(X, { size: 9 }),
            " ",
            checkCounts.fail
          ] }),
          checkCounts.pending > 0 && /* @__PURE__ */ jsxs("span", { className: "prm-check-pip prm-check-pip--pending", "aria-label": `${checkCounts.pending} checks running`, children: [
            /* @__PURE__ */ jsx(Clock, { size: 9 }),
            " ",
            checkCounts.pending
          ] }),
          pr.isDraft && /* @__PURE__ */ jsxs("span", { className: "prm-draft-pill prm-board-card-draft", children: [
            /* @__PURE__ */ jsx(GitPullRequestDraft, { size: 10, "aria-hidden": true }),
            " Draft"
          ] }),
          hasSyncError && /* @__PURE__ */ jsxs("span", { className: "prm-sync-error", title: `Couldn't sync this PR: ${pr.syncError}`, children: [
            /* @__PURE__ */ jsx(CircleAlert, { size: 11, "aria-hidden": true }),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "prm-tile-icon-btn",
                title: "Retry sync",
                "aria-label": "Retry syncing this PR",
                disabled: retrying,
                onClick: (e) => {
                  e.stopPropagation();
                  void retrySync();
                },
                children: /* @__PURE__ */ jsx(RefreshCw, { size: 10, className: retrying ? "prm-spin" : "" })
              }
            )
          ] })
        ] })
      ]
    }
  );
}

// src/app/PrBoard.tsx
var COLUMN_ICONS = {
  conflict: ShieldAlert,
  failed: CircleX,
  yellow: TriangleAlert,
  "review-required": Eye,
  pending: CircleDashed,
  integrating: LoaderCircle,
  green: CircleCheck,
  "closed-merged": GitMerge,
  "closed-abandoned": GitPullRequestClosed
};
function PrBoard({
  prs,
  host,
  tisWarnHours,
  tisDangerHours,
  repositories,
  selected,
  selectMode = false,
  showEmpty = false,
  collapsed,
  onToggleCollapse,
  onToggleSelect,
  onDismiss
}) {
  const columns = useMemo(() => groupPrsByStatus(prs), [prs]);
  const visible = useMemo(() => visibleBoardColumns(columns, { showEmpty }), [columns, showEmpty]);
  const selectionActive = selected.size > 0 || selectMode;
  return /* @__PURE__ */ jsx("div", { className: "prm-board", role: "list", "aria-label": "Pull requests by status", children: visible.map((status) => {
    const cards = columns[status];
    const Icon2 = COLUMN_ICONS[status];
    const isCollapsed = collapsed.has(status);
    const unread = cards.filter(
      (pr) => pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt)
    ).length;
    return /* @__PURE__ */ jsxs(
      "section",
      {
        className: `prm-board-col prm-board-col--${status}${isCollapsed ? " prm-board-col--collapsed" : ""}`,
        "aria-label": `${BOARD_COLUMN_LABELS[status]} (${cards.length})`,
        "data-board-column": status,
        "data-collapsed": isCollapsed ? "true" : "false",
        children: [
          /* @__PURE__ */ jsxs("header", { className: "prm-board-col-header", children: [
            /* @__PURE__ */ jsx(Icon2, { size: 14, className: "prm-board-col-icon", "aria-hidden": true }),
            /* @__PURE__ */ jsx("span", { className: "prm-board-col-title", children: BOARD_COLUMN_LABELS[status] }),
            /* @__PURE__ */ jsx("span", { className: "prm-board-col-count", children: cards.length }),
            unread > 0 && /* @__PURE__ */ jsx("span", { className: "prm-board-col-unread", title: `${unread} unread`, children: unread }),
            /* @__PURE__ */ jsx(
              "button",
              {
                type: "button",
                className: "prm-board-col-collapse",
                title: isCollapsed ? `Expand ${BOARD_COLUMN_LABELS[status]}` : `Collapse ${BOARD_COLUMN_LABELS[status]}`,
                "aria-label": isCollapsed ? `Expand ${BOARD_COLUMN_LABELS[status]}` : `Collapse ${BOARD_COLUMN_LABELS[status]}`,
                "aria-expanded": !isCollapsed,
                onClick: () => onToggleCollapse(status),
                children: isCollapsed ? /* @__PURE__ */ jsx(ChevronRight, { size: 13 }) : /* @__PURE__ */ jsx(PanelLeftClose, { size: 13 })
              }
            )
          ] }),
          !isCollapsed && /* @__PURE__ */ jsx("div", { className: "prm-board-col-body", children: cards.length === 0 ? /* @__PURE__ */ jsx("div", { className: "prm-board-col-empty", children: "No PRs" }) : cards.map((pr) => {
            const build = resolveBuildThresholds(
              pr.repo,
              repositories,
              tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
              tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS
            );
            const repoRec = (repositories ?? []).find(
              (r) => `${r.owner}/${r.repo}`.toLowerCase() === pr.repo.toLowerCase()
            );
            return /* @__PURE__ */ jsx(
              PrBoardCard,
              {
                pr,
                host,
                tisWarnHours: build.warnHours,
                tisDangerHours: build.dangerHours,
                ignoredFailingChecks: repoRec?.ignoredFailingChecks,
                selected: selected.has(pr.url),
                selectionActive,
                selectMode,
                onToggleSelect,
                onDismiss
              },
              pr.url
            );
          }) })
        ]
      },
      status
    );
  }) });
}

// src/app/PrTileList.tsx
var STATUS_ORDER = [
  "conflict",
  "failed",
  "yellow",
  "review-required",
  "pending",
  "integrating",
  "green",
  "closed-merged",
  "closed-abandoned"
];
var TERMINAL_STATUSES = ["closed-merged", "closed-abandoned"];
var SORT_FIELDS = [
  { id: "updated", label: "PR Updated", title: "Sort by when the PR last changed on GitHub" },
  { id: "created", label: "PR Created", title: "Sort by when the PR was opened" },
  { id: "status", label: "Status", title: "Sort by rollup status (triage severity)" },
  { id: "statusUpdated", label: "Status Updated", title: "Sort by when the status last changed" },
  { id: "favorites", label: "Favorites first", title: "Group favorites at the top, then by when the status last changed" }
];
function compareFavoritesFirst(a, b) {
  const af = a.favorite ? 1 : 0;
  const bf = b.favorite ? 1 : 0;
  if (af !== bf) return bf - af;
  return b.lastStatusChange - a.lastStatusChange;
}
function isUnread2(pr) {
  return pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt);
}
function resolveBulkFavorite(urls, prs) {
  const allFavorite = urls.length > 0 && urls.every((u) => {
    const pr = prs.find((p) => p.url === u);
    return pr ? Boolean(pr.favorite) : false;
  });
  return allFavorite ? { favorite: false, label: "Unfavorite" } : { favorite: true, label: "Favorite" };
}
function shortRepo(repo) {
  const i = repo.lastIndexOf("/");
  return i >= 0 ? repo.slice(i + 1) : repo;
}
function searchText(pr) {
  const workItem = pr.workItem ?? extractWorkItem(pr.title, pr.headRefName, pr.body) ?? "";
  return [
    pr.title,
    `#${pr.number}`,
    String(pr.number),
    statusLabel(pr.status),
    pr.headRefName ?? "",
    pr.baseRefName ?? "",
    workItem,
    pr.repo,
    shortRepo(pr.repo)
  ].join("").toLowerCase();
}
var STORAGE_SHOW_EMPTY = "boardShowEmpty";
var STORAGE_COLLAPSED = "boardCollapsed";
function PrTileList({
  prs,
  host,
  projects,
  tisWarnHours,
  tisDangerHours,
  reviewWarnDays,
  reviewDangerDays,
  repositories,
  workItemLocatorBase,
  sortField,
  sortDir,
  onSortChange,
  hostScope,
  onHostScopeChange,
  awaitingFirstSync,
  syncing,
  autoSyncEnabled,
  onDismiss,
  onProjectAssign,
  onBulkSetSeen,
  onBulkDismiss,
  onBulkSetFavorite,
  viewMode: viewModeProp = "list",
  onViewModeChange
}) {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(/* @__PURE__ */ new Set());
  const [hostMenuOpen, setHostMenuOpen] = useState(false);
  const [localView, setLocalView] = useState(viewModeProp);
  const [selectMode, setSelectMode] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState(() => /* @__PURE__ */ new Set());
  const hostBtnRef = useRef(null);
  const viewMode = onViewModeChange ? viewModeProp : localView;
  const setViewMode = (mode) => {
    if (mode === "board") setTab("all");
    if (mode === "list") setSelectMode(false);
    if (onViewModeChange) onViewModeChange(mode);
    else setLocalView(mode);
  };
  useEffect(() => {
    let alive = true;
    void host.storage.get(STORAGE_SHOW_EMPTY).then((value) => {
      if (alive && typeof value === "boolean") setShowEmpty(value);
    });
    void host.storage.get(STORAGE_COLLAPSED).then((value) => {
      if (!alive || !Array.isArray(value)) return;
      setCollapsed(new Set(value.filter(isPrRollupStatus)));
    });
    return () => {
      alive = false;
    };
  }, [host]);
  const persistShowEmpty = (value) => {
    setShowEmpty(value);
    void host.storage.set(STORAGE_SHOW_EMPTY, value);
  };
  const toggleCollapse = (status) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      void host.storage.set(STORAGE_COLLAPSED, [...next]);
      return next;
    });
  };
  const hosts = useMemo(() => {
    const seen = [];
    for (const pr of prs) {
      const h = hostOf(pr.url);
      if (!seen.includes(h)) seen.push(h);
    }
    return seen;
  }, [prs]);
  const afterHost = useMemo(() => {
    if (hostScope.length === 0) return prs;
    const set = new Set(hostScope);
    return prs.filter((pr) => set.has(hostOf(pr.url)));
  }, [prs, hostScope]);
  const countsByStatus = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    for (const pr of afterHost) m.set(pr.status, (m.get(pr.status) ?? 0) + 1);
    return m;
  }, [afterHost]);
  const afterTab = useMemo(() => {
    if (tab === "all") return afterHost;
    return afterHost.filter((pr) => pr.status === tab);
  }, [afterHost, tab]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return afterTab;
    return afterTab.filter((pr) => searchText(pr).includes(q));
  }, [afterTab, query]);
  const shown = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const keyed = [...filtered];
    if (sortField === "favorites") {
      keyed.sort(compareFavoritesFirst);
      return keyed;
    }
    keyed.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "created":
          cmp = (a.createdAt ?? 0) - (b.createdAt ?? 0);
          break;
        case "status":
          cmp = triageSeverityRank(a.status) - triageSeverityRank(b.status);
          break;
        case "statusUpdated":
          cmp = a.lastStatusChange - b.lastStatusChange;
          break;
        case "updated":
        default:
          cmp = (a.updatedAt || a.lastChecked || a.lastStatusChange) - (b.updatedAt || b.lastChecked || b.lastStatusChange);
          break;
      }
      if (cmp === 0) {
        const au = isUnread2(a) ? 1 : 0;
        const bu = isUnread2(b) ? 1 : 0;
        if (au !== bu) return bu - au;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      }
      return cmp * dir;
    });
    return keyed;
  }, [filtered, sortField, sortDir]);
  const emptyLanes = useMemo(
    () => emptyActiveColumnCount(groupPrsByStatus(shown)),
    [shown]
  );
  const unreadCount = useMemo(() => afterHost.filter(isUnread2).length, [afterHost]);
  const shownUrls = useMemo(() => shown.map((pr) => pr.url), [shown]);
  const selectedShown = useMemo(
    () => shownUrls.filter((u) => selected.has(u)),
    [shownUrls, selected]
  );
  const allShownSelected = shown.length > 0 && selectedShown.length === shown.length;
  const someShownSelected = selectedShown.length > 0 && !allShownSelected;
  const toggleSelect = (url) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (allShownSelected || someShownSelected) {
      setSelected(/* @__PURE__ */ new Set());
    } else {
      setSelected(new Set(shownUrls));
    }
  };
  const clearSelection = () => setSelected(/* @__PURE__ */ new Set());
  const bulkSeenTargets = selectedShown.length > 0 ? selectedShown : shownUrls;
  const targetsAllRead = bulkSeenTargets.every((u) => {
    const pr = prs.find((p) => p.url === u);
    return pr ? !isUnread2(pr) : true;
  });
  const bulkFavorite = resolveBulkFavorite(selectedShown, prs);
  if (prs.length === 0) {
    if (awaitingFirstSync) {
      const loading = syncing || autoSyncEnabled;
      return /* @__PURE__ */ jsxs("div", { className: "prm-empty", children: [
        loading ? /* @__PURE__ */ jsx(LoaderCircle, { size: 32, className: "prm-spin", "aria-hidden": true }) : /* @__PURE__ */ jsx(GitPullRequest, { size: 32, "aria-hidden": true }),
        /* @__PURE__ */ jsx("h3", { children: loading ? "Checking for your PRs\u2026" : "No sync yet" }),
        /* @__PURE__ */ jsx("p", { children: loading ? "PR Monitor is syncing with GitHub to find the pull requests you authored." : "Auto-sync is off. Run a sync from the header to find your pull requests." })
      ] });
    }
    return /* @__PURE__ */ jsxs("div", { className: "prm-empty", children: [
      /* @__PURE__ */ jsx(GitPullRequest, { size: 32, "aria-hidden": true }),
      /* @__PURE__ */ jsx("h3", { children: "No pull requests monitored" }),
      /* @__PURE__ */ jsx("p", { children: "Pull a specific PR from the header, or connect a repository in Settings so a sync surfaces its PRs." })
    ] });
  }
  const viewToggle = /* @__PURE__ */ jsxs("div", { className: "prm-view-toggle", role: "group", "aria-label": "View", children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "prm-view-toggle-btn",
        "aria-pressed": viewMode === "list",
        title: "List view",
        onClick: () => setViewMode("list"),
        children: [
          /* @__PURE__ */ jsx(LayoutList, { size: 13, "aria-hidden": true }),
          /* @__PURE__ */ jsx("span", { children: "List" })
        ]
      }
    ),
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "prm-view-toggle-btn",
        "aria-pressed": viewMode === "board",
        title: "Board view",
        onClick: () => setViewMode("board"),
        children: [
          /* @__PURE__ */ jsx(Columns3, { size: 13, "aria-hidden": true }),
          /* @__PURE__ */ jsx("span", { children: "Board" })
        ]
      }
    )
  ] });
  const toolbar = /* @__PURE__ */ jsxs("div", { className: "prm-list-toolbar", children: [
    /* @__PURE__ */ jsxs("div", { className: "prm-list-controls", children: [
      viewToggle,
      viewMode === "list" && /* @__PURE__ */ jsx("label", { className: "prm-select-all", title: allShownSelected ? "Clear selection" : "Select all shown PRs", children: /* @__PURE__ */ jsx(
        "input",
        {
          type: "checkbox",
          checked: allShownSelected,
          ref: (el) => {
            if (el) el.indeterminate = someShownSelected;
          },
          onChange: toggleSelectAll,
          "aria-label": allShownSelected ? "Clear selection" : "Select all shown PRs"
        }
      ) }),
      viewMode === "list" && /* @__PURE__ */ jsxs("span", { className: "prm-shown-count", "aria-live": "polite", children: [
        shown.length,
        " shown"
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "prm-search", children: [
        /* @__PURE__ */ jsx(Search, { size: 12, "aria-hidden": true }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "search",
            className: "prm-search-input",
            placeholder: "Search PRs\u2026",
            value: query,
            onChange: (e) => setQuery(e.target.value),
            "aria-label": "Search PRs"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          ref: hostBtnRef,
          className: `prm-btn prm-btn--sm ${hostScope.length > 0 ? "is-active" : ""}`,
          onClick: () => setHostMenuOpen((v) => !v),
          title: "Filter by host",
          "aria-expanded": hostMenuOpen,
          children: [
            /* @__PURE__ */ jsx(Globe, { size: 12 }),
            /* @__PURE__ */ jsxs("span", { children: [
              "Host",
              hostScope.length > 0 && /* @__PURE__ */ jsxs("span", { className: "prm-unread-count", children: [
                " (",
                hostScope.length,
                ")"
              ] })
            ] }),
            /* @__PURE__ */ jsx(ChevronDown, { size: 12 })
          ]
        }
      ),
      hostMenuOpen && /* @__PURE__ */ jsx(
        HostFilterMenu,
        {
          anchorRef: hostBtnRef,
          hosts,
          selectedHosts: hostScope,
          onClose: () => setHostMenuOpen(false),
          onToggleHost: (h) => onHostScopeChange(
            hostScope.includes(h) ? hostScope.filter((x) => x !== h) : [...hostScope, h]
          ),
          onSelectAll: () => onHostScopeChange([]),
          shortHost
        }
      ),
      viewMode === "board" && /* @__PURE__ */ jsxs(Fragment2, { children: [
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: `prm-btn prm-btn--sm ${selectMode ? "is-active" : ""}`,
            "aria-pressed": selectMode,
            title: "Select cards for bulk actions",
            onClick: () => setSelectMode((v) => !v),
            children: [
              /* @__PURE__ */ jsx(SquareCheckBig, { size: 12 }),
              /* @__PURE__ */ jsx("span", { children: "Select" })
            ]
          }
        ),
        emptyLanes > 0 && /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: `prm-btn prm-btn--sm ${showEmpty ? "is-active" : ""}`,
            "aria-pressed": showEmpty,
            title: showEmpty ? "Hide empty columns" : `Show ${emptyLanes} empty column${emptyLanes === 1 ? "" : "s"}`,
            onClick: () => persistShowEmpty(!showEmpty),
            children: [
              /* @__PURE__ */ jsx(EyeOff, { size: 12 }),
              /* @__PURE__ */ jsx("span", { children: showEmpty ? "Hide empty" : `Empty (${emptyLanes})` })
            ]
          }
        )
      ] }),
      viewMode === "list" && /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          className: "prm-btn prm-btn--sm",
          onClick: () => onBulkSetSeen(bulkSeenTargets, !targetsAllRead),
          title: selectedShown.length > 0 ? `Mark the ${selectedShown.length} selected PR(s) ${targetsAllRead ? "unread" : "read"}` : `Mark all shown PRs ${targetsAllRead ? "unread" : "read"}`,
          children: [
            /* @__PURE__ */ jsx(MailOpen, { size: 12 }),
            /* @__PURE__ */ jsxs("span", { children: [
              targetsAllRead ? "Mark unread" : "Mark read",
              unreadCount > 0 && /* @__PURE__ */ jsxs("span", { className: "prm-unread-count", children: [
                " (",
                unreadCount,
                ")"
              ] })
            ] })
          ]
        }
      ),
      viewMode === "list" && /* @__PURE__ */ jsxs("div", { className: "prm-sort", title: "Sort order", children: [
        /* @__PURE__ */ jsx(
          "select",
          {
            className: "prm-input prm-input--select prm-sort-select",
            value: sortField,
            onChange: (e) => onSortChange(e.target.value, sortDir),
            "aria-label": "Sort field",
            children: SORT_FIELDS.map((f) => /* @__PURE__ */ jsx("option", { value: f.id, title: f.title, children: f.label }, f.id))
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "prm-btn prm-btn--sm prm-sort-dir",
            onClick: () => onSortChange(sortField, sortDir === "asc" ? "desc" : "asc"),
            disabled: sortField === "favorites",
            title: sortField === "favorites" ? "Favorites first uses a fixed order" : sortDir === "asc" ? "Ascending \u2014 click for descending" : "Descending \u2014 click for ascending",
            "aria-label": sortDir === "asc" ? "Sorted ascending" : "Sorted descending",
            children: sortDir === "asc" ? /* @__PURE__ */ jsx(ArrowUp, { size: 12 }) : /* @__PURE__ */ jsx(ArrowDown, { size: 12 })
          }
        )
      ] })
    ] }),
    viewMode === "list" && /* @__PURE__ */ jsxs("div", { className: "prm-segment-tabs", role: "tablist", "aria-label": "Filter by status", children: [
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-selected": tab === "all",
          className: `prm-segment-tab ${tab === "all" ? "active" : ""}`,
          onClick: () => setTab("all"),
          title: "Show all monitored PRs",
          children: [
            "All ",
            /* @__PURE__ */ jsx("span", { className: "prm-segment-count", children: afterHost.length })
          ]
        }
      ),
      STATUS_ORDER.map((s) => {
        const n = countsByStatus.get(s) ?? 0;
        return /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": tab === s,
            className: `prm-segment-tab prm-segment-tab--${s} ${tab === s ? "active" : ""}`,
            onClick: () => setTab(s),
            title: `Show PRs in "${statusLabel(s)}"`,
            children: [
              statusLabel(s),
              " ",
              /* @__PURE__ */ jsx("span", { className: "prm-segment-count", children: n })
            ]
          },
          s
        );
      })
    ] }),
    selectedShown.length > 0 && /* @__PURE__ */ jsxs("div", { className: "prm-bulk-bar", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "prm-bulk-clear",
          onClick: clearSelection,
          title: "Clear selection",
          "aria-label": "Clear selection",
          children: /* @__PURE__ */ jsx(X, { size: 12 })
        }
      ),
      /* @__PURE__ */ jsxs("span", { className: "prm-bulk-count", children: [
        selectedShown.length,
        " selected"
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "prm-bulk-actions", children: [
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "prm-btn prm-btn--sm",
            onClick: () => onBulkSetSeen(selectedShown, !targetsAllRead),
            title: `Mark the selected PR(s) ${targetsAllRead ? "unread" : "read"}`,
            children: [
              targetsAllRead ? /* @__PURE__ */ jsx(Mail, { size: 12 }) : /* @__PURE__ */ jsx(MailOpen, { size: 12 }),
              /* @__PURE__ */ jsx("span", { children: targetsAllRead ? "Mark unread" : "Mark read" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "prm-btn prm-btn--sm",
            onClick: () => onBulkSetFavorite(selectedShown, bulkFavorite.favorite),
            title: `${bulkFavorite.label} the selected PR(s)`,
            children: [
              /* @__PURE__ */ jsx(Star, { size: 12, ...bulkFavorite.favorite ? {} : { fill: "currentColor" } }),
              /* @__PURE__ */ jsx("span", { children: bulkFavorite.label })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "prm-btn prm-btn--sm prm-btn--danger",
            onClick: () => {
              onBulkDismiss(selectedShown);
              clearSelection();
            },
            title: "Dismiss the selected PR(s) \u2014 removes them from the monitored list",
            children: [
              /* @__PURE__ */ jsx(Trash2, { size: 12 }),
              /* @__PURE__ */ jsx("span", { children: "Dismiss" })
            ]
          }
        )
      ] })
    ] })
  ] });
  return /* @__PURE__ */ jsxs("div", { className: `prm-list${viewMode === "board" ? " prm-list--board" : ""}`, children: [
    toolbar,
    shown.length === 0 ? /* @__PURE__ */ jsxs("div", { className: "prm-empty prm-empty--filtered", children: [
      /* @__PURE__ */ jsx(Search, { size: 28, "aria-hidden": true }),
      /* @__PURE__ */ jsx("h3", { children: "No PRs match the current filter" }),
      /* @__PURE__ */ jsx("p", { children: query.trim() ? "Clear the search to see the rest." : 'No PRs in this status. Switch to the "All" tab to see the rest.' }),
      /* @__PURE__ */ jsxs("div", { className: "prm-empty-actions", children: [
        query.trim() && /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn prm-btn--sm", onClick: () => setQuery(""), title: "Clear search", children: "Clear search" }),
        tab !== "all" && /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn prm-btn--sm", onClick: () => setTab("all"), title: "Show all PRs", children: "Show all" })
      ] })
    ] }) : viewMode === "board" ? /* @__PURE__ */ jsx(
      PrBoard,
      {
        prs: shown,
        host,
        tisWarnHours,
        tisDangerHours,
        repositories,
        selected,
        selectMode,
        showEmpty,
        collapsed,
        onToggleCollapse: toggleCollapse,
        onToggleSelect: toggleSelect,
        onDismiss
      }
    ) : /* @__PURE__ */ jsx("div", { className: "prm-tile-list", children: shown.map((pr) => {
      const build = resolveBuildThresholds(
        pr.repo,
        repositories,
        tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
        tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS
      );
      const rev = resolveReviewThresholds(
        pr.repo,
        repositories,
        reviewWarnDays ?? DEFAULT_REVIEW_TIS_WARN_DAYS,
        reviewDangerDays ?? DEFAULT_REVIEW_TIS_DANGER_DAYS
      );
      const repoRec = (repositories ?? []).find(
        (r) => `${r.owner}/${r.repo}`.toLowerCase() === pr.repo.toLowerCase()
      );
      return /* @__PURE__ */ jsx(
        PrTile,
        {
          pr,
          host,
          projects,
          tisWarnHours: build.warnHours,
          tisDangerHours: build.dangerHours,
          reviewWarnDays: rev.warnDays,
          reviewDangerDays: rev.dangerDays,
          sfciGated: repoRec?.sfciGated === true,
          ignoredFailingChecks: repoRec?.ignoredFailingChecks,
          workItemLocatorBase,
          selected: selected.has(pr.url),
          onToggleSelect: toggleSelect,
          onDismiss,
          onProjectAssign
        },
        pr.url
      );
    }) })
  ] });
}

// src/app/PullPrModal.tsx
function PullPrModal({ host, onClose, onPulled }) {
  const [repos, setRepos] = useState([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [repoKey, setRepoKey] = useState("");
  const [number, setNumber] = useState("");
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState(null);
  const numberRef = useRef(null);
  useEffect(() => {
    let alive = true;
    host.call("listRepos").then((res) => {
      if (!alive) return;
      const active = (res?.repos ?? []).filter((r) => r.active && r.connection === "connected");
      setRepos(active);
      if (active.length > 0) setRepoKey(`${active[0].host}|${active[0].owner}/${active[0].repo}`);
      setReposLoaded(true);
    }).catch(() => {
      if (alive) setReposLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [host]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !pulling) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pulling]);
  const selectedRepo = useMemo(
    () => repos.find((r) => `${r.host}|${r.owner}/${r.repo}` === repoKey),
    [repos, repoKey]
  );
  const submit = async () => {
    setError(null);
    const num = Number(number.trim());
    if (!selectedRepo) {
      setError("Select a repository.");
      return;
    }
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a valid PR number.");
      return;
    }
    setPulling(true);
    try {
      const res = await host.call("pullPr", {
        host: selectedRepo.host,
        fullName: `${selectedRepo.owner}/${selectedRepo.repo}`,
        number: num
      });
      if (res?.ok && Array.isArray(res.prs)) {
        onPulled(res.prs);
      } else {
        setError(res?.error || "Failed to pull PR.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
    }
  };
  return /* @__PURE__ */ jsx("div", { className: "modal-backdrop", onClick: () => !pulling && onClose(), children: /* @__PURE__ */ jsxs(
    "div",
    {
      className: "modal prm-modal",
      role: "dialog",
      "aria-modal": true,
      "aria-labelledby": "prm-pull-title",
      onClick: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("header", { className: "prm-modal-header", children: [
          /* @__PURE__ */ jsxs("h3", { id: "prm-pull-title", children: [
            /* @__PURE__ */ jsx(GitPullRequest, { size: 14, "aria-hidden": true }),
            " Add PR"
          ] }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "prm-row-icon-btn", onClick: onClose, title: "Close", children: /* @__PURE__ */ jsx(X, { size: 14 }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-modal-body", children: [
          /* @__PURE__ */ jsx("p", { className: "prm-modal-desc", children: "Import a specific pull request by number." }),
          /* @__PURE__ */ jsxs("label", { className: "prm-field", children: [
            /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "Repository" }),
            reposLoaded && repos.length === 0 ? /* @__PURE__ */ jsx("span", { className: "prm-field-hint", children: "No connected repositories. Connect one in Settings first." }) : /* @__PURE__ */ jsxs(
              "select",
              {
                className: "prm-input prm-input--select",
                value: repoKey,
                onChange: (e) => setRepoKey(e.target.value),
                disabled: pulling || !reposLoaded,
                "aria-label": "Repository",
                children: [
                  !reposLoaded && /* @__PURE__ */ jsx("option", { children: "Loading\u2026" }),
                  repos.map((r) => {
                    const key = `${r.host}|${r.owner}/${r.repo}`;
                    return /* @__PURE__ */ jsxs("option", { value: key, children: [
                      r.owner,
                      "/",
                      r.repo,
                      " (",
                      r.shortHost,
                      ")"
                    ] }, key);
                  })
                ]
              }
            )
          ] }),
          /* @__PURE__ */ jsxs("label", { className: "prm-field", children: [
            /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "PR number" }),
            /* @__PURE__ */ jsx(
              "input",
              {
                ref: numberRef,
                type: "number",
                min: 1,
                value: number,
                placeholder: "e.g. 42",
                className: "prm-input",
                onChange: (e) => {
                  setNumber(e.target.value);
                  if (error) setError(null);
                },
                onKeyDown: (e) => {
                  if (e.key === "Enter" && !pulling) {
                    e.preventDefault();
                    void submit();
                  }
                },
                disabled: pulling || repos.length === 0
              }
            )
          ] }),
          error && /* @__PURE__ */ jsx("div", { className: "prm-modal-error", children: error })
        ] }),
        /* @__PURE__ */ jsxs("footer", { className: "prm-modal-footer", children: [
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: "prm-btn prm-btn--primary",
              onClick: () => void submit(),
              disabled: pulling || repos.length === 0 || !number.trim(),
              title: "Add this PR to the monitored list",
              children: [
                pulling ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : null,
                /* @__PURE__ */ jsx("span", { children: "Add" })
              ]
            }
          ),
          /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn", onClick: onClose, disabled: pulling, title: "Cancel without adding", children: "Cancel" })
        ] })
      ]
    }
  ) });
}

// src/app/SyncFilterMenu.tsx
function SyncFilterMenu({
  anchorRef,
  host,
  selectedRepos,
  onClose,
  onToggleRepo,
  onSelectAll,
  onSync
}) {
  const [pos, setPos] = useState(null);
  const [repos, setRepos] = useState([]);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.right });
  }, [anchorRef]);
  useEffect(() => {
    let alive = true;
    host.call("listRepos").then((res) => {
      if (alive) setRepos((res?.repos ?? []).filter((r) => r.active && r.connection === "connected"));
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, [host]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!pos || typeof document === "undefined") return null;
  const allSelected = selectedRepos.length === 0;
  return portal(
    /* @__PURE__ */ jsxs(Fragment2, { children: [
      /* @__PURE__ */ jsx(
        "div",
        {
          className: "prm-project-menu-backdrop",
          onMouseDown: (e) => {
            e.stopPropagation();
            onClose();
          }
        }
      ),
      /* @__PURE__ */ jsxs(
        "div",
        {
          className: "prm-tile-menu prm-sync-filter",
          style: { position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-100%)" },
          role: "menu",
          children: [
            /* @__PURE__ */ jsxs("div", { className: "prm-sync-filter-header", children: [
              /* @__PURE__ */ jsx("strong", { children: "Sync & Filter" }),
              /* @__PURE__ */ jsx("span", { className: "prm-sync-filter-desc", children: "Filter the list and choose what to sync." })
            ] }),
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: `prm-project-menu-item ${allSelected ? "is-active" : ""}`,
                role: "menuitemcheckbox",
                "aria-checked": allSelected,
                onClick: (e) => {
                  e.stopPropagation();
                  onSelectAll();
                },
                title: "Show and sync all repositories",
                children: [
                  /* @__PURE__ */ jsx("span", { className: "prm-sync-filter-check", children: allSelected && /* @__PURE__ */ jsx(Check, { size: 12 }) }),
                  "All repositories"
                ]
              }
            ),
            repos.map((r) => {
              const fullName = `${r.owner}/${r.repo}`;
              const checked = selectedRepos.includes(fullName);
              return /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  className: `prm-project-menu-item ${checked ? "is-active" : ""}`,
                  role: "menuitemcheckbox",
                  "aria-checked": checked,
                  onClick: (e) => {
                    e.stopPropagation();
                    onToggleRepo(fullName);
                  },
                  title: `Filter/sync ${fullName}`,
                  children: [
                    /* @__PURE__ */ jsx("span", { className: "prm-sync-filter-check", children: checked && /* @__PURE__ */ jsx(Check, { size: 12 }) }),
                    fullName,
                    " ",
                    /* @__PURE__ */ jsxs("span", { className: "prm-sync-filter-host", children: [
                      "(",
                      r.shortHost,
                      ")"
                    ] })
                  ]
                },
                `${r.host}|${fullName}`
              );
            }),
            /* @__PURE__ */ jsx("div", { className: "prm-tile-menu-divider" }),
            /* @__PURE__ */ jsxs("div", { className: "prm-sync-filter-footer", children: [
              /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn prm-btn--sm", onClick: onClose, title: "Close without changing the selection", children: "Close" }),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: "prm-btn prm-btn--sm prm-btn--primary",
                  onClick: () => {
                    onSync(selectedRepos);
                    onClose();
                  },
                  title: allSelected ? "Sync all repositories now" : "Sync the selected repositories now",
                  children: allSelected ? "Sync All" : `Sync ${selectedRepos.length}`
                }
              )
            ] })
          ]
        }
      )
    ] }),
    document.body
  );
}

// src/app/settings/ui.tsx
function AreaHeader({
  title,
  subtitle,
  actions
}) {
  return /* @__PURE__ */ jsxs("header", { className: "prm-area-header", children: [
    /* @__PURE__ */ jsxs("div", { className: "prm-area-heading", children: [
      /* @__PURE__ */ jsx("h3", { children: title }),
      /* @__PURE__ */ jsx("p", { children: subtitle })
    ] }),
    actions && /* @__PURE__ */ jsx("div", { className: "prm-area-actions", children: actions })
  ] });
}
function ConnectionPill({ state }) {
  if (state === "checking") {
    return /* @__PURE__ */ jsxs("span", { className: "prm-conn-pill prm-conn-pill--checking", children: [
      /* @__PURE__ */ jsx(LoaderCircle, { size: 11, className: "prm-spin" }),
      " Checking"
    ] });
  }
  if (state === "connected") {
    return /* @__PURE__ */ jsxs("span", { className: "prm-conn-pill prm-conn-pill--connected", children: [
      /* @__PURE__ */ jsx(CircleCheck, { size: 11 }),
      " Connected"
    ] });
  }
  return /* @__PURE__ */ jsxs("span", { className: "prm-conn-pill prm-conn-pill--disconnected", children: [
    /* @__PURE__ */ jsx(CircleX, { size: 11 }),
    " Disconnected"
  ] });
}
function Dialog({
  title,
  icon,
  onClose,
  busy,
  footer,
  children,
  wide
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  return /* @__PURE__ */ jsx("div", { className: "modal-backdrop", onClick: () => !busy && onClose(), children: /* @__PURE__ */ jsxs(
    "div",
    {
      className: `modal prm-modal${wide ? " prm-modal--wide" : ""}`,
      role: "dialog",
      "aria-modal": true,
      onClick: (e) => e.stopPropagation(),
      children: [
        /* @__PURE__ */ jsxs("header", { className: "prm-modal-header", children: [
          /* @__PURE__ */ jsxs("h3", { children: [
            icon,
            " ",
            title
          ] }),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "prm-row-icon-btn",
              onClick: onClose,
              disabled: busy,
              title: "Close",
              children: /* @__PURE__ */ jsx(X, { size: 14 })
            }
          )
        ] }),
        children
      ]
    }
  ) });
}
function ConfirmDialog({
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger,
  busy,
  onConfirm,
  onCancel
}) {
  return /* @__PURE__ */ jsxs(Dialog, { title, onClose: onCancel, busy, children: [
    /* @__PURE__ */ jsx("div", { className: "prm-modal-body", children: message }),
    /* @__PURE__ */ jsxs("footer", { className: "prm-modal-footer", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn", onClick: onCancel, disabled: busy, children: cancelLabel }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          className: `prm-btn ${danger ? "prm-btn--danger" : "prm-btn--primary"}`,
          onClick: onConfirm,
          disabled: busy,
          children: [
            busy ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : null,
            /* @__PURE__ */ jsx("span", { children: confirmLabel })
          ]
        }
      )
    ] })
  ] });
}

// src/app/settings/OrganizationsArea.tsx
function OrganizationsArea({ host }) {
  const [orgs, setOrgs] = useState(() => {
    const cached = host.cache.get(PREFETCH_ORGS_CACHE_KEY);
    return cached?.ok && Array.isArray(cached.orgs) ? cached.orgs : null;
  });
  const [error, setError] = useState(null);
  const [rediscovering, setRediscovering] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await host.call("listOrgs");
      if (res?.ok && Array.isArray(res.orgs)) {
        setOrgs(res.orgs);
        setError(null);
      } else {
        setOrgs([]);
        if (res?.error) setError(res.error);
      }
    } catch (err) {
      setOrgs([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);
  useEffect(() => {
    void load();
  }, [load]);
  const rediscover = async () => {
    setRediscovering(true);
    setError(null);
    try {
      const res = await host.call("rediscoverOrgs");
      if (!res?.ok && res?.error) setError(res.error);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRediscovering(false);
    }
  };
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await host.call("deleteOrg", {
        host: pendingDelete.host,
        login: pendingDelete.login
      });
      if (!res?.ok && res?.error) {
        host.toast(res.error, "error");
      }
      await load();
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "prm-area", children: [
    /* @__PURE__ */ jsx(
      AreaHeader,
      {
        title: "Organizations",
        subtitle: "This list mirrors the GitHub accounts you are signed into.",
        actions: /* @__PURE__ */ jsxs(Fragment2, { children: [
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: "prm-btn",
              onClick: () => void rediscover(),
              disabled: rediscovering,
              title: "Re-discover organizations from your gh accounts",
              children: [
                rediscovering ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : /* @__PURE__ */ jsx(Sparkles, { size: 13 }),
                /* @__PURE__ */ jsx("span", { children: "Re-discover" })
              ]
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "prm-row-icon-btn",
              onClick: () => setHelpOpen(true),
              title: "How to add or remove organizations",
              "aria-label": "How to add or remove organizations",
              children: /* @__PURE__ */ jsx(CircleQuestionMark, { size: 16 })
            }
          )
        ] })
      }
    ),
    error && /* @__PURE__ */ jsx("div", { className: "prm-error", children: error }),
    orgs === null ? /* @__PURE__ */ jsxs("div", { className: "prm-loading", children: [
      /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "prm-spin" }),
      " Loading organizations\u2026"
    ] }) : orgs.length === 0 ? /* @__PURE__ */ jsxs("div", { className: "prm-area-empty", children: [
      "No organizations found. Sign in with ",
      /* @__PURE__ */ jsx("code", { children: "gh auth login" }),
      ", then Re-discover."
    ] }) : /* @__PURE__ */ jsx("div", { className: "prm-card-list", children: orgs.map((o) => /* @__PURE__ */ jsxs("div", { className: "prm-entity-card", children: [
      /* @__PURE__ */ jsxs("div", { className: "prm-entity-main", children: [
        /* @__PURE__ */ jsxs("div", { className: "prm-entity-title", children: [
          o.login,
          " ",
          /* @__PURE__ */ jsxs("span", { className: "prm-entity-host", children: [
            "(",
            o.shortHost,
            ")"
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "prm-entity-sub", children: o.apiBaseUrl }),
        /* @__PURE__ */ jsxs("div", { className: "prm-entity-sub", children: [
          "Authenticated as ",
          /* @__PURE__ */ jsx("code", { children: o.login })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "prm-entity-side", children: [
        /* @__PURE__ */ jsx(ConnectionPill, { state: rediscovering ? "checking" : o.connection }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "prm-row-icon-btn prm-row-icon-btn--danger",
            onClick: () => setPendingDelete(o),
            title: "Delete organization",
            children: /* @__PURE__ */ jsx(Trash2, { size: 15 })
          }
        )
      ] })
    ] }, `${o.host}|${o.login}`)) }),
    helpOpen && /* @__PURE__ */ jsxs(
      Dialog,
      {
        title: "Adding & removing organizations",
        icon: /* @__PURE__ */ jsx(CircleQuestionMark, { size: 16 }),
        onClose: () => setHelpOpen(false),
        children: [
          /* @__PURE__ */ jsxs("div", { className: "prm-modal-body prm-help-body", children: [
            /* @__PURE__ */ jsxs("p", { children: [
              "PR Monitor does not add organizations directly \u2014 the list mirrors the GitHub accounts the ",
              /* @__PURE__ */ jsx("code", { children: "gh" }),
              " CLI is signed into. To change it:"
            ] }),
            /* @__PURE__ */ jsxs("ul", { children: [
              /* @__PURE__ */ jsxs("li", { children: [
                /* @__PURE__ */ jsx("strong", { children: "Add" }),
                " an account: run ",
                /* @__PURE__ */ jsx("code", { children: "gh auth login" }),
                " in a terminal and follow the prompts."
              ] }),
              /* @__PURE__ */ jsxs("li", { children: [
                /* @__PURE__ */ jsx("strong", { children: "Remove" }),
                " an account: run ",
                /* @__PURE__ */ jsx("code", { children: "gh auth logout" }),
                "."
              ] }),
              /* @__PURE__ */ jsxs("li", { children: [
                "Then click ",
                /* @__PURE__ */ jsx("strong", { children: "Re-discover" }),
                " here to refresh the list."
              ] })
            ] }),
            /* @__PURE__ */ jsxs("p", { children: [
              "Deleting an organization from this screen only removes it (and its repos/PRs) from PR Monitor \u2014 your ",
              /* @__PURE__ */ jsx("code", { children: "gh" }),
              " credentials are left untouched."
            ] })
          ] }),
          /* @__PURE__ */ jsx("footer", { className: "prm-modal-footer", children: /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn prm-btn--primary", onClick: () => setHelpOpen(false), children: /* @__PURE__ */ jsx("span", { children: "Got it" }) }) })
        ]
      }
    ),
    pendingDelete && /* @__PURE__ */ jsx(
      ConfirmDialog,
      {
        title: "Delete organization?",
        danger: true,
        busy: deleting,
        message: /* @__PURE__ */ jsxs(Fragment2, { children: [
          "Delete ",
          /* @__PURE__ */ jsx("strong", { children: pendingDelete.login }),
          " (",
          pendingDelete.shortHost,
          ")? Its connected repositories and their monitored PRs will also be removed from PR Monitor. Your ",
          /* @__PURE__ */ jsx("code", { children: "gh" }),
          " credentials are left untouched."
        ] }),
        confirmLabel: "Delete",
        onConfirm: () => void confirmDelete(),
        onCancel: () => setPendingDelete(null)
      }
    )
  ] });
}

// src/app/settings/RepositoriesArea.tsx
function openExternal(host, url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return;
    host.openExternal(url);
  } catch {
  }
}
function repoWebUrl(r) {
  return `https://${r.host}/${r.owner}/${r.repo}`;
}
async function copyLink(host, text) {
  if (await copyText(text)) {
    host.toast("Link copied", "info");
  } else {
    host.toast("Failed to copy link", "error");
  }
}
function RepositoriesArea({
  host,
  onRepositoriesChanged
}) {
  const [repos, setRepos] = useState(() => {
    const cached = host.cache.get(PREFETCH_REPOS_CACHE_KEY);
    return cached?.ok && Array.isArray(cached.repos) ? cached.repos : null;
  });
  const [orgs, setOrgs] = useState(() => {
    const cached = host.cache.get(PREFETCH_ORGS_CACHE_KEY);
    return cached?.ok && Array.isArray(cached.orgs) ? cached.orgs : [];
  });
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSuggested, setShowSuggested] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [settingsFor, setSettingsFor] = useState(null);
  const [settingsTab, setSettingsTab] = useState("general");
  const [testFor, setTestFor] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(async () => {
    try {
      const [rRes, oRes] = await Promise.all([
        host.call("listRepos"),
        host.call("listOrgs")
      ]);
      if (rRes?.ok && Array.isArray(rRes.repos)) {
        setRepos(rRes.repos);
        setError(null);
      } else {
        setRepos([]);
        if (rRes?.error) setError(rRes.error);
      }
      setOrgs(oRes?.ok && Array.isArray(oRes.orgs) ? oRes.orgs : []);
    } catch (err) {
      setRepos([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);
  useEffect(() => {
    void load();
  }, [load]);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await host.call("deleteRepository", {
        host: pendingDelete.host,
        owner: pendingDelete.owner,
        repo: pendingDelete.repo
      });
      await load();
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "prm-area", children: [
    /* @__PURE__ */ jsx(
      AreaHeader,
      {
        title: "Repositories",
        subtitle: "Manage your connected repositories",
        actions: /* @__PURE__ */ jsxs(Fragment2, { children: [
          /* @__PURE__ */ jsxs("button", { type: "button", className: "prm-btn", onClick: () => setShowSuggested(true), children: [
            /* @__PURE__ */ jsx(Sparkles, { size: 13 }),
            " ",
            /* @__PURE__ */ jsx("span", { children: "Suggested for you" })
          ] }),
          /* @__PURE__ */ jsxs("button", { type: "button", className: "prm-btn", onClick: () => setShowBrowse(true), children: [
            /* @__PURE__ */ jsx(FolderSearch, { size: 13 }),
            " ",
            /* @__PURE__ */ jsx("span", { children: "Browse Repositories" })
          ] }),
          /* @__PURE__ */ jsxs("button", { type: "button", className: "prm-btn prm-btn--primary", onClick: () => setShowAdd(true), children: [
            /* @__PURE__ */ jsx(Plus, { size: 13 }),
            " ",
            /* @__PURE__ */ jsx("span", { children: "Add repository manually" })
          ] })
        ] })
      }
    ),
    error && /* @__PURE__ */ jsx("div", { className: "prm-error", children: error }),
    repos === null ? /* @__PURE__ */ jsxs("div", { className: "prm-loading", children: [
      /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "prm-spin" }),
      " Loading repositories\u2026"
    ] }) : repos.length === 0 ? /* @__PURE__ */ jsxs("div", { className: "prm-area-empty", children: [
      "No repositories connected yet. Use ",
      /* @__PURE__ */ jsx("strong", { children: "Suggested for you" }),
      ",",
      " ",
      /* @__PURE__ */ jsx("strong", { children: "Browse" }),
      ", or ",
      /* @__PURE__ */ jsx("strong", { children: "Add repository manually" }),
      " to get started."
    ] }) : /* @__PURE__ */ jsx("div", { className: "prm-card-list", children: repos.map((r) => /* @__PURE__ */ jsxs("div", { className: "prm-entity-card prm-repo-card", children: [
      /* @__PURE__ */ jsxs("div", { className: "prm-repo-top", children: [
        /* @__PURE__ */ jsxs("div", { className: "prm-entity-title", children: [
          /* @__PURE__ */ jsx(GitBranch, { size: 14, "aria-hidden": true }),
          " ",
          /* @__PURE__ */ jsxs("span", { children: [
            r.owner,
            "/",
            r.repo
          ] }),
          /* @__PURE__ */ jsx("span", { className: `prm-active-badge${r.active ? "" : " prm-active-badge--off"}`, children: r.active ? "Active" : "Inactive" }),
          /* @__PURE__ */ jsx(ConnectionPill, { state: r.connection }),
          (() => {
            const buildP = TIS_PRESETS[r.buildTisPreset ?? r.tisPreset ?? DEFAULT_TIS_PRESET];
            const reviewP = REVIEW_TIS_PRESETS[r.reviewTisPreset ?? DEFAULT_REVIEW_TIS_PRESET];
            return /* @__PURE__ */ jsxs(Fragment2, { children: [
              /* @__PURE__ */ jsxs(
                "span",
                {
                  className: "prm-tis-preset-pill",
                  title: `Build preset \u2014 warns after ${buildP.warnHours}h, behind schedule after ${buildP.dangerHours}h`,
                  children: [
                    /* @__PURE__ */ jsx(Clock, { size: 11, "aria-hidden": true }),
                    "Build: ",
                    buildP.label
                  ]
                }
              ),
              /* @__PURE__ */ jsxs(
                "span",
                {
                  className: "prm-tis-preset-pill",
                  title: `Review preset \u2014 warns after ${reviewP.warnDays}d, behind schedule after ${reviewP.dangerDays}d`,
                  children: [
                    /* @__PURE__ */ jsx(Clock, { size: 11, "aria-hidden": true }),
                    "Review: ",
                    reviewP.label
                  ]
                }
              )
            ] });
          })()
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-repo-quick", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "prm-row-icon-btn prm-tip",
              title: "Open on GitHub",
              "data-tip": "Open on GitHub",
              "aria-label": "Open on GitHub",
              onClick: () => openExternal(host, repoWebUrl(r)),
              children: /* @__PURE__ */ jsx(ExternalLink, { size: 14 })
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "prm-row-icon-btn prm-tip",
              title: "Copy link",
              "data-tip": "Copy link",
              "aria-label": "Copy link",
              onClick: () => void copyLink(host, repoWebUrl(r)),
              children: /* @__PURE__ */ jsx(Link2, { size: 14 })
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "prm-entity-sub prm-repo-meta", children: [
        /* @__PURE__ */ jsxs("span", { children: [
          "Organization: ",
          r.orgLogin,
          " (",
          r.shortHost,
          ")"
        ] }),
        /* @__PURE__ */ jsxs("span", { children: [
          "Created ",
          formatRelative(r.createdAt)
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "prm-repo-actions", children: [
        /* @__PURE__ */ jsxs("button", { type: "button", className: "prm-btn prm-btn--sm", onClick: () => setTestFor(r), children: [
          /* @__PURE__ */ jsx(Wifi, { size: 12 }),
          " ",
          /* @__PURE__ */ jsx("span", { children: "Test Connection" })
        ] }),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "prm-btn prm-btn--sm",
            onClick: () => {
              setSettingsTab("general");
              setSettingsFor(r);
            },
            children: [
              /* @__PURE__ */ jsx(Pen, { size: 12 }),
              " ",
              /* @__PURE__ */ jsx("span", { children: "Edit Repository" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "prm-btn prm-btn--sm",
            onClick: () => {
              setSettingsTab("status");
              setSettingsFor(r);
            },
            title: "Status Settings",
            children: [
              /* @__PURE__ */ jsx(Clock, { size: 12 }),
              " ",
              /* @__PURE__ */ jsx("span", { children: "Status Settings" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "prm-btn prm-btn--sm",
            onClick: () => {
              setSettingsTab("notifications");
              setSettingsFor(r);
            },
            title: "Notification Settings",
            children: [
              /* @__PURE__ */ jsx(Bell, { size: 12 }),
              " ",
              /* @__PURE__ */ jsx("span", { children: "Notification Settings" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "prm-btn prm-btn--sm prm-btn--danger-ghost",
            onClick: () => setPendingDelete(r),
            children: [
              /* @__PURE__ */ jsx(Trash2, { size: 12 }),
              " ",
              /* @__PURE__ */ jsx("span", { children: "Delete Repository" })
            ]
          }
        )
      ] })
    ] }, `${r.host}|${r.owner}/${r.repo}`)) }),
    showAdd && /* @__PURE__ */ jsx(
      AddRepoForm,
      {
        host,
        orgs,
        onClose: () => setShowAdd(false),
        onAdded: async () => {
          setShowAdd(false);
          await load();
        }
      }
    ),
    showSuggested && /* @__PURE__ */ jsx(
      SuggestedDialog,
      {
        host,
        onClose: () => setShowSuggested(false),
        onAdded: async () => {
          await load();
        }
      }
    ),
    showBrowse && /* @__PURE__ */ jsx(
      BrowseDialog,
      {
        host,
        onClose: () => setShowBrowse(false),
        onAdded: async () => {
          await load();
        }
      }
    ),
    settingsFor && /* @__PURE__ */ jsx(
      RepoSettingsDialog,
      {
        host,
        repo: settingsFor,
        orgs,
        initialTab: settingsTab,
        onClose: () => setSettingsFor(null),
        onSaved: async (prs) => {
          setSettingsFor(null);
          if (Array.isArray(prs)) {
            host.cache.set(MONITORED_PRS_CACHE_KEY, prs);
            host.cache.set(MONITORED_COUNT_CACHE_KEY, prs.length);
            host.cache.refreshBadge();
          }
          onRepositoriesChanged?.();
          await load();
        }
      }
    ),
    testFor && /* @__PURE__ */ jsx(
      TestConnectionDialog,
      {
        host,
        repo: testFor,
        onClose: () => setTestFor(null),
        onResult: (ok) => {
          const next = ok ? "connected" : "disconnected";
          setRepos(
            (prev) => (prev ?? []).map(
              (r) => r.host === testFor.host && r.owner === testFor.owner && r.repo === testFor.repo ? { ...r, connection: next } : r
            )
          );
        }
      }
    ),
    pendingDelete && /* @__PURE__ */ jsx(
      ConfirmDialog,
      {
        title: "Delete repository?",
        danger: true,
        busy: deleting,
        message: "Are you sure you want to delete this repository? This will also delete all associated PRs.",
        confirmLabel: "Delete Repository",
        onConfirm: () => void confirmDelete(),
        onCancel: () => setPendingDelete(null)
      }
    )
  ] });
}
function AddRepoForm({
  host,
  orgs,
  onClose,
  onAdded
}) {
  const [ref, setRef] = useState("");
  const [orgKey, setOrgKey] = useState(orgs[0] ? `${orgs[0].host}|${orgs[0].login}` : "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const org = orgs.find((o) => `${o.host}|${o.login}` === orgKey);
    if (!org) {
      setError("Please select an organization.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await host.call("addRepository", {
        ref: ref.trim(),
        host: org.host,
        orgLogin: org.login
      });
      if (res?.ok) onAdded();
      else setError(res?.error || "Failed to add repository.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsxs(Dialog, { title: "Add repository", icon: /* @__PURE__ */ jsx(Plus, { size: 14 }), onClose, busy, children: [
    /* @__PURE__ */ jsxs("div", { className: "prm-modal-body", children: [
      /* @__PURE__ */ jsxs("label", { className: "prm-field", children: [
        /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "Repository" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "text",
            className: "prm-input",
            placeholder: "owner/repo (e.g. my-org/my-repo)",
            value: ref,
            spellCheck: false,
            onChange: (e) => {
              setRef(e.target.value);
              if (error) setError(null);
            },
            onKeyDown: (e) => {
              if (e.key === "Enter" && !busy) {
                e.preventDefault();
                void submit();
              }
            }
          }
        ),
        /* @__PURE__ */ jsx("span", { className: "prm-field-hint", children: "Enter as owner/repo, a full GitHub URL, or an SSH clone URL." })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "prm-field", children: [
        /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "Organization" }),
        /* @__PURE__ */ jsxs(
          "select",
          {
            className: "prm-input prm-input--select",
            value: orgKey,
            onChange: (e) => setOrgKey(e.target.value),
            children: [
              orgs.length === 0 && /* @__PURE__ */ jsx("option", { value: "", children: "No organizations" }),
              orgs.map((o) => /* @__PURE__ */ jsxs("option", { value: `${o.host}|${o.login}`, children: [
                o.login,
                " (",
                o.shortHost,
                ")"
              ] }, `${o.host}|${o.login}`))
            ]
          }
        )
      ] }),
      error && /* @__PURE__ */ jsx("div", { className: "prm-modal-error", children: error })
    ] }),
    /* @__PURE__ */ jsxs("footer", { className: "prm-modal-footer", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn", onClick: onClose, disabled: busy, children: "Cancel" }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          className: "prm-btn prm-btn--primary",
          onClick: () => void submit(),
          disabled: busy || !ref.trim(),
          children: [
            busy ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : null,
            /* @__PURE__ */ jsx("span", { children: "Add Repository" })
          ]
        }
      )
    ] })
  ] });
}
function SuggestedDialog({
  host,
  onClose,
  onAdded
}) {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(/* @__PURE__ */ new Set());
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const scan = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const res = await host.call(
        "suggestRepositories"
      );
      if (res?.ok && Array.isArray(res.repos)) {
        setRows(res.repos);
        setSelected(new Set(res.repos.filter((r) => r.alreadyAdded).map((r) => r.fullName)));
      } else {
        setRows([]);
        if (res?.error) setError(res.error);
      }
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);
  useEffect(() => {
    void scan();
  }, [scan]);
  const toggle = (r) => {
    if (r.alreadyAdded) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r.fullName)) next.delete(r.fullName);
      else next.add(r.fullName);
      return next;
    });
  };
  const addSelected = async () => {
    if (!rows) return;
    const toAdd = rows.filter((r) => !r.alreadyAdded && selected.has(r.fullName));
    if (toAdd.length === 0) return;
    setAdding(true);
    try {
      await host.call("addRepositories", {
        repos: toAdd.map((r) => ({ owner: r.owner, repo: r.repo, host: r.host, orgLogin: r.orgLogin }))
      });
      await onAdded();
      onClose();
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setAdding(false);
    }
  };
  const newCount = rows ? rows.filter((r) => !r.alreadyAdded && selected.has(r.fullName)).length : 0;
  return /* @__PURE__ */ jsxs(Dialog, { title: "Suggested for you", icon: /* @__PURE__ */ jsx(Sparkles, { size: 14 }), onClose, busy: adding, wide: true, children: [
    /* @__PURE__ */ jsxs("div", { className: "prm-modal-body", children: [
      /* @__PURE__ */ jsx("p", { className: "prm-field-hint", style: { marginBottom: "12px" }, children: "Repositories where you authored or reviewed PRs in the last 90 days." }),
      rows === null ? /* @__PURE__ */ jsxs("div", { className: "prm-loading", children: [
        /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "prm-spin" }),
        " Looking at your activity in the last 90 days\u2026"
      ] }) : error ? /* @__PURE__ */ jsx("div", { className: "prm-modal-error", children: error }) : rows.length === 0 ? /* @__PURE__ */ jsxs("div", { className: "prm-area-empty", children: [
        "No repositories found in your last 90 days of activity. To monitor a repository, author or review a pull request in it, then Rescan \u2014 or close this dialog and add repositories manually via",
        " ",
        /* @__PURE__ */ jsx("strong", { children: "Add repository manually" }),
        "."
      ] }) : /* @__PURE__ */ jsx("div", { className: "prm-suggested-list", children: rows.map((r) => /* @__PURE__ */ jsxs("label", { className: "prm-suggested-row", children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "checkbox",
            checked: selected.has(r.fullName),
            disabled: r.alreadyAdded,
            onChange: () => toggle(r)
          }
        ),
        /* @__PURE__ */ jsxs("span", { className: "prm-suggested-main", children: [
          /* @__PURE__ */ jsx("span", { className: "prm-entity-title", children: r.fullName }),
          /* @__PURE__ */ jsxs("span", { className: "prm-entity-sub", children: [
            r.prCount,
            " PRs \xB7 ",
            formatRelative(r.lastActivity)
          ] })
        ] }),
        r.alreadyAdded && /* @__PURE__ */ jsxs("span", { className: "prm-suggested-added", children: [
          /* @__PURE__ */ jsx(CircleCheck, { size: 13 }),
          " Already added"
        ] })
      ] }, r.fullName)) })
    ] }),
    /* @__PURE__ */ jsxs("footer", { className: "prm-modal-footer", children: [
      /* @__PURE__ */ jsxs("button", { type: "button", className: "prm-btn", onClick: () => void scan(), disabled: adding || rows === null, children: [
        /* @__PURE__ */ jsx(Sparkles, { size: 13 }),
        " ",
        /* @__PURE__ */ jsx("span", { children: "Rescan" })
      ] }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn", onClick: onClose, disabled: adding, children: "Cancel" }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          className: "prm-btn prm-btn--primary",
          onClick: () => void addSelected(),
          disabled: adding || newCount === 0,
          children: [
            adding ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : null,
            /* @__PURE__ */ jsx("span", { children: adding ? "Adding\u2026" : newCount > 0 ? `Add ${newCount} Selected` : "Add Selected" })
          ]
        }
      )
    ] })
  ] });
}
function BrowseDialog({
  host,
  onClose,
  onAdded
}) {
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(/* @__PURE__ */ new Set());
  const [collapsed, setCollapsed] = useState(/* @__PURE__ */ new Set());
  const [incompleteOwners, setIncompleteOwners] = useState(/* @__PURE__ */ new Set());
  const [adding, setAdding] = useState(false);
  const loadPage = useCallback(
    async (pageNum, append) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await host.call("listAllRepositories", { page: pageNum });
        const rows = res?.ok && Array.isArray(res.repos) ? res.repos : [];
        setHasMore(!!res?.hasMore);
        setIncompleteOwners(new Set(Array.isArray(res?.incompleteOwners) ? res.incompleteOwners : []));
        setRepos((prev) => {
          if (!append || !prev) return rows;
          const seen = new Set(prev.map((r) => `${r.host}|${r.fullName}`));
          return [...prev, ...rows.filter((r) => !seen.has(`${r.host}|${r.fullName}`))];
        });
        if (res && res.ok === false && res.error) setError(res.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (!append) setRepos([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [host]
  );
  useEffect(() => {
    void loadPage(1, false);
  }, [loadPage]);
  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    void loadPage(next, true);
  };
  const all = repos ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((r) => r.fullName.toLowerCase().includes(q)) : all;
  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleGroup = (owner) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(owner)) next.delete(owner);
      else next.add(owner);
      return next;
    });
  };
  const repoKey = (r) => `${r.host}|${r.fullName}`;
  const groups = (() => {
    const map = /* @__PURE__ */ new Map();
    for (const r of shown) {
      const list2 = map.get(r.owner) ?? [];
      list2.push(r);
      map.set(r.owner, list2);
    }
    return Array.from(map.entries());
  })();
  const addSelected = async () => {
    const toAdd = shown.filter((r) => !r.alreadyAdded && selected.has(repoKey(r)));
    if (toAdd.length === 0) return;
    setAdding(true);
    try {
      await host.call("addRepositories", {
        repos: toAdd.map((r) => ({ owner: r.owner, repo: r.repo, host: r.host, orgLogin: r.owner }))
      });
      await onAdded();
      onClose();
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setAdding(false);
    }
  };
  const selectedCount = shown.filter((r) => !r.alreadyAdded && selected.has(repoKey(r))).length;
  return /* @__PURE__ */ jsxs(
    Dialog,
    {
      title: "Browse Repositories",
      icon: /* @__PURE__ */ jsx(FolderSearch, { size: 14 }),
      onClose,
      busy: adding,
      wide: true,
      children: [
        /* @__PURE__ */ jsxs("div", { className: "prm-modal-body", children: [
          /* @__PURE__ */ jsx("div", { className: "prm-browse-controls", children: /* @__PURE__ */ jsx(
            "input",
            {
              type: "text",
              className: "prm-input",
              placeholder: "Filter repositories across all your organizations\u2026",
              value: query,
              spellCheck: false,
              autoFocus: true,
              onChange: (e) => setQuery(e.target.value)
            }
          ) }),
          error && /* @__PURE__ */ jsx("div", { className: "prm-modal-error", children: error }),
          loading ? /* @__PURE__ */ jsxs("div", { className: "prm-loading", children: [
            /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "prm-spin" }),
            " Loading repositories\u2026"
          ] }) : /* @__PURE__ */ jsxs("div", { className: "prm-browse-list", children: [
            groups.map(([owner, rows]) => {
              const open = !collapsed.has(owner);
              return /* @__PURE__ */ jsxs("div", { className: "prm-browse-group", children: [
                /* @__PURE__ */ jsxs(
                  "button",
                  {
                    type: "button",
                    className: "prm-browse-group-header",
                    onClick: () => toggleGroup(owner),
                    "aria-expanded": open,
                    children: [
                      /* @__PURE__ */ jsx(
                        ChevronRight,
                        {
                          size: 13,
                          className: `prm-disclosure${open ? " is-open" : ""}`,
                          "aria-hidden": true
                        }
                      ),
                      /* @__PURE__ */ jsx("span", { className: "prm-browse-group-name", children: owner }),
                      /* @__PURE__ */ jsxs(
                        "span",
                        {
                          className: "prm-browse-group-count",
                          title: !q && incompleteOwners.has(owner) ? `${rows.length} loaded \u2014 more available, use Load more` : void 0,
                          children: [
                            "(",
                            rows.length,
                            !q && incompleteOwners.has(owner) ? "\u2026" : "",
                            ")"
                          ]
                        }
                      )
                    ]
                  }
                ),
                open && rows.map(
                  (r) => r.alreadyAdded ? /* @__PURE__ */ jsxs("div", { className: "prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added", children: [
                    /* @__PURE__ */ jsxs("span", { children: [
                      /* @__PURE__ */ jsx(GitBranch, { size: 13, "aria-hidden": true }),
                      " ",
                      r.fullName,
                      r.isPrivate && /* @__PURE__ */ jsx("span", { className: "prm-added-tag", children: " \xB7 private" })
                    ] }),
                    /* @__PURE__ */ jsxs("span", { className: "prm-conn-pill prm-conn-pill--connected", children: [
                      /* @__PURE__ */ jsx(CircleCheck, { size: 11, "aria-hidden": true }),
                      " Connected"
                    ] })
                  ] }, repoKey(r)) : /* @__PURE__ */ jsxs("label", { className: "prm-checkbox-row prm-browse-repo-row", children: [
                    /* @__PURE__ */ jsx(
                      "input",
                      {
                        type: "checkbox",
                        checked: selected.has(repoKey(r)),
                        onChange: () => toggle(repoKey(r))
                      }
                    ),
                    /* @__PURE__ */ jsxs("span", { children: [
                      /* @__PURE__ */ jsx(GitBranch, { size: 13, "aria-hidden": true }),
                      " ",
                      r.fullName,
                      r.isPrivate && /* @__PURE__ */ jsx("span", { className: "prm-added-tag", children: " \xB7 private" })
                    ] })
                  ] }, repoKey(r))
                )
              ] }, owner);
            }),
            shown.length === 0 && /* @__PURE__ */ jsx("div", { className: "prm-area-empty", children: q ? "No repositories match your filter." : "No repositories found." }),
            hasMore && !q && /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: "prm-btn prm-browse-load-more",
                onClick: loadMore,
                disabled: loadingMore,
                children: [
                  loadingMore ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : null,
                  /* @__PURE__ */ jsx("span", { children: loadingMore ? "Loading\u2026" : "Load more" })
                ]
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxs("footer", { className: "prm-modal-footer", children: [
          /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn", onClick: onClose, disabled: adding, children: "Cancel" }),
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: "prm-btn prm-btn--primary",
              onClick: () => void addSelected(),
              disabled: adding || selectedCount === 0,
              children: [
                adding ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : null,
                /* @__PURE__ */ jsx("span", { children: selectedCount > 0 ? `Add ${selectedCount} Selected` : "Add Selected" })
              ]
            }
          )
        ] })
      ]
    }
  );
}
function RepoSettingsDialog({
  host,
  repo,
  orgs,
  initialTab = "general",
  onClose,
  onSaved
}) {
  const [tab, setTab] = useState(initialTab);
  const [ref, setRef] = useState(`${repo.owner}/${repo.repo}`);
  const [orgLogin, setOrgLogin] = useState(repo.orgLogin);
  const [active, setActive] = useState(repo.active);
  const [buildTisPreset, setBuildTisPreset] = useState(
    repo.buildTisPreset ?? repo.tisPreset ?? DEFAULT_TIS_PRESET
  );
  const [reviewTisPreset, setReviewTisPreset] = useState(
    repo.reviewTisPreset ?? DEFAULT_REVIEW_TIS_PRESET
  );
  const [sfciGated, setSfciGated] = useState(repo.sfciGated === true);
  const [ignoreSnyk, setIgnoreSnyk] = useState(
    (repo.ignoredFailingChecks ?? []).some((e) => e.toLowerCase().includes("snyk"))
  );
  const [notifyInApp, setNotifyInApp] = useState(repo.notifyInApp ?? true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const orgsOnHost = orgs.filter((o) => o.host === repo.host);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await host.call("updateRepository", {
        key: { host: repo.host, owner: repo.owner, repo: repo.repo },
        ref: ref.trim(),
        orgLogin,
        active,
        buildTisPreset,
        reviewTisPreset,
        sfciGated,
        ignoredFailingChecks: ignoreSnyk ? ["Snyk"] : [],
        notifyInApp
      });
      if (res?.ok) onSaved(res.prs);
      else setError(res?.error || "Failed to save settings.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsxs(
    Dialog,
    {
      title: /* @__PURE__ */ jsxs("span", { className: "prm-dialog-title", children: [
        "Repository Settings ",
        /* @__PURE__ */ jsxs("span", { className: "prm-entity-sub", children: [
          repo.owner,
          "/",
          repo.repo
        ] })
      ] }),
      icon: /* @__PURE__ */ jsx(Pen, { size: 14 }),
      onClose,
      busy,
      children: [
        /* @__PURE__ */ jsxs("nav", { className: "prm-dialog-tabs", children: [
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: `prm-dialog-tab${tab === "general" ? " active" : ""}`,
              onClick: () => setTab("general"),
              children: [
                /* @__PURE__ */ jsx(Pen, { size: 12 }),
                " General"
              ]
            }
          ),
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: `prm-dialog-tab${tab === "status" ? " active" : ""}`,
              onClick: () => setTab("status"),
              children: [
                /* @__PURE__ */ jsx(Clock, { size: 12 }),
                " Status"
              ]
            }
          ),
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: `prm-dialog-tab${tab === "notifications" ? " active" : ""}`,
              onClick: () => setTab("notifications"),
              children: [
                /* @__PURE__ */ jsx(Bell, { size: 12 }),
                " Notifications"
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-modal-body", children: [
          tab === "general" ? /* @__PURE__ */ jsxs(Fragment2, { children: [
            /* @__PURE__ */ jsxs("label", { className: "prm-checkbox-row", children: [
              /* @__PURE__ */ jsx("input", { type: "checkbox", checked: active, onChange: (e) => setActive(e.target.checked) }),
              /* @__PURE__ */ jsxs("span", { children: [
                /* @__PURE__ */ jsx("strong", { children: "Repository is active" }),
                /* @__PURE__ */ jsx("small", { children: "Inactive repositories won't surface new PRs." })
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "prm-field", children: [
              /* @__PURE__ */ jsx("span", { className: "prm-field-label prm-field-label--strong", children: "Repository" }),
              /* @__PURE__ */ jsx("span", { className: "prm-field-hint", children: "Format: owner/repo (e.g., facebook/react)" }),
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "text",
                  className: "prm-input",
                  value: ref,
                  spellCheck: false,
                  onChange: (e) => setRef(e.target.value)
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "prm-field", children: [
              /* @__PURE__ */ jsx("span", { className: "prm-field-label prm-field-label--strong", children: "Organization" }),
              /* @__PURE__ */ jsx("span", { className: "prm-field-hint", children: "The GitHub account this repository belongs to." }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  className: "prm-input prm-input--select",
                  value: orgLogin,
                  onChange: (e) => setOrgLogin(e.target.value),
                  children: orgsOnHost.map((o) => /* @__PURE__ */ jsxs("option", { value: o.login, children: [
                    o.login,
                    " (",
                    o.shortHost,
                    ")"
                  ] }, o.login))
                }
              )
            ] })
          ] }) : tab === "status" ? /* @__PURE__ */ jsxs(Fragment2, { children: [
            /* @__PURE__ */ jsxs("label", { className: "prm-field", children: [
              /* @__PURE__ */ jsx("span", { className: "prm-field-label prm-field-label--strong", children: "Build-phase preset" }),
              /* @__PURE__ */ jsx("span", { className: "prm-field-hint", children: "Jenkins/CI time before the build pill is considered stalled (hours)." }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  className: "prm-input prm-input--select",
                  value: buildTisPreset,
                  onChange: (e) => setBuildTisPreset(e.target.value),
                  children: Object.values(TIS_PRESETS).map((p) => /* @__PURE__ */ jsxs("option", { value: p.id, children: [
                    p.label,
                    " (",
                    p.warnHours,
                    "h / ",
                    p.dangerHours,
                    "h)"
                  ] }, p.id))
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "prm-field", children: [
              /* @__PURE__ */ jsx("span", { className: "prm-field-label prm-field-label--strong", children: "Review-phase preset" }),
              /* @__PURE__ */ jsx("span", { className: "prm-field-hint", children: "Review wait before the review pill is considered stalled (days). Drafts are excluded." }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  className: "prm-input prm-input--select",
                  value: reviewTisPreset,
                  onChange: (e) => setReviewTisPreset(e.target.value),
                  children: Object.values(REVIEW_TIS_PRESETS).map((p) => /* @__PURE__ */ jsxs("option", { value: p.id, children: [
                    p.label,
                    " (",
                    p.warnDays,
                    "d / ",
                    p.dangerDays,
                    "d)"
                  ] }, p.id))
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "prm-checkbox-row", children: [
              /* @__PURE__ */ jsx("input", { type: "checkbox", checked: sfciGated, onChange: (e) => setSfciGated(e.target.checked) }),
              /* @__PURE__ */ jsxs("span", { children: [
                /* @__PURE__ */ jsx("strong", { children: "SFCI Gated Repo" }),
                /* @__PURE__ */ jsx("small", { children: "Build + merge run through the tok-gimlet SFCI job with manual action steps. A build only stalls after the SFCI-job comment appears; merge-stall reflects the pending action." })
              ] })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "prm-checkbox-row", children: [
              /* @__PURE__ */ jsx("input", { type: "checkbox", checked: ignoreSnyk, onChange: (e) => setIgnoreSnyk(e.target.checked) }),
              /* @__PURE__ */ jsxs("span", { children: [
                /* @__PURE__ */ jsx("strong", { children: "Ignore Snyk failures for build status" }),
                /* @__PURE__ */ jsx("small", { children: 'A failing "Snyk" check counts as passing for build/merge status only. The status badge still shows Failing.' })
              ] })
            ] })
          ] }) : /* @__PURE__ */ jsxs("label", { className: "prm-checkbox-row", children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "checkbox",
                checked: notifyInApp,
                onChange: (e) => setNotifyInApp(e.target.checked)
              }
            ),
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx("strong", { children: "In-app notifications" }),
              /* @__PURE__ */ jsx("small", { children: "Show notifications for status changes on this repository." })
            ] })
          ] }),
          error && /* @__PURE__ */ jsx("div", { className: "prm-modal-error", children: error })
        ] }),
        /* @__PURE__ */ jsxs("footer", { className: "prm-modal-footer", children: [
          /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn", onClick: onClose, disabled: busy, children: "Cancel" }),
          /* @__PURE__ */ jsxs("button", { type: "button", className: "prm-btn prm-btn--primary", onClick: () => void save(), disabled: busy, children: [
            busy ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : null,
            /* @__PURE__ */ jsx("span", { children: "Save Settings" })
          ] })
        ] })
      ]
    }
  );
}
function TestConnectionDialog({
  host,
  repo,
  onClose,
  onResult
}) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await host.call("testRepository", {
          host: repo.host,
          owner: repo.owner,
          repo: repo.repo
        });
        const settled = res ?? { ok: false, error: "No response" };
        if (alive) {
          setResult(settled);
          onResult?.(settled.ok);
        }
      } catch (err) {
        if (alive) {
          setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
          onResult?.(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [host, repo]);
  return /* @__PURE__ */ jsxs(
    Dialog,
    {
      title: `Connection Test Results: ${repo.owner}/${repo.repo}`,
      icon: /* @__PURE__ */ jsx(Wifi, { size: 14 }),
      onClose,
      children: [
        /* @__PURE__ */ jsx("div", { className: "prm-modal-body", children: result === null ? /* @__PURE__ */ jsxs("div", { className: "prm-loading", children: [
          /* @__PURE__ */ jsx(Wifi, { size: 14, className: "prm-spin" }),
          " Testing connection\u2026"
        ] }) : result.ok ? /* @__PURE__ */ jsxs("div", { className: "prm-test-result prm-test-result--ok", children: [
          /* @__PURE__ */ jsx(CircleCheck, { size: 16 }),
          " All connection tests passed."
        ] }) : /* @__PURE__ */ jsxs("div", { className: "prm-test-result prm-test-result--fail", children: [
          /* @__PURE__ */ jsx(CircleX, { size: 16 }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("div", { children: result.error || "Connection failed." }),
            /* @__PURE__ */ jsxs("div", { className: "prm-field-hint", children: [
              "Try ",
              /* @__PURE__ */ jsxs("code", { children: [
                "gh auth login ",
                repo.host
              ] }),
              " in a terminal, then test again."
            ] })
          ] })
        ] }) }),
        /* @__PURE__ */ jsx("footer", { className: "prm-modal-footer", children: /* @__PURE__ */ jsx("button", { type: "button", className: "prm-btn", onClick: onClose, children: "Close" }) })
      ]
    }
  );
}

// src/app/settings/AuthorArea.tsx
function initialsOf2(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function AuthorArea({ host }) {
  const [author, setAuthor] = useState(() => {
    const cached = host.cache.get(PREFETCH_AUTHOR_CACHE_KEY);
    return cached?.ok ? cached.author ?? null : void 0;
  });
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await host.call("getAuthor");
      if (res?.ok) {
        setAuthor(res.author ?? null);
        setError(null);
      } else {
        setAuthor(null);
        if (res?.error) setError(res.error);
      }
    } catch (err) {
      setAuthor(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);
  useEffect(() => {
    void load();
  }, [load]);
  const displayName = author?.name || author?.login || "";
  return /* @__PURE__ */ jsxs("div", { className: "prm-area", children: [
    /* @__PURE__ */ jsx(AreaHeader, { title: "Author", subtitle: "Monitored Author and how to identify per organization" }),
    error && /* @__PURE__ */ jsx("div", { className: "prm-error", children: error }),
    author === void 0 ? /* @__PURE__ */ jsxs("div", { className: "prm-loading", children: [
      /* @__PURE__ */ jsx(LoaderCircle, { size: 14, className: "prm-spin" }),
      " Loading author\u2026"
    ] }) : author === null ? /* @__PURE__ */ jsxs("div", { className: "prm-area-empty", children: [
      "No authenticated author. Sign in with ",
      /* @__PURE__ */ jsx("code", { children: "gh auth login" }),
      ", then Re-discover from Organizations."
    ] }) : /* @__PURE__ */ jsx("div", { className: "prm-card-list", children: /* @__PURE__ */ jsxs("div", { className: "prm-entity-card prm-author-card", children: [
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          className: "prm-author-row",
          onClick: () => setExpanded((v) => !v),
          "aria-expanded": expanded,
          children: [
            /* @__PURE__ */ jsx("span", { className: "prm-avatar prm-avatar--initials", "aria-hidden": true, children: initialsOf2(displayName) }),
            /* @__PURE__ */ jsxs("span", { className: "prm-author-id", children: [
              /* @__PURE__ */ jsx("span", { className: "prm-entity-title", children: displayName }),
              author.email && /* @__PURE__ */ jsx("span", { className: "prm-entity-sub", children: author.email })
            ] }),
            /* @__PURE__ */ jsx(
              ChevronRight,
              {
                size: 16,
                className: `prm-disclosure${expanded ? " is-open" : ""}`,
                "aria-hidden": true
              }
            )
          ]
        }
      ),
      expanded && /* @__PURE__ */ jsxs("div", { className: "prm-author-detail", children: [
        /* @__PURE__ */ jsxs("div", { className: "prm-kv", children: [
          /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "Display Name" }),
          /* @__PURE__ */ jsx("span", { children: displayName || "\u2014" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-kv", children: [
          /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "Email" }),
          /* @__PURE__ */ jsx("span", { children: author.email || "\u2014" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-kv", children: [
          /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "GitHub Identities" }),
          /* @__PURE__ */ jsx("div", { className: "prm-identity-list", children: author.identities.map((id) => /* @__PURE__ */ jsxs("div", { className: "prm-identity-row", children: [
            /* @__PURE__ */ jsxs("span", { children: [
              id.login,
              " ",
              /* @__PURE__ */ jsxs("span", { className: "prm-entity-host", children: [
                "(",
                id.shortHost,
                ")"
              ] })
            ] }),
            id.connection === "connected" ? /* @__PURE__ */ jsx(CircleCheck, { size: 13, className: "prm-identity-verified", "aria-label": "Verified" }) : (
              // AC-PPL-4.3: a host whose gh auth is missing/invalid gets the
              // Disconnected treatment (R-ORG-005) rather than the verified check.
              /* @__PURE__ */ jsxs("span", { className: "prm-identity-disconnected", "aria-label": "Disconnected", children: [
                /* @__PURE__ */ jsx(CircleX, { size: 13 }),
                " Disconnected"
              ] })
            )
          ] }, `${id.host}|${id.login}`)) })
        ] })
      ] })
    ] }) })
  ] });
}

// src/app/settings/NotificationsArea.tsx
function NotificationsArea({
  settings,
  update
}) {
  const inApp = settings.notifyInApp ?? settings.notifyOnChange;
  return /* @__PURE__ */ jsxs("div", { className: "prm-area", children: [
    /* @__PURE__ */ jsx(AreaHeader, { title: "Notifications", subtitle: "How to be notified when pull request status changes" }),
    /* @__PURE__ */ jsxs("label", { className: "prm-checkbox-row", children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "checkbox",
          checked: inApp,
          onChange: (e) => update({ notifyInApp: e.target.checked, notifyOnChange: e.target.checked })
        }
      ),
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx("strong", { children: "In-app notifications" }),
        /* @__PURE__ */ jsx("small", { children: "Show a notification when a monitored PR changes status. Master switch \u2014 a repo or PR can still mute below this." })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "prm-checkbox-row", children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "checkbox",
          checked: settings.sendToInbox ?? false,
          onChange: (e) => update({ sendToInbox: e.target.checked })
        }
      ),
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx("strong", { children: "Send to Inbox" }),
        /* @__PURE__ */ jsx("small", { children: "Also push status changes to your project Inbox. Requires the PR to be associated with a Project." })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "prm-subsection", children: [
      /* @__PURE__ */ jsx("h4", { className: "prm-subsection-title", children: "Sidebar badge" }),
      /* @__PURE__ */ jsxs("label", { className: "prm-radio-row", children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "radio",
            name: "prm-badge",
            checked: settings.badgeMode === "unread",
            onChange: () => update({ badgeMode: "unread" })
          }
        ),
        /* @__PURE__ */ jsxs("span", { children: [
          /* @__PURE__ */ jsx("strong", { children: "Unread changes" }),
          /* @__PURE__ */ jsx("small", { children: "Counts PRs with an unseen status change since you last viewed them." })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "prm-radio-row", children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "radio",
            name: "prm-badge",
            checked: settings.badgeMode === "total",
            onChange: () => update({ badgeMode: "total" })
          }
        ),
        /* @__PURE__ */ jsxs("span", { children: [
          /* @__PURE__ */ jsx("strong", { children: "Total count" }),
          /* @__PURE__ */ jsx("small", { children: "Counts every monitored PR, read or unread." })
        ] })
      ] })
    ] })
  ] });
}

// src/app/settings/SystemArea.tsx
var INTERVAL_OPTIONS = [
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 120, label: "Every 2 hours" }
];
var MIN_INTERVAL = 15;
function clockOf(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function countdownTo(ms, now) {
  const diff = Math.max(0, ms - now);
  const mins = Math.round(diff / 6e4);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}
function SystemArea({
  settings,
  update,
  host
}) {
  const [prs, setPrs] = useState(
    () => host.cache.get(MONITORED_PRS_CACHE_KEY) ?? []
  );
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = host.cache.get(MONITORED_PRS_CACHE_KEY);
      if (next) setPrs((prev) => prev === next ? prev : next);
      setNow(Date.now());
    }, 1e3);
    return () => window.clearInterval(id);
  }, [host]);
  const autoSyncEnabled = settings.autoSyncEnabled ?? true;
  const interval = INTERVAL_OPTIONS.some((o) => o.value === settings.pollIntervalMinutes) ? settings.pollIntervalMinutes : MIN_INTERVAL;
  const lastSync = prs.reduce((max, p) => Math.max(max, p.lastChecked || 0), 0);
  const nextSync = autoSyncEnabled && lastSync ? lastSync + interval * 6e4 : 0;
  const repoCount = new Set(prs.map((p) => p.repo)).size;
  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await host.call("pollAll");
      if (res?.ok && Array.isArray(res.prs)) {
        setPrs(res.prs);
        host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
      }
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSyncing(false);
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "prm-area", children: [
    /* @__PURE__ */ jsx(
      AreaHeader,
      {
        title: "Auto-Sync Scheduling",
        subtitle: "Automatically sync PRs from all repositories on a schedule"
      }
    ),
    /* @__PURE__ */ jsxs("label", { className: "prm-checkbox-row", children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "checkbox",
          checked: autoSyncEnabled,
          onChange: (e) => update({ autoSyncEnabled: e.target.checked })
        }
      ),
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx("strong", { children: "Enable Auto-Sync" }),
        /* @__PURE__ */ jsx("small", { children: "Automatically check all repositories for new PRs and sync statuses." })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "prm-field", children: [
      /* @__PURE__ */ jsx("label", { className: "prm-field-label", children: "Sync Interval" }),
      /* @__PURE__ */ jsx(
        "select",
        {
          className: "prm-input prm-input--select",
          value: interval,
          onChange: (e) => {
            const raw = Number(e.target.value);
            if (Number.isFinite(raw)) update({ pollIntervalMinutes: raw });
          },
          children: INTERVAL_OPTIONS.map((o) => /* @__PURE__ */ jsx("option", { value: o.value, children: o.label }, o.value))
        }
      ),
      /* @__PURE__ */ jsx("span", { className: "prm-field-hint", children: "How often to check all active repositories for new pull requests." })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "prm-subsection", children: [
      /* @__PURE__ */ jsx("h4", { className: "prm-subsection-title", children: "Sync Status" }),
      /* @__PURE__ */ jsxs("div", { className: "prm-sync-status", children: [
        /* @__PURE__ */ jsxs("div", { className: "prm-kv", children: [
          /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "Next sync" }),
          /* @__PURE__ */ jsx("span", { children: nextSync ? /* @__PURE__ */ jsxs(Fragment2, { children: [
            countdownTo(nextSync, now),
            " ",
            /* @__PURE__ */ jsxs("span", { className: "prm-field-hint", children: [
              "\xB7 ",
              clockOf(nextSync)
            ] })
          ] }) : "\u2014" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-kv", children: [
          /* @__PURE__ */ jsx("span", { className: "prm-field-label", children: "Last sync" }),
          /* @__PURE__ */ jsx("span", { children: lastSync ? /* @__PURE__ */ jsxs(Fragment2, { children: [
            formatRelative(lastSync),
            " ",
            /* @__PURE__ */ jsxs("span", { className: "prm-field-hint", children: [
              "\xB7 ",
              clockOf(lastSync)
            ] })
          ] }) : "" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-sync-counts", children: [
          /* @__PURE__ */ jsxs("span", { className: "prm-sync-count", children: [
            /* @__PURE__ */ jsx("strong", { children: repoCount }),
            " repositories checked"
          ] }),
          /* @__PURE__ */ jsxs("span", { className: "prm-sync-count", children: [
            /* @__PURE__ */ jsx("strong", { children: prs.length }),
            " monitored PRs"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          className: "prm-btn prm-btn--primary prm-btn--inline",
          onClick: () => void syncNow(),
          disabled: syncing,
          children: [
            syncing ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : /* @__PURE__ */ jsx(RefreshCw, { size: 13 }),
            /* @__PURE__ */ jsx("span", { children: "Sync All Now" })
          ]
        }
      )
    ] })
  ] });
}

// src/app/SettingsView.tsx
var NAV_GROUPS = [
  {
    label: "GITHUB",
    items: [
      { id: "organizations", label: "Organizations", icon: Building2 },
      { id: "repositories", label: "Repositories", icon: BookMarked },
      { id: "author", label: "Author", icon: Users }
    ]
  },
  {
    label: "CONFIGURATION",
    items: [{ id: "notifications", label: "Notifications", icon: Bell }]
  },
  {
    label: "SYSTEM",
    items: [{ id: "system", label: "System", icon: Wrench }]
  }
];
function SettingsView({ settings, onSave, onRepositoriesChanged, host }) {
  const [active, setActive] = useState(
    settings.settingsActiveNav ?? DEFAULT_SETTINGS_NAV
  );
  const update = (patch) => {
    const next = { ...settings, ...patch };
    onSave(next);
    host.cache.set("settings", next);
    host.cache.refreshBadge();
  };
  const select = (id) => {
    setActive(id);
    update({ settingsActiveNav: id });
  };
  return /* @__PURE__ */ jsx("div", { className: "prm-settings-shell", children: /* @__PURE__ */ jsxs("div", { className: "prm-settings-body", children: [
    /* @__PURE__ */ jsx("nav", { className: "prm-settings-nav", "aria-label": "Settings sections", children: NAV_GROUPS.map((group) => /* @__PURE__ */ jsxs("div", { className: "prm-nav-group", children: [
      /* @__PURE__ */ jsx("div", { className: "prm-nav-group-label", children: group.label }),
      group.items.map((item) => {
        const Icon2 = item.icon;
        return /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: `prm-nav-row${active === item.id ? " active" : ""}`,
            "aria-current": active === item.id,
            onClick: () => select(item.id),
            children: [
              /* @__PURE__ */ jsx(Icon2, { size: 15, "aria-hidden": true }),
              /* @__PURE__ */ jsx("span", { children: item.label })
            ]
          },
          item.id
        );
      })
    ] }, group.label)) }),
    /* @__PURE__ */ jsxs("div", { className: "prm-settings-pane", children: [
      active === "organizations" && /* @__PURE__ */ jsx(OrganizationsArea, { host }),
      active === "repositories" && /* @__PURE__ */ jsx(RepositoriesArea, { host, onRepositoriesChanged }),
      active === "author" && /* @__PURE__ */ jsx(AuthorArea, { host }),
      active === "notifications" && /* @__PURE__ */ jsx(NotificationsArea, { settings, update }),
      active === "system" && /* @__PURE__ */ jsx(SystemArea, { settings, update, host })
    ] })
  ] }) });
}

// src/app/syncClue.ts
function list(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
function plural(n, one, many) {
  return n === 1 ? one : many;
}
function deriveSyncClue(health) {
  if (!health) return null;
  const disconnected = health.disconnectedHosts ?? [];
  const remoteGone = health.remoteGone ?? [];
  const outage = health.outageHosts ?? [];
  if (disconnected.length > 0) {
    return {
      kind: "disconnect",
      subjects: disconnected,
      action: "settings",
      message: `GitHub sign-in expired for ${list(disconnected)} \u2014 re-authenticate to resume syncing.`
    };
  }
  if (remoteGone.length > 0) {
    return {
      kind: "remote-gone",
      subjects: remoteGone,
      action: "resolve",
      message: `${remoteGone.length} ${plural(remoteGone.length, "repository is", "repositories are")} no longer reachable on GitHub.`
    };
  }
  if (outage.length > 0) {
    return {
      kind: "outage",
      subjects: outage,
      action: "none",
      message: `GitHub ${plural(outage.length, "is", "is")} temporarily unreachable for ${list(outage)} \u2014 retrying automatically.`
    };
  }
  return null;
}

// lib/notify.ts
function repoFor(pr, repositories) {
  const key = (pr.repo ?? "").toLowerCase();
  if (!key) return void 0;
  return (repositories ?? []).find(
    (r) => `${r.owner}/${r.repo}`.toLowerCase() === key
  );
}
function computeNotifyDelivery(pr, settings) {
  const repo = repoFor(pr, settings.repositories);
  const repoNotMuted = repo ? repo.notifyInApp !== false : true;
  const notificationWorthy = repoNotMuted && !pr.muted;
  if (!notificationWorthy) return { inApp: false, inbox: false };
  const globalInApp = settings.notifyInApp ?? settings.notifyOnChange ?? false;
  const globalInbox = settings.sendToInbox ?? false;
  return {
    inApp: globalInApp,
    inbox: globalInbox && !!pr.projectId
  };
}

// src/app/PrMonitorBackground.tsx
function escapeMarkdownText(s) {
  return s.replace(/[\\`*_[\]]/g, "\\$&").replace(/\r?\n/g, " ").trim();
}
function safeMarkdownUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  } catch {
    return "";
  }
  return url.replace(/[)\s]/g, encodeURIComponent);
}
async function deliverNotifications(host, deltas, settings) {
  for (const d of deltas) {
    const worsened = statusPriority(d.newStatus) > statusPriority(d.oldStatus);
    const interestingDirection = d.newStatus === "failed" || d.newStatus === "conflict" || d.newStatus === "yellow" || d.newStatus === "green" || d.newStatus === "closed-merged" || d.newStatus === "closed-abandoned" || worsened;
    if (!interestingDirection) continue;
    const delivery = computeNotifyDelivery(d.pr, settings);
    if (!delivery.inApp && !delivery.inbox) continue;
    const repo = escapeMarkdownText(d.pr.repo);
    const title = escapeMarkdownText(d.pr.title);
    const href = safeMarkdownUrl(d.pr.url);
    const titleLine = href ? `[${title}](${href})` : title;
    if (delivery.inApp) {
      host.toast(
        `${d.pr.repo}#${d.pr.number}: ${statusLabel(d.oldStatus)} \u2192 ${statusLabel(d.newStatus)}`,
        "info"
      );
    }
    if (delivery.inbox && d.pr.projectId) {
      const md = `**${repo}#${d.pr.number}** \u2014 ${statusLabel(d.oldStatus)} \u2192 **${statusLabel(d.newStatus)}**

${titleLine}`;
      try {
        await host.pushInbox({ comments: md, projectId: d.pr.projectId });
      } catch {
        host.toast(
          `PR Monitor: couldn't post inbox notification for ${d.pr.repo}#${d.pr.number}`,
          "error"
        );
      }
    }
  }
}

// src/app/PrMonitorPanel.tsx
var STORAGE_TAB_KEY = "activeSubTab";
var STORAGE_SORT_KEY = "listSort";
var STORAGE_HOST_SCOPE_KEY = "hostScope";
var STORAGE_VIEW_KEY = "listView";
function PrMonitorPanel({ host }) {
  const [settings, setSettings] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [prs, setPrs] = useState(
    () => host.cache.get(MONITORED_PRS_CACHE_KEY) ?? []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [subTab, setSubTab] = useState("prs");
  const [hydrated, setHydrated] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [syncFilterOpen, setSyncFilterOpen] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [repoScope, setRepoScope] = useState([]);
  const [sortField, setSortField] = useState("status");
  const [sortDir, setSortDir] = useState("asc");
  const [hostScope, setHostScope] = useState([]);
  const [viewMode, setViewMode] = useState("board");
  const [firstSyncDone, setFirstSyncDone] = useState(false);
  const [syncHealth, setSyncHealth] = useState(() => ({ ...EMPTY_SYNC_HEALTH }));
  const syncBtnRef = useRef(null);
  const [projects, setProjects] = useState(() => host.listProjects());
  useEffect(() => {
    let alive = true;
    Promise.all([
      host.storage.get(SETTINGS_STORAGE_KEY),
      host.storage.get(STORAGE_TAB_KEY),
      host.call("listPrs"),
      // Load PRs immediately
      host.storage.get(STORAGE_SORT_KEY),
      host.storage.get(STORAGE_HOST_SCOPE_KEY),
      host.storage.get(STORAGE_VIEW_KEY)
    ]).then(([s, t, prsList, storedSort, storedHostScope, storedView]) => {
      if (!alive) return;
      if (storedSort?.field) setSortField(storedSort.field);
      if (storedSort?.dir) setSortDir(storedSort.dir);
      if (Array.isArray(storedHostScope)) setHostScope(storedHostScope);
      if (isListViewMode(storedView)) setViewMode(storedView);
      const merged = s ? {
        ...DEFAULT_PR_MONITOR_SETTINGS,
        ...s,
        relevanceModes: {
          ...DEFAULT_PR_MONITOR_SETTINGS.relevanceModes,
          ...s.relevanceModes
        }
      } : null;
      setSettings(merged);
      if (merged) {
        host.cache.set("settings", merged);
        host.cache.refreshBadge?.();
      }
      if (t === "prs" || t === "settings") {
        setSubTab(t);
      } else if (t === "board" || t === "list") {
        setSubTab("prs");
        if (!isListViewMode(storedView)) {
          setViewMode(t);
          void host.storage.set(STORAGE_VIEW_KEY, t);
        }
        void host.storage.set(STORAGE_TAB_KEY, "prs");
      }
      if (Array.isArray(prsList) && prsList.length > 0) {
        setPrs(prsList);
        host.cache.set(MONITORED_PRS_CACHE_KEY, prsList);
        host.cache.set(MONITORED_COUNT_CACHE_KEY, prsList.length);
        host.cache.refreshBadge?.();
      }
      setSettingsLoaded(true);
      setHydrated(true);
      setInitialLoadDone(true);
    }).catch((err) => {
      if (!alive) return;
      console.error("pr-monitor hydrate failed", err);
      setSettingsLoaded(true);
      setHydrated(true);
      setInitialLoadDone(true);
    });
    return () => {
      alive = false;
    };
  }, [host]);
  useEffect(() => {
    const tick = () => {
      const next = host.cache.get(MONITORED_PRS_CACHE_KEY);
      if (next) {
        setPrs((prev) => prev === next ? prev : next);
      }
      const nextProjects = host.listProjects();
      setProjects((prev) => prev.length === nextProjects.length ? prev : nextProjects);
    };
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [host]);
  const selectTab = (t) => {
    setSubTab(t);
    void host.storage.set(STORAGE_TAB_KEY, t);
  };
  const pollNow = useCallback(
    async (repos) => {
      setLoading(true);
      setError(null);
      try {
        const scoped = Array.isArray(repos) && repos.length > 0;
        const res = scoped ? await host.call("syncRepos", { repos }) : await host.call("pollAll");
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
          if (Array.isArray(res.deltas) && res.deltas.length > 0) {
            const notificationSettings = settings ?? {
              ...DEFAULT_PR_MONITOR_SETTINGS,
              ...await host.storage.get(SETTINGS_STORAGE_KEY)
            };
            await deliverNotifications(host, res.deltas, notificationSettings);
          }
        } else if (res?.error) {
          setError(res.error);
        }
        const health = res?.health;
        if (!scoped && health) {
          setSyncHealth(health);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setFirstSyncDone(true);
      }
    },
    [host]
  );
  const didInitialPoll = useRef(false);
  useEffect(() => {
    if (!initialLoadDone || didInitialPoll.current) return;
    didInitialPoll.current = true;
    void host.call("getSyncHealth").then((res) => {
      if (res?.ok && res.health) setSyncHealth(res.health);
    }).catch(() => {
    });
    void pollNow();
  }, [initialLoadDone, pollNow, host]);
  const resolveRemoteGone = useCallback(
    async (repo, action) => {
      try {
        const res = await host.call("resolveRemoteGone", {
          repo,
          action
        });
        if (!res?.ok) {
          host.toast(`Couldn't ${action} ${repo} \u2014 ${res?.error ?? "unknown error"}`, "error");
          return;
        }
        setSyncHealth((prev) => ({
          ...prev,
          remoteGone: prev.remoteGone.filter((r) => r.toLowerCase() !== repo.toLowerCase()),
          keptGone: action === "keep" ? [...prev.keptGone, repo].filter((r, i, a) => a.indexOf(r) === i) : prev.keptGone
        }));
        void pollNow();
      } catch (err) {
        host.toast(
          `Couldn't ${action} ${repo} \u2014 ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
      }
    },
    [host, pollNow]
  );
  const removePr = useCallback(
    async (url) => {
      try {
        const res = await host.call("removePr", url);
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
        }
      } catch (err) {
        host.toast(
          `Couldn't remove PR \u2014 ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
      }
    },
    [host]
  );
  const dismissPr = useCallback(
    async (url) => {
      const pr = prs.find((p) => p.url === url);
      if (!pr) return;
      try {
        let res;
        if (pr.source === "auto") {
          res = await host.call("dismissPr", { url });
        } else {
          res = await host.call("removePr", url);
        }
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
        }
      } catch (err) {
        host.toast(
          `Couldn't dismiss PR \u2014 ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
      }
    },
    [host, prs]
  );
  const saveSettings = useCallback(
    async (next) => {
      setSettings(next);
      const persisted = await host.storage.get(SETTINGS_STORAGE_KEY);
      const merged = { ...next };
      if (persisted) {
        merged.organizations = persisted.organizations;
        merged.repositories = persisted.repositories;
        merged.author = persisted.author;
        merged.orgDiscovered = persisted.orgDiscovered;
        merged.authorDiscovered = persisted.authorDiscovered;
      }
      await host.storage.set(SETTINGS_STORAGE_KEY, merged);
      host.cache.set("settings", merged);
      host.cache.refreshBadge?.();
    },
    [host]
  );
  const reloadRepositories = useCallback(async () => {
    const persisted = await host.storage.get(SETTINGS_STORAGE_KEY);
    if (persisted?.repositories) {
      setSettings((prev) => prev ? { ...prev, repositories: persisted.repositories } : prev);
    }
  }, [host]);
  const assignProject = useCallback(
    async (url, projectId) => {
      try {
        const res = await host.call("assignProject", url, projectId);
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
        }
      } catch (err) {
        host.toast(
          `Couldn't assign project \u2014 ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
      }
    },
    [host]
  );
  const changeSort = useCallback(
    (field, dir) => {
      setSortField(field);
      setSortDir(dir);
      void host.storage.set(STORAGE_SORT_KEY, { field, dir });
    },
    [host]
  );
  const changeHostScope = useCallback(
    (hosts) => {
      setHostScope(hosts);
      void host.storage.set(STORAGE_HOST_SCOPE_KEY, hosts);
    },
    [host]
  );
  const changeViewMode = useCallback(
    (mode) => {
      setViewMode(mode);
      void host.storage.set(STORAGE_VIEW_KEY, mode);
    },
    [host]
  );
  const bulkSetSeen = useCallback(
    async (urls, seen) => {
      if (urls.length === 0) return;
      try {
        const res = await host.call("setPrsSeen", { urls, seen });
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set("monitoredCount", res.prs.length);
          host.cache.refreshBadge?.();
        }
      } catch (err) {
        host.toast(`Couldn't update read state \u2014 ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
    [host]
  );
  const bulkSetFavorite = useCallback(
    async (urls, favorite) => {
      if (urls.length === 0) return;
      try {
        const res = await host.call("setPrsFavorite", { urls, favorite });
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
        }
      } catch (err) {
        host.toast(`Couldn't update favorites \u2014 ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
    [host]
  );
  const bulkDismiss = useCallback(
    async (urls) => {
      if (urls.length === 0) return;
      try {
        const res = await host.call("dismissPrs", { urls });
        if (res?.ok && Array.isArray(res.prs)) {
          setPrs(res.prs);
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
        }
      } catch (err) {
        host.toast(`Couldn't dismiss PRs \u2014 ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
    [host]
  );
  const visiblePrs = useMemo(() => {
    if (repoScope.length === 0) return prs;
    const set = new Set(repoScope.map((r) => r.toLowerCase()));
    return prs.filter((pr) => set.has(pr.repo.toLowerCase()));
  }, [prs, repoScope]);
  const sweepTargets = useMemo(
    () => visiblePrs.filter((pr) => TERMINAL_STATUSES.includes(pr.status)).map((pr) => pr.url),
    [visiblePrs]
  );
  const syncClue = useMemo(() => deriveSyncClue(syncHealth), [syncHealth]);
  if (!hydrated) {
    return /* @__PURE__ */ jsx("section", { className: "prm-panel", children: /* @__PURE__ */ jsxs("div", { className: "prm-loading", children: [
      /* @__PURE__ */ jsx(LoaderCircle, { size: 16, className: "prm-spin" }),
      " Loading PR Monitor\u2026"
    ] }) });
  }
  if (!settings) {
    return /* @__PURE__ */ jsx("section", { className: "prm-panel", children: /* @__PURE__ */ jsx(
      SetupGate,
      {
        onSave: async (initial) => {
          await saveSettings(initial);
        }
      }
    ) });
  }
  return /* @__PURE__ */ jsxs("section", { className: "prm-panel", children: [
    /* @__PURE__ */ jsxs("header", { className: "prm-header", children: [
      /* @__PURE__ */ jsxs("div", { className: "prm-header-title", children: [
        /* @__PURE__ */ jsx(GitPullRequest, { size: 16, className: "prm-header-icon", "aria-hidden": true }),
        /* @__PURE__ */ jsxs("div", { className: "prm-header-heading", children: [
          /* @__PURE__ */ jsx("h2", { children: subTab === "settings" ? "Settings" : "PR Monitor" }),
          /* @__PURE__ */ jsx("p", { className: "prm-header-subtitle", children: subTab === "settings" ? "Manage GitHub connections and PR monitoring preferences." : "Authored, review, and tracked pull requests" })
        ] }),
        subTab === "prs" && /* @__PURE__ */ jsx("span", { className: "prm-count-pill", children: visiblePrs.length })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "prm-header-actions", children: [
        subTab === "prs" && /* @__PURE__ */ jsxs(Fragment2, { children: [
          /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: "prm-btn",
              onClick: () => setPullOpen(true),
              title: "Add a specific pull request to the monitored list",
              children: [
                /* @__PURE__ */ jsx(Download, { size: 13 }),
                " ",
                /* @__PURE__ */ jsx("span", { children: "Add PR" })
              ]
            }
          ),
          sweepTargets.length > 0 && /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: "prm-btn",
              onClick: () => void bulkDismiss(sweepTargets),
              title: `Sweep \u2014 dismiss the ${sweepTargets.length} Merged/Closed PR(s) from the list`,
              children: [
                /* @__PURE__ */ jsx(Trash2, { size: 13 }),
                " ",
                /* @__PURE__ */ jsx("span", { children: "Sweep" })
              ]
            }
          ),
          /* @__PURE__ */ jsxs("div", { className: "prm-split-btn", children: [
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: "prm-btn prm-btn--primary prm-split-primary",
                onClick: () => void pollNow(repoScope),
                disabled: loading,
                title: repoScope.length > 0 ? `Sync the ${repoScope.length} selected repositor${repoScope.length === 1 ? "y" : "ies"} now` : "Sync all monitored PRs now",
                children: [
                  loading ? /* @__PURE__ */ jsx(LoaderCircle, { size: 13, className: "prm-spin" }) : /* @__PURE__ */ jsx(RefreshCw, { size: 13 }),
                  /* @__PURE__ */ jsx("span", { children: "Sync" })
                ]
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                ref: syncBtnRef,
                type: "button",
                className: "prm-btn prm-btn--primary prm-split-caret",
                onClick: () => setSyncFilterOpen((v) => !v),
                disabled: loading,
                title: "Sync & Filter \u2014 choose which repositories to show and sync",
                "aria-label": "Open Sync & Filter picker",
                children: /* @__PURE__ */ jsx(ChevronDown, { size: 13 })
              }
            ),
            syncFilterOpen && /* @__PURE__ */ jsx(
              SyncFilterMenu,
              {
                anchorRef: syncBtnRef,
                host,
                selectedRepos: repoScope,
                onClose: () => setSyncFilterOpen(false),
                onToggleRepo: (fullName) => setRepoScope(
                  (prev) => prev.includes(fullName) ? prev.filter((r) => r !== fullName) : [...prev, fullName]
                ),
                onSelectAll: () => setRepoScope([]),
                onSync: (repos) => void pollNow(repos)
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "prm-btn prm-header-mode",
            "aria-pressed": subTab === "settings",
            onClick: () => selectTab(subTab === "settings" ? "prs" : "settings"),
            title: subTab === "settings" ? "Back to pull requests" : "Settings",
            children: subTab === "settings" ? /* @__PURE__ */ jsxs(Fragment2, { children: [
              /* @__PURE__ */ jsx(ArrowLeft, { size: 13, "aria-hidden": true }),
              " ",
              /* @__PURE__ */ jsx("span", { children: "PRs" })
            ] }) : /* @__PURE__ */ jsxs(Fragment2, { children: [
              /* @__PURE__ */ jsx(Settings, { size: 13, "aria-hidden": true }),
              " ",
              /* @__PURE__ */ jsx("span", { children: "Settings" })
            ] })
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: `prm-content${subTab === "prs" && viewMode === "board" ? " prm-content--board" : ""}`, children: [
      error && /* @__PURE__ */ jsx("div", { className: "prm-error", children: error }),
      subTab === "prs" && syncClue && /* @__PURE__ */ jsxs("div", { className: `prm-sync-clue prm-sync-clue--${syncClue.kind}`, role: "status", children: [
        syncClue.kind === "disconnect" && /* @__PURE__ */ jsx(WifiOff, { size: 14, "aria-hidden": true }),
        syncClue.kind === "remote-gone" && /* @__PURE__ */ jsx(TriangleAlert, { size: 14, "aria-hidden": true }),
        syncClue.kind === "outage" && /* @__PURE__ */ jsx(CloudOff, { size: 14, "aria-hidden": true }),
        /* @__PURE__ */ jsx("span", { className: "prm-sync-clue-msg", children: syncClue.message }),
        syncClue.action === "settings" && /* @__PURE__ */ jsx("button", { type: "button", className: "prm-sync-clue-action", onClick: () => selectTab("settings"), children: "Open Settings" })
      ] }),
      subTab === "prs" && syncHealth.remoteGone.map((repo) => /* @__PURE__ */ jsxs("div", { className: "prm-sync-prompt", role: "alertdialog", "aria-label": `Repository ${repo} is gone`, children: [
        /* @__PURE__ */ jsxs("span", { className: "prm-sync-prompt-msg", children: [
          /* @__PURE__ */ jsx("strong", { children: repo }),
          " can't be found on GitHub. Remove it, or keep the last-known PRs?"
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "prm-sync-prompt-actions", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "prm-btn",
              onClick: () => void resolveRemoteGone(repo, "keep"),
              children: "Keep"
            }
          ),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "prm-btn prm-btn--danger",
              onClick: () => void resolveRemoteGone(repo, "remove"),
              children: "Remove"
            }
          )
        ] })
      ] }, repo)),
      subTab === "prs" && /* @__PURE__ */ jsx(
        PrTileList,
        {
          prs: visiblePrs,
          host,
          projects,
          tisWarnHours: settings.tisWarnHours,
          tisDangerHours: settings.tisDangerHours,
          reviewWarnDays: settings.reviewWarnDays,
          reviewDangerDays: settings.reviewDangerDays,
          repositories: settings.repositories,
          workItemLocatorBase: settings.gusLocatorBaseUrl,
          sortField,
          sortDir,
          onSortChange: changeSort,
          hostScope,
          onHostScopeChange: changeHostScope,
          awaitingFirstSync: !firstSyncDone,
          syncing: loading,
          autoSyncEnabled: settings.autoSyncEnabled ?? true,
          onDismiss: (url) => void dismissPr(url),
          onProjectAssign: (url, projectId) => void assignProject(url, projectId),
          onBulkSetSeen: (urls, seen) => void bulkSetSeen(urls, seen),
          onBulkDismiss: (urls) => void bulkDismiss(urls),
          onBulkSetFavorite: (urls, favorite) => void bulkSetFavorite(urls, favorite),
          viewMode,
          onViewModeChange: changeViewMode
        }
      ),
      subTab === "settings" && settingsLoaded && /* @__PURE__ */ jsx(
        SettingsView,
        {
          settings,
          onSave: (s) => void saveSettings(s),
          onRepositoriesChanged: () => void reloadRepositories(),
          host
        }
      )
    ] }),
    pullOpen && /* @__PURE__ */ jsx(
      PullPrModal,
      {
        host,
        onClose: () => setPullOpen(false),
        onPulled: (pulled) => {
          setPrs(pulled);
          host.cache.set(MONITORED_PRS_CACHE_KEY, pulled);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, pulled.length);
          host.cache.refreshBadge?.();
          setPullOpen(false);
        }
      }
    )
  ] });
}

// lib/rpc.ts
function packRpcArgs(args) {
  if (args.length === 0) return void 0;
  if (args.length === 1) return args[0];
  return args;
}

// src/app/adapter.ts
var cacheStore = /* @__PURE__ */ new Map();
var projectsCache = [];
var badgeRefresh;
function setBadgeRefresh(fn) {
  badgeRefresh = fn;
}
function sharedPanelCache() {
  return {
    get: (key) => cacheStore.get(key),
    set: (key, value) => {
      cacheStore.set(key, value);
    },
    delete: (key) => {
      cacheStore.delete(key);
    },
    refreshBadge: () => badgeRefresh?.()
  };
}
function runtimeToast(message, kind) {
  const runtime = globalThis.__ZCC_PLUGIN_RUNTIME__;
  runtime?.toast?.(message, kind);
}
function openSafeExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    if (typeof window === "undefined") return;
    window.open(parsed.href, "_blank", "noopener,noreferrer");
  } catch {
  }
}
function createPluginPanelHost(pluginId) {
  projectsCache = [];
  void callPluginRpc(pluginId, "listProjects").then((list2) => {
    if (Array.isArray(list2)) projectsCache = list2;
  }).catch(() => {
  });
  return {
    call: (method, ...args) => callPluginRpc(pluginId, method, packRpcArgs(args)),
    storage: {
      get: (key) => callPluginRpc(pluginId, "storageGet", key),
      set: async (key, value) => {
        await callPluginRpc(pluginId, "storageSet", { key, value });
      }
    },
    cache: sharedPanelCache(),
    toast: runtimeToast,
    listProjects: () => projectsCache,
    openExternal: openSafeExternal,
    pushInbox: async (input) => {
      if (!input.projectId) return { id: "" };
      return await callPluginRpc(pluginId, "pushInbox", input);
    }
  };
}

// src/app/styles.css
var styles_default = '/*\n * PR Monitor \u2014 plugin-scoped styles. Everything here is prefixed with `.prm-`\n * so it can never collide with core or another plugin. The UI is a full-width\n * workbench: a kanban board (default) or a dense tile list.\n *\n * Colors are pulled from the app\'s CSS custom properties (`--bg-*`, `--text-*`,\n * `--accent-*`, `--danger`, `--success`) so both light and dark themes work\n * without a plugin-side theme switch.\n */\n\n/* \u2500\u2500 Panel shell \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n/*\n * Root panel. The host `.module-panel-slot` already spans the shell content\n * columns, so this root only needs to fill the slot: full height, flex column,\n * min-height 0 so the tile list can scroll.\n */\n.prm-panel {\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  overflow: hidden;\n  background: var(--bg-panel);\n  color: var(--text-primary);\n  font-size: 13px;\n}\n\n.prm-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 10px 14px;\n  border-bottom: 1px solid var(--border);\n  gap: 12px;\n  flex-wrap: wrap;\n  flex-shrink: 0; /* Never shrink header - always visible */\n}\n\n.prm-header-title {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.prm-header-title h2 {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n}\n\n.prm-header-icon {\n  color: var(--accent-blue);\n}\n\n.prm-count-pill {\n  font-size: 11px;\n  color: var(--text-muted);\n  background: var(--bg-elevated);\n  border-radius: 10px;\n  padding: 1px 8px;\n  font-weight: 500;\n  min-width: 16px;\n  text-align: center;\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n\n.prm-header-actions {\n  display: flex;\n  gap: 6px;\n}\n\n.prm-content {\n  flex: 1 1 auto;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  overflow-y: auto; /* Vertical scroll only \u2014 content word-wraps, never scrolls sideways */\n  overflow-x: hidden;\n}\n\n/* \u2500\u2500 Buttons \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-btn {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  line-height: 1.2;\n  padding: 7px 12px;\n  border-radius: 8px;\n  background: var(--bg-elevated);\n  color: var(--text-primary);\n  border: 1px solid var(--border-strong);\n  font-size: 12px;\n  font-weight: 550;\n  font-family: inherit;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;\n}\n\n.prm-btn svg {\n  display: block;\n  flex-shrink: 0;\n}\n\n.prm-btn:hover:not(:disabled) {\n  background: var(--bg-hover);\n  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--border-strong));\n}\n\n.prm-btn:focus-visible {\n  outline: 2px solid var(--accent-blue);\n  outline-offset: 2px;\n}\n\n.prm-btn:disabled {\n  opacity: 0.55;\n  cursor: not-allowed;\n}\n\n.prm-btn--primary {\n  background: var(--accent-blue);\n  color: white;\n  border-color: var(--accent-blue);\n}\n\n/* Opt a button out of flex-column stretch so it sizes to its own text\n   (e.g. "Sync All Now" inside .prm-subsection). */\n.prm-btn--inline {\n  align-self: flex-start;\n}\n\n.prm-btn--primary:hover:not(:disabled) {\n  filter: brightness(1.08);\n  background: var(--accent-blue);\n}\n\n.prm-row-icon-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  padding: 2px;\n  border-radius: 4px;\n  background: transparent;\n  border: 0;\n  color: var(--text-muted);\n  cursor: pointer;\n}\n\n.prm-row-icon-btn:hover {\n  background: var(--bg-hover);\n  color: var(--text-primary);\n}\n\n/* The lucide <svg> fills the tiny (padding:2px) icon button, so the pointer is\n   always over the SVG child, never the button itself. In Electron/Chromium the\n   native `title` tooltip is flaky when the persistent hover target is a child\n   rather than the title-bearing element, so icon-only buttons showed no hover\n   text. Make the icon transparent to pointer events \u2192 the button is the stable\n   hover target and its `title` surfaces (clicks still land on the button). */\n.prm-row-icon-btn svg {\n  pointer-events: none;\n}\n\n.prm-row-icon-btn--danger:hover {\n  color: var(--danger);\n}\n\n/* Deterministic hover tooltip for icon-only buttons. The native `title` tooltip\n   is unreliable in Electron/Chromium for tiny icon buttons (it often never\n   surfaces even with the SVG made pointer-transparent), so we render our own\n   from a `data-tip` attribute. `title` stays on the element as an a11y/native\n   fallback; `data-tip` drives the visible bubble. The host tokens keep it on\n   theme. The positioned ancestor is the button itself. */\n.prm-tip {\n  position: relative;\n}\n.prm-tip::after {\n  content: attr(data-tip);\n  position: absolute;\n  bottom: calc(100% + 6px);\n  left: 50%;\n  transform: translateX(-50%);\n  /* Tooltip text is plain mixed-case prose even when the element it labels is\n     CSS-uppercased (e.g. a status pill). text-transform inherits into ::after\n     content, so reset it here or the pill\'s uppercase leaks into the bubble. */\n  text-transform: none;\n  white-space: nowrap;\n  padding: 3px 7px;\n  border-radius: 4px;\n  background: var(--bg-tooltip, #1f2430);\n  /* `--text-primary` is dark in ZCC\'s light theme, while this surface is\n     intentionally dark. Keep the tooltip foreground fixed to an inverse color\n     so check summaries remain readable in both host themes. */\n  color: #fff;\n  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));\n  font-size: 11px;\n  line-height: 1.3;\n  pointer-events: none;\n  opacity: 0;\n  z-index: 20;\n  transition: opacity 0.1s ease;\n}\n.prm-tip:hover::after,\n.prm-tip:focus-visible::after {\n  opacity: 1;\n}\n\n/* \u2500\u2500 Loading / errors \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-loading {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 16px;\n  color: var(--text-muted);\n  font-size: 12px;\n}\n\n.prm-spin {\n  animation: prm-spin 0.9s linear infinite;\n}\n\n@keyframes prm-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n.prm-error {\n  margin: 8px 14px;\n  padding: 6px 10px;\n  border-radius: 5px;\n  background: rgba(248, 81, 73, 0.1);\n  color: var(--danger);\n  font-size: 12px;\n  border: 1px solid rgba(248, 81, 73, 0.3);\n}\n\n/* \u2500\u2500 Sync-health clue + Remove/Keep prompt (R-REPO-013/015/016) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n * One consolidated clue banner (AC-REPO-13.5), colored by kind, plus a per-repo\n * Remove/Keep prompt for confirmed remote-gone repos (R-REPO-016). */\n.prm-sync-clue {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin: 8px 14px;\n  padding: 7px 10px;\n  border-radius: 5px;\n  font-size: 12px;\n  border: 1px solid var(--border);\n  background: var(--bg-elevated);\n  color: var(--text-primary);\n}\n\n.prm-sync-clue--disconnect {\n  background: rgba(248, 81, 73, 0.1);\n  border-color: rgba(248, 81, 73, 0.3);\n  color: var(--danger);\n}\n\n.prm-sync-clue--remote-gone {\n  background: rgba(210, 153, 34, 0.1);\n  border-color: rgba(210, 153, 34, 0.35);\n  color: var(--warning, #d29922);\n}\n\n.prm-sync-clue--outage {\n  background: var(--bg-elevated);\n  border-color: var(--border);\n  color: var(--text-muted);\n}\n\n.prm-sync-clue-msg {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.prm-sync-clue-action {\n  flex: 0 0 auto;\n  padding: 3px 9px;\n  border-radius: 5px;\n  border: 1px solid currentColor;\n  background: transparent;\n  color: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.prm-sync-clue-action:hover {\n  background: rgba(255, 255, 255, 0.08);\n}\n\n.prm-sync-prompt {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  margin: 8px 14px;\n  padding: 8px 10px;\n  border-radius: 5px;\n  font-size: 12px;\n  background: rgba(210, 153, 34, 0.08);\n  border: 1px solid rgba(210, 153, 34, 0.3);\n  color: var(--text-primary);\n}\n\n.prm-sync-prompt-msg {\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n.prm-sync-prompt-actions {\n  flex: 0 0 auto;\n  display: flex;\n  gap: 6px;\n}\n\n.prm-btn--danger {\n  background: var(--danger);\n  color: white;\n  border-color: var(--danger);\n}\n\n.prm-btn--danger:hover:not(:disabled) {\n  filter: brightness(1.08);\n  background: var(--danger);\n}\n\n/* Transparent full-viewport backdrop that sits just BELOW the fixed menu. It\n * catches every outside click and closes the menu structurally, so we don\'t\n * need a window mousedown listener (which raced with item selection across the\n * host-React boundary \u2014 see PrProjectControl). A click on a menu item\n * lands on the item (higher z-index); a click anywhere else lands here. */\n.prm-project-menu-backdrop {\n  position: fixed;\n  inset: 0;\n  z-index: 9999;\n  background: transparent;\n}\n\n.prm-project-menu-item {\n  display: block;\n  width: 100%;\n  padding: 6px 10px;\n  text-align: left;\n  background: transparent;\n  border: 0;\n  border-radius: 4px;\n  color: var(--text-primary);\n  font-size: 12px;\n  cursor: pointer;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.prm-project-menu-item:hover {\n  background: var(--bg-hover);\n}\n\n.prm-project-menu-item.is-active {\n  background: rgba(47, 129, 247, 0.15);\n  color: var(--accent-blue);\n  font-weight: 600;\n}\n\n.prm-project-menu-empty {\n  padding: 8px 10px;\n  color: var(--text-muted);\n  font-size: 11px;\n  font-style: italic;\n}\n\n/* \u2500\u2500 Check summary \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-check-pip {\n  display: inline-block;\n  font-size: 10px;\n  padding: 1px 5px;\n  border-radius: 8px;\n  background: var(--bg-elevated);\n  color: var(--text-muted);\n  border: 1px solid var(--border);\n  line-height: 1.25;\n}\n\n.prm-check-pip--pass {\n  background: rgba(63, 185, 80, 0.15);\n  color: var(--success);\n  border-color: rgba(63, 185, 80, 0.3);\n}\n\n.prm-check-pip--fail {\n  background: rgba(248, 81, 73, 0.15);\n  color: var(--danger);\n  border-color: rgba(248, 81, 73, 0.3);\n}\n\n.prm-check-pip--pending {\n  background: rgba(212, 160, 23, 0.15);\n  color: var(--accent-gold);\n  border-color: rgba(212, 160, 23, 0.3);\n}\n\n.prm-checks-list {\n  list-style: none;\n  padding: 6px 0 0;\n  margin: 6px 0 0;\n  border-top: 1px solid var(--border);\n  font-size: 11px;\n}\n\n.prm-checks-empty {\n  padding: 6px 0;\n  font-size: 11px;\n  color: var(--text-muted);\n  font-style: italic;\n}\n\n.prm-check-row {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 3px 0;\n  color: var(--text-muted);\n}\n\n.prm-check-state-pip {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--text-dim);\n}\n\n.prm-check-state-pip--pass {\n  background: var(--success);\n}\n\n.prm-check-state-pip--fail {\n  background: var(--danger);\n}\n\n.prm-check-state-pip--pending {\n  background: var(--accent-gold);\n}\n\n.prm-check-name {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  color: var(--text-primary);\n  font-size: 11px;\n}\n\n.prm-check-bucket {\n  font-size: 10px;\n  color: var(--text-dim);\n  padding: 0 4px;\n  border-radius: 3px;\n  background: var(--bg-elevated);\n}\n\n.prm-check-state {\n  font-size: 10px;\n  text-transform: lowercase;\n  color: var(--text-dim);\n}\n\n/* \u2500\u2500 Compact list view \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-list {\n  flex: 1 1 auto;\n  min-height: 0; /* Allow flex shrinking */\n  padding: 6px 10px;\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n}\n\n/* \u2500\u2500 Modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-modal {\n  width: min(440px, 90vw);\n  background: var(--bg-elevated);\n  border-radius: 8px;\n  border: 1px solid var(--border-strong);\n  display: flex;\n  flex-direction: column;\n  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);\n}\n\n.prm-modal-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 10px 14px;\n  border-bottom: 1px solid var(--border);\n}\n\n.prm-modal-header h3 {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  margin: 0;\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.prm-modal-body {\n  padding: 14px;\n}\n\n/* Help popup body \u2014 readable prose with a tidy bulleted list. */\n.prm-help-body {\n  font-size: 13px;\n  line-height: 1.5;\n  color: var(--text-secondary);\n}\n\n.prm-help-body p {\n  margin: 0 0 10px;\n}\n\n.prm-help-body ul {\n  margin: 0 0 10px;\n  padding-left: 18px;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.prm-help-body strong {\n  color: var(--text-primary);\n}\n\n.prm-modal-footer {\n  padding: 10px 14px;\n  border-top: 1px solid var(--border);\n  display: flex;\n  justify-content: flex-end;\n  gap: 8px;\n}\n\n.prm-modal-error {\n  margin-top: 10px;\n  padding: 6px 10px;\n  border-radius: 5px;\n  background: rgba(248, 81, 73, 0.1);\n  color: var(--danger);\n  font-size: 12px;\n  border: 1px solid rgba(248, 81, 73, 0.3);\n}\n\n/* \u2500\u2500 Form fields \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-field {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.prm-field-label {\n  font-size: 11px;\n  color: var(--text-muted);\n  font-weight: 500;\n}\n\n.prm-field-hint {\n  font-size: 10px;\n  color: var(--text-dim);\n}\n\n/* Emphasized field label \u2014 for text fields that should stand out like the\n   bold checkbox labels (AC-REPO-11 readability). */\n.prm-field-label--strong {\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--text-primary);\n  text-transform: none;\n  letter-spacing: 0;\n}\n\n.prm-input {\n  padding: 7px 10px;\n  border-radius: 6px;\n  border: 1px solid var(--border);\n  background: var(--bg-base);\n  color: var(--text-primary);\n  font-size: 13px;\n  font-family: inherit;\n}\n\n.prm-input:focus {\n  outline: none;\n  border-color: var(--accent-blue);\n  box-shadow: 0 0 0 2px rgba(47, 129, 247, 0.2);\n}\n\n/* \u2500\u2500 Settings view \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-radio-row,\n.prm-checkbox-row {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  padding: 6px 8px;\n  border-radius: 5px;\n  cursor: pointer;\n  border: 1px solid transparent;\n}\n\n.prm-radio-row:hover,\n.prm-checkbox-row:hover {\n  background: var(--bg-hover);\n}\n\n.prm-radio-row input,\n.prm-checkbox-row input {\n  margin-top: 2px;\n  flex-shrink: 0;\n}\n\n.prm-radio-row > span,\n.prm-checkbox-row > span {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.prm-radio-row strong,\n.prm-checkbox-row strong {\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.prm-radio-row small,\n.prm-checkbox-row small {\n  font-size: 11px;\n  color: var(--text-muted);\n}\n\n/* \u2500\u2500 Setup gate \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-setup-gate {\n  flex: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 40px 20px;\n}\n\n.prm-setup {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 10px;\n  max-width: 460px;\n  text-align: center;\n  color: var(--text-muted);\n}\n\n.prm-setup h3 {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 600;\n  color: var(--text-primary);\n}\n\n.prm-setup p {\n  margin: 0;\n  font-size: 13px;\n  line-height: 1.5;\n  color: var(--text-muted);\n}\n\n/* \u2500\u2500 Empty states \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-empty {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 12px;\n  padding: 40px 20px;\n  text-align: center;\n  color: var(--text-muted);\n}\n\n.prm-empty h3 {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 600;\n  color: var(--text-primary);\n}\n\n.prm-empty p {\n  margin: 0;\n  font-size: 13px;\n}\n\n/* \u2500\u2500 Tile UI (Phase 2) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-tile-list {\n  flex: 1 1 auto;\n  min-width: 0;\n  min-height: 0;\n  padding: 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.prm-tile {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  min-width: 0;\n  padding: 12px 14px;\n  border-radius: 10px;\n  background: var(--bg-base);\n  border: 1px solid var(--border);\n  box-shadow: none;\n  /* Item 6: the tile root is NOT a click target for a READ PR \u2014 a whole-row\n     click only does something when unread (marks it seen). So the row shows the\n     default cursor; only an unread tile (below) opts into pointer. The dead\n     space right of the project / branch / Draft no longer looks clickable. */\n  cursor: default;\n  transition: background 0.12s, border-color 0.12s;\n  position: relative;\n}\n\n.prm-tile:hover {\n  background: var(--bg-hover);\n  border-color: var(--border-strong);\n}\n\n/* Favorite (R-LIST-026) \u2014 a find-faster marker: a light-yellow row tint mixed\n   from the gold accent over the base surface so it reads in both themes. The\n   explicit :hover rule is required \u2014 `.prm-tile:hover` at (0,2,0) specificity\n   would otherwise override the bare `--favorite` class (0,1,0) and wash the tint\n   away on hover. Declared BEFORE unread/selected so those stronger states win\n   the cascade (same specificity): a selected or unread favorite shows the\n   stronger tint, with the star + gold action icon still marking it a favorite. */\n.prm-tile--favorite {\n  background: color-mix(in srgb, var(--accent-gold, #d4a017) 22%, var(--bg-base));\n}\n\n.prm-tile--favorite:hover {\n  background: color-mix(in srgb, var(--accent-gold, #d4a017) 30%, var(--bg-base));\n}\n\n/* Unread \u2014 inbox-style: 2px left accent bar + bold title. The rest of the\n   row stays muted; no blue ring and no whole-row bold. */\n.prm-tile--unread {\n  border-left: 2px solid var(--accent-blue);\n  /* Unread rows ARE a click target (click marks seen), so they show pointer. */\n  cursor: pointer;\n}\n\n.prm-tile--unread .prm-tile-title {\n  font-weight: 600;\n  color: var(--text-primary);\n}\n\n.prm-tile--closed {\n  opacity: 0.7;\n}\n\n/* Selected in the bulk-select model (R-LIST-006). */\n.prm-tile--selected {\n  background: color-mix(in srgb, var(--accent-blue) 10%, var(--bg-base));\n  border-color: color-mix(in srgb, var(--accent-blue) 35%, var(--border));\n}\n\n/* Last sync errored (R-LIST-023) \u2014 subtle warning edge, retry lives inline. */\n.prm-tile--stale {\n  border-left: 3px solid var(--warning, var(--accent-gold, #d29922));\n}\n\n.prm-tile-line1 {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  flex-wrap: wrap;\n}\n\n.prm-tile-state-icon {\n  color: var(--text-muted);\n  flex-shrink: 0;\n}\n\n.prm-tile-title {\n  flex: 1 1 auto;\n  min-width: 0;\n  font-size: 13px;\n  color: var(--text-primary);\n  line-height: 1.4;\n}\n\n.prm-tile-workitem-inline {\n  color: var(--accent);\n  font-weight: 600;\n}\n\n.prm-status-pill {\n  display: inline-block;\n  font-size: 10px;\n  padding: 2px 7px;\n  border-radius: 10px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.3px;\n  flex-shrink: 0;\n}\n\n.prm-status-pill--failed,\n.prm-status-pill--conflict {\n  background: rgba(248, 81, 73, 0.15);\n  color: var(--danger);\n  border: 1px solid rgba(248, 81, 73, 0.3);\n}\n\n.prm-status-pill--yellow,\n.prm-status-pill--pending {\n  background: rgba(212, 160, 23, 0.15);\n  color: var(--accent-gold);\n  border: 1px solid rgba(212, 160, 23, 0.3);\n}\n\n.prm-status-pill--review-required,\n.prm-status-pill--integrating {\n  background: rgba(47, 129, 247, 0.15);\n  color: var(--accent-blue);\n  border: 1px solid rgba(47, 129, 247, 0.3);\n}\n\n.prm-status-pill--green {\n  background: rgba(63, 185, 80, 0.15);\n  color: var(--success);\n  border: 1px solid rgba(63, 185, 80, 0.3);\n}\n\n.prm-status-pill--closed-merged {\n  background: color-mix(in srgb, var(--accent) 15%, transparent);\n  color: var(--accent);\n  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));\n}\n\n.prm-status-pill--closed-abandoned {\n  background: var(--bg-elevated);\n  color: var(--text-dim);\n  border: 1px solid var(--border);\n}\n\n/* Time-in-status pill (R-LIST-013): how long the PR has sat in its current\n * rollup status, escalating ok \u2192 warn \u2192 danger. A text cue (prm-tis-cue,\n * "Slow"/"Stalled") rides alongside the color for colorblind users (AC-LIST-13.2). */\n.prm-tis {\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  font-size: 10px;\n  padding: 2px 6px;\n  border-radius: 8px;\n  font-weight: 500;\n  flex-shrink: 0;\n}\n\n.prm-tis--ok {\n  color: var(--success);\n  background: rgba(63, 185, 80, 0.1);\n}\n\n.prm-tis--warn {\n  color: var(--accent-gold);\n  background: rgba(212, 160, 23, 0.1);\n}\n\n.prm-tis--danger {\n  color: var(--danger);\n  background: rgba(248, 81, 73, 0.1);\n}\n\n/* Passive done-state (Build \u2713 / Review \u2713) \u2014 the gate finished, so the pill is a\n * calm neutral check, no alarm color (\xA73 two-pill model, extension Rule 6: a new\n * rendered modifier needs its own rule). Both pills share this treatment. */\n.prm-tis--done {\n  color: var(--text-muted);\n  background: var(--bg-hover, rgba(127, 127, 127, 0.1));\n}\n\n/* The review pill is label-distinguished, not hue-distinguished (\xA76.4): it shares\n * the ok/warn/danger/done colors. A hair more left margin sets it apart from the\n * build pill when both sit inline. */\n.prm-tis--review {\n  margin-left: 1px;\n}\n\n.prm-tis-cue {\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.03em;\n}\n\n.prm-tile-line2 {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  flex-wrap: wrap;\n  font-size: 11px;\n  color: var(--text-muted);\n}\n\n.prm-workitem-chip {\n  display: inline-block;\n  font-size: 10px;\n  padding: 2px 6px;\n  border-radius: 8px;\n  background: color-mix(in srgb, var(--accent) 15%, transparent);\n  color: var(--accent);\n  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));\n  font-weight: 600;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  flex-shrink: 0;\n}\n\n/* Work-item chip that resolves to a locator URL \u2014 rendered as a <button> that\n * opens externally, so make it read as clickable (R-LIST-011 work-item link). */\n.prm-workitem-chip--link {\n  cursor: pointer;\n}\n\n.prm-workitem-chip--link:hover {\n  background: color-mix(in srgb, var(--accent) 28%, transparent);\n  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));\n}\n\n.prm-tile-repo {\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 11px;\n  color: var(--text-muted);\n  flex-shrink: 0;\n}\n\n.prm-tile-number {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 11px;\n  color: var(--text-muted);\n  flex-shrink: 0;\n}\n\n.prm-tile-icon-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  padding: 1px;\n  border-radius: 3px;\n  background: transparent;\n  border: 0;\n  color: var(--text-muted);\n  cursor: pointer;\n}\n\n.prm-tile-icon-btn:hover {\n  background: var(--bg-hover);\n  color: var(--accent-blue);\n}\n\n.prm-author {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  flex-shrink: 0;\n}\n\n.prm-avatar {\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  flex-shrink: 0;\n}\n\n.prm-avatar--initials {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  background: var(--accent-blue);\n  color: white;\n  font-size: 8px;\n  font-weight: 600;\n}\n\n.prm-author-name {\n  font-size: 11px;\n  color: var(--text-primary);\n}\n\n/* Draft pill (item 14): solid gray fill + bold white text, so it carries the\n   same visual weight as a status pill instead of reading as muted body text. */\n.prm-draft-pill {\n  display: inline-block;\n  font-size: 10px;\n  padding: 2px 7px;\n  border-radius: 10px;\n  background: var(--text-muted, #6e7681);\n  color: #fff;\n  border: 1px solid var(--text-muted, #6e7681);\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.3px;\n  flex-shrink: 0;\n}\n\n.prm-tile-line3 {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 11px;\n  color: var(--text-muted);\n}\n\n.prm-branch-icon {\n  color: var(--text-dim);\n  flex-shrink: 0;\n}\n\n.prm-branch {\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 10px;\n  color: var(--text-muted);\n}\n\n.prm-desc {\n  font-size: 11px;\n  line-height: 1.4;\n  color: var(--text-muted);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\n/* \u2500\u2500 Tile menu \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-tile-menu {\n  position: absolute;\n  background: var(--bg-elevated);\n  border: 1px solid var(--border-strong);\n  border-radius: 6px;\n  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);\n  z-index: 10000;\n  min-width: 180px;\n  max-width: 240px;\n  padding: 4px;\n}\n\n/* Project-assign picker \u2014 a prm-tile-menu positioned fixed at the trigger and\n * right-aligned (translateX(-100%)) in PrProjectControl. Only overrides sizing. */\n.prm-project-picker {\n  min-width: 160px;\n  max-width: 280px;\n  overflow-y: auto;\n}\n\n.prm-tile-menu-divider {\n  height: 1px;\n  background: var(--border);\n  margin: 4px 0;\n}\n\n/* \u2500\u2500 Settings shell (grouped left-nav, R-SET-*) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-settings-shell {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n}\n\n.prm-settings-body {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  overflow: hidden;\n}\n\n.prm-settings-nav {\n  width: 210px;\n  flex-shrink: 0;\n  border-right: 1px solid var(--border);\n  padding: 12px 8px;\n  overflow-y: auto;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n}\n\n.prm-nav-group {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.prm-nav-group-label {\n  font-size: 10px;\n  font-weight: 600;\n  letter-spacing: 0.6px;\n  text-transform: uppercase;\n  color: var(--text-dim);\n  padding: 0 8px 4px;\n}\n\n.prm-nav-row {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  width: 100%;\n  padding: 6px 8px;\n  border-radius: 6px;\n  background: transparent;\n  border: 0;\n  color: var(--text-muted);\n  font-size: 12px;\n  cursor: pointer;\n  text-align: left;\n  transition: background 0.12s, color 0.12s;\n}\n\n.prm-nav-row:hover {\n  background: var(--bg-hover);\n  color: var(--text-primary);\n}\n\n.prm-nav-row.active {\n  background: var(--bg-hover);\n  color: var(--text-primary);\n  font-weight: 550;\n}\n\n.prm-nav-row.active svg {\n  color: var(--text-primary);\n}\n\n.prm-settings-pane {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow-y: auto;\n  padding: 16px 20px;\n}\n\n/* \u2500\u2500 Settings area (shared shell for the five areas) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-area {\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  max-width: 760px;\n}\n\n.prm-area-header {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 12px;\n  flex-wrap: wrap;\n}\n\n.prm-area-heading h3 {\n  margin: 0;\n  font-size: 15px;\n  font-weight: 600;\n  color: var(--text-primary);\n}\n\n.prm-area-heading p {\n  margin: 2px 0 0;\n  font-size: 12px;\n  color: var(--text-muted);\n}\n\n.prm-area-actions {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n}\n\n.prm-area-explainer {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  margin: 0;\n  font-size: 11px;\n  color: var(--text-muted);\n  line-height: 1.5;\n}\n\n.prm-area-explainer code {\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 10px;\n  padding: 1px 4px;\n  border-radius: 3px;\n  background: var(--bg-elevated);\n}\n\n.prm-area-empty {\n  padding: 24px 16px;\n  border: 1px dashed var(--border);\n  border-radius: 8px;\n  text-align: center;\n  font-size: 12px;\n  color: var(--text-muted);\n  line-height: 1.6;\n}\n\n.prm-subsection {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding-top: 6px;\n  border-top: 1px solid var(--border);\n}\n\n.prm-subsection-title {\n  margin: 0;\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: var(--text-muted);\n}\n\n/* \u2500\u2500 Entity cards (orgs / repos / author) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-card-list {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.prm-entity-card {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 12px 14px;\n  border-radius: 8px;\n  background: var(--bg-elevated);\n  border: 1px solid var(--border);\n}\n\n.prm-entity-main {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  min-width: 0;\n}\n\n.prm-entity-title {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--text-primary);\n}\n\n.prm-entity-host {\n  color: var(--text-muted);\n  font-weight: 400;\n}\n\n.prm-entity-sub {\n  font-size: 11px;\n  color: var(--text-muted);\n}\n\n.prm-entity-sub code {\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 10px;\n}\n\n.prm-entity-side {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  align-self: flex-start;\n}\n\n/* Org card lays main+side side-by-side */\n.prm-entity-card:not(.prm-repo-card):not(.prm-author-card) {\n  flex-direction: row;\n  align-items: center;\n  justify-content: space-between;\n}\n\n/* \u2500\u2500 Connection pill (R-ORG-005) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-conn-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 10px;\n  font-weight: 600;\n  padding: 2px 8px;\n  border-radius: 10px;\n  white-space: nowrap;\n}\n\n.prm-conn-pill--connected {\n  background: rgba(63, 185, 80, 0.15);\n  color: var(--success);\n  border: 1px solid rgba(63, 185, 80, 0.3);\n}\n\n.prm-conn-pill--disconnected {\n  background: rgba(248, 81, 73, 0.12);\n  color: var(--danger);\n  border: 1px solid rgba(248, 81, 73, 0.3);\n}\n\n.prm-conn-pill--checking {\n  background: rgba(47, 129, 247, 0.12);\n  color: var(--accent-blue);\n  border: 1px solid rgba(47, 129, 247, 0.3);\n}\n\n/* \u2500\u2500 Repo card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-repo-top {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 8px;\n}\n\n.prm-repo-quick {\n  display: flex;\n  gap: 2px;\n  flex-shrink: 0;\n}\n\n.prm-repo-meta {\n  display: flex;\n  gap: 14px;\n  flex-wrap: wrap;\n}\n\n.prm-repo-actions {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n  margin-top: 2px;\n}\n\n.prm-active-badge {\n  font-size: 9px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.3px;\n  padding: 2px 7px;\n  border-radius: 9px;\n  background: rgba(63, 185, 80, 0.15);\n  color: var(--success);\n  border: 1px solid rgba(63, 185, 80, 0.3);\n}\n\n.prm-active-badge--off {\n  background: var(--bg-panel);\n  color: var(--text-dim);\n  border-color: var(--border);\n}\n\n/* Time-in-status preset pill on the repo card, next to the connection pill\n   (R-LIST/R-REPO \u2014 surface which TIS preset is selected). */\n.prm-tis-preset-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  font-size: 9px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.3px;\n  padding: 2px 7px;\n  border-radius: 9px;\n  background: var(--bg-panel);\n  color: var(--text-muted);\n  border: 1px solid var(--border);\n}\n\n.prm-btn--sm {\n  padding: 3px 8px;\n  font-size: 11px;\n}\n\n.prm-btn--danger,\n.prm-btn--danger:hover:not(:disabled) {\n  background: var(--danger);\n  border-color: var(--danger);\n  color: white;\n}\n\n.prm-btn--danger:hover:not(:disabled) {\n  filter: brightness(1.08);\n}\n\n.prm-btn--danger-ghost:hover:not(:disabled) {\n  color: var(--danger);\n  border-color: var(--danger);\n}\n\n/* \u2500\u2500 Author card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-author-row {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  width: 100%;\n  background: transparent;\n  border: 0;\n  cursor: pointer;\n  padding: 0;\n  color: inherit;\n  text-align: left;\n}\n\n.prm-author-id {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  flex: 1 1 auto;\n  min-width: 0;\n}\n\n/* Author-card expand/collapse chevron (rotates when the card is open). */\n.prm-disclosure {\n  color: var(--text-dim);\n  transition: transform 0.15s;\n}\n\n.prm-disclosure.is-open {\n  transform: rotate(90deg);\n}\n\n.prm-avatar--initials {\n  width: 28px;\n  height: 28px;\n  font-size: 11px;\n}\n\n.prm-author-detail {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  margin-top: 12px;\n  padding-top: 12px;\n  border-top: 1px solid var(--border);\n}\n\n.prm-kv {\n  display: flex;\n  flex-direction: column;\n  gap: 3px;\n  font-size: 12px;\n  color: var(--text-primary);\n}\n\n.prm-identity-list {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.prm-identity-row {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n}\n\n.prm-identity-verified {\n  color: var(--success);\n}\n\n.prm-identity-disconnected {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  color: var(--danger);\n  font-size: 11px;\n}\n\n/* \u2500\u2500 Sync status (System area) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-sync-status {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 12px 14px;\n  border-radius: 8px;\n  background: var(--bg-elevated);\n  border: 1px solid var(--border);\n}\n\n.prm-sync-counts {\n  display: flex;\n  gap: 18px;\n  flex-wrap: wrap;\n  font-size: 12px;\n  color: var(--text-muted);\n  padding-top: 6px;\n  border-top: 1px solid var(--border);\n}\n\n.prm-sync-count strong {\n  color: var(--text-primary);\n}\n\n.prm-input--select {\n  width: auto;\n  min-width: 200px;\n  max-width: 100%;\n}\n\n/* \u2500\u2500 Settings dialogs (Add / Suggested / Browse / Repo-settings / Test) \u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-modal--wide {\n  width: min(600px, 92vw);\n}\n\n.prm-dialog-title {\n  display: inline-flex;\n  align-items: baseline;\n  gap: 8px;\n}\n\n.prm-dialog-tabs {\n  display: flex;\n  gap: 4px;\n  padding: 0 14px;\n  border-bottom: 1px solid var(--border);\n}\n\n.prm-dialog-tab {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 8px 10px;\n  background: transparent;\n  border: 0;\n  border-bottom: 2px solid transparent;\n  color: var(--text-muted);\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.prm-dialog-tab.active {\n  color: var(--accent-blue);\n  border-bottom-color: var(--accent-blue);\n  font-weight: 600;\n}\n\n.prm-modal-body .prm-field {\n  margin-bottom: 12px;\n}\n\n.prm-suggested-list,\n.prm-browse-list {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  max-height: 360px;\n  overflow-y: auto;\n}\n\n.prm-suggested-row {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 8px 6px;\n  border-radius: 6px;\n  cursor: pointer;\n}\n\n.prm-suggested-row:hover {\n  background: var(--bg-hover);\n}\n\n.prm-suggested-main {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  min-width: 0;\n  flex: 1 1 auto;\n}\n\n.prm-suggested-added {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 11px;\n  color: var(--success);\n  white-space: nowrap;\n  flex-shrink: 0;\n}\n\n.prm-added-tag {\n  color: var(--text-dim);\n}\n\n.prm-browse-controls {\n  display: flex;\n  gap: 8px;\n  margin-bottom: 12px;\n}\n\n.prm-browse-controls .prm-input:not(.prm-input--select) {\n  flex: 1 1 auto;\n}\n\n.prm-browse-group {\n  display: flex;\n  flex-direction: column;\n}\n\n.prm-browse-group + .prm-browse-group {\n  margin-top: 4px;\n}\n\n.prm-browse-group-header {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 6px;\n  border: none;\n  background: none;\n  color: var(--text-secondary);\n  font-size: 12px;\n  font-weight: 600;\n  cursor: pointer;\n  border-radius: 6px;\n  text-align: left;\n}\n\n.prm-browse-group-header:hover {\n  background: var(--bg-hover);\n  color: var(--text-primary);\n}\n\n.prm-browse-group-name {\n  color: var(--text-primary);\n}\n\n.prm-browse-group-count {\n  color: var(--text-secondary);\n  font-weight: 400;\n}\n\n.prm-browse-repo-row {\n  margin-left: 16px;\n}\n\n/* An already-monitored repo renders as a non-selectable row with a "Connected"\n   pill in place of the checkbox (AC-REPO-9.3). */\n.prm-browse-repo-row--added {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  cursor: default;\n}\n\n.prm-browse-load-more {\n  align-self: center;\n  margin-top: 8px;\n}\n\n.prm-test-result {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  margin-top: 12px;\n  padding: 10px 12px;\n  border-radius: 6px;\n  font-size: 12px;\n}\n\n.prm-test-result--ok {\n  background: rgba(63, 185, 80, 0.12);\n  color: var(--success);\n  border: 1px solid rgba(63, 185, 80, 0.3);\n}\n\n.prm-test-result--fail {\n  background: rgba(248, 81, 73, 0.1);\n  color: var(--danger);\n  border: 1px solid rgba(248, 81, 73, 0.3);\n}\n\n/* ==========================================================================\n * List redesign (R-LIST-*) \u2014 header heading, split sync control, segment tabs,\n * list toolbar, bulk bar, tile check-pips / mute / sync-error / reviewers,\n * project control, Sync & Filter menu, project line, filtered-empty.\n * All token-based; no shared Tickets board chrome.\n * ========================================================================== */\n\n/* Header heading + subtitle (AC-LIST-1.1 / 1.2). */\n.prm-header-heading {\n  display: flex;\n  flex-direction: column;\n  gap: 1px;\n  min-width: 0;\n}\n\n.prm-header-heading h2 {\n  margin: 0;\n}\n\n.prm-header-subtitle {\n  margin: 0;\n  font-size: 11px;\n  font-weight: 400;\n  color: var(--text-muted);\n}\n\n/* Split sync control (R-LIST-002). */\n.prm-split-btn {\n  position: relative;\n  display: inline-flex;\n  align-items: stretch;\n}\n\n.prm-split-primary {\n  border-top-right-radius: 0;\n  border-bottom-right-radius: 0;\n}\n\n.prm-split-caret {\n  border-top-left-radius: 0;\n  border-bottom-left-radius: 0;\n  border-left: 1px solid rgba(255, 255, 255, 0.25);\n  padding-left: 6px;\n  padding-right: 6px;\n}\n\n/* Segment tabs (R-LIST-005). Quiet cohort chips: muted until active. */\n.prm-segment-tabs {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 4px;\n  align-items: center;\n}\n\n.prm-segment-tab {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 3px 9px;\n  border-radius: 12px;\n  border: 1px solid var(--border);\n  background: transparent;\n  color: var(--text-muted);\n  font-size: 11px;\n  cursor: pointer;\n  white-space: nowrap;\n}\n\n.prm-segment-tab:hover {\n  background: var(--bg-hover);\n  color: var(--text-primary);\n}\n\n.prm-segment-tab.active {\n  background: color-mix(in srgb, var(--accent-blue) 15%, transparent);\n  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--border));\n  color: var(--accent-blue);\n  font-weight: 600;\n}\n\n.prm-segment-count {\n  font-variant-numeric: tabular-nums;\n  font-size: 10px;\n  opacity: 0.8;\n}\n\n/* Status color only when the chip is the active filter. */\n.prm-segment-tab--failed.active,\n.prm-segment-tab--conflict.active {\n  background: color-mix(in srgb, var(--danger) 15%, transparent);\n  border-color: color-mix(in srgb, var(--danger) 40%, var(--border));\n  color: var(--danger);\n  font-weight: 600;\n}\n\n.prm-segment-tab--yellow.active,\n.prm-segment-tab--pending.active {\n  background: color-mix(in srgb, var(--accent-gold) 15%, transparent);\n  border-color: color-mix(in srgb, var(--accent-gold) 40%, var(--border));\n  color: var(--accent-gold);\n  font-weight: 600;\n}\n\n.prm-segment-tab--review-required.active,\n.prm-segment-tab--integrating.active {\n  background: color-mix(in srgb, var(--accent-blue) 15%, transparent);\n  border-color: color-mix(in srgb, var(--accent-blue) 40%, var(--border));\n  color: var(--accent-blue);\n  font-weight: 600;\n}\n\n.prm-segment-tab--green.active {\n  background: color-mix(in srgb, var(--success) 15%, transparent);\n  border-color: color-mix(in srgb, var(--success) 40%, var(--border));\n  color: var(--success);\n  font-weight: 600;\n}\n\n.prm-segment-tab--closed-merged.active {\n  background: color-mix(in srgb, var(--accent) 15%, transparent);\n  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));\n  color: var(--accent);\n  font-weight: 600;\n}\n\n.prm-segment-tab--closed-abandoned.active {\n  background: var(--bg-elevated);\n  border-color: var(--border);\n  color: var(--text-dim);\n  font-weight: 600;\n}\n\n/* List toolbar container + controls row. */\n.prm-list-toolbar {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding-bottom: 10px;\n  margin-bottom: 10px;\n  border-bottom: 1px solid var(--border);\n}\n\n.prm-list-controls,\n.prm-segment-tabs {\n  width: 100%;\n  min-width: 0;\n}\n\n.prm-list-controls {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.prm-select-all {\n  display: inline-flex;\n  align-items: center;\n  cursor: pointer;\n}\n\n.prm-shown-count {\n  font-size: 11px;\n  color: var(--text-muted);\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n\n.prm-search {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  flex: 1 1 140px;\n  min-width: 120px;\n  padding: 3px 8px;\n  border-radius: 6px;\n  border: 1px solid var(--border);\n  background: var(--bg-input, var(--bg-elevated));\n  color: var(--text-muted);\n}\n\n.prm-search-input {\n  flex: 1 1 auto;\n  min-width: 0;\n  background: transparent;\n  border: 0;\n  outline: none;\n  color: var(--text-primary);\n  font-size: 12px;\n}\n\n.prm-sort {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.prm-sort-select {\n  font-size: 11px;\n  padding: 3px 6px;\n}\n\n.prm-sort-dir {\n  padding: 4px 6px;\n}\n\n.prm-unread-count {\n  font-variant-numeric: tabular-nums;\n  opacity: 0.75;\n}\n\n/* Bulk-action bar (R-LIST-006). */\n.prm-bulk-bar {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 6px 10px;\n  border-radius: 6px;\n  background: rgba(47, 129, 247, 0.1);\n  border: 1px solid var(--accent-blue);\n}\n\n.prm-bulk-clear {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  padding: 2px;\n  background: transparent;\n  border: 0;\n  border-radius: 4px;\n  color: var(--text-muted);\n  cursor: pointer;\n}\n\n.prm-bulk-clear:hover {\n  background: var(--bg-hover);\n  color: var(--text-primary);\n}\n\n.prm-bulk-count {\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--text-primary);\n}\n\n.prm-bulk-actions {\n  display: inline-flex;\n  gap: 6px;\n  margin-left: auto;\n}\n\n/* Tile selection checkbox (R-LIST-006). */\n.prm-tile-select {\n  flex-shrink: 0;\n  cursor: pointer;\n}\n\n/* Check-status summary pips container (R-LIST-021). */\n.prm-check-pips {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n\n/* \u2500\u2500 Item 2: cursor discipline \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n   The tile root is itself clickable (marks seen), so it carries cursor:pointer.\n   But its decorative/text children must NOT inherit the pointer \u2014 a label or a\n   status word is not itself a button. These read as default text; the genuinely\n   interactive surfaces (buttons, links, and the check-toggle pills below) opt\n   back into pointer explicitly. */\n.prm-status-pill,\n.prm-tis,\n.prm-check-pips,\n.prm-check-pip,\n.prm-mute-indicator,\n.prm-sync-error-text,\n.prm-sync-error-icon,\n.prm-tile-state-icon,\n.prm-tile-title,\n.prm-tile-repo,\n.prm-tile-number,\n.prm-author-name,\n.prm-avatar,\n.prm-reviewers-label,\n.prm-reviewer-avatar,\n.prm-branch,\n.prm-branch-icon,\n.prm-desc,\n.prm-workitem-chip {\n  cursor: default;\n}\n\n/* \u2500\u2500 Item 6: the status pill / time-in-status pill / check pips double as the\n   per-check disclosure toggle when the PR has checks. `prm-checks-trigger` is\n   added to exactly those surfaces in that case \u2014 it restores pointer + a hover\n   affordance so they read as the clickable toggle they are. Without checks the\n   default cursor:default above stands. */\n.prm-checks-trigger,\n/* \u2026and everything inside a trigger: the check pips carry cursor:default in the\n   discipline block above, which would otherwise win over the parent trigger and\n   leave the pass/fail counts showing no pointer even though they toggle. */\n.prm-checks-trigger * {\n  cursor: pointer;\n}\n\n.prm-checks-trigger:hover {\n  filter: brightness(1.12);\n}\n\n/* \u2500\u2500 Item 10: trailing row-action set + a danger variant of the shared icon\n   button. `prm-tile-actions` groups the inline action icons and pushes them to\n   the row\'s end; `prm-tile-icon-btn--danger` tints the destructive dismiss\n   action on hover. */\n.prm-tile-actions {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n  margin-left: auto;\n  flex-shrink: 0;\n}\n\n.prm-tile-icon-btn--danger:hover {\n  background: rgba(248, 81, 73, 0.15);\n  color: var(--danger);\n}\n\n/* Active (toggled-on) row action \u2014 the favorited star reads gold + filled\n   (R-LIST-026). Keeps the gold on hover so it never flips to the default blue. */\n.prm-tile-icon-btn--active,\n.prm-tile-icon-btn--active:hover {\n  /* A bright, unambiguous yellow-gold so the filled favorite star reads as\n     yellow at 13px \u2014 the darker `--accent-gold` (#d4a017) muddies to grey at\n     this size. Declared after the base `.prm-tile-icon-btn` rule so it wins\n     the cascade at equal specificity. */\n  color: #f5b400;\n}\n\n/* Mute indicator (AC-LIST-18.3). */\n.prm-mute-indicator {\n  display: inline-flex;\n  align-items: center;\n  color: var(--text-muted);\n}\n\n/* Per-PR sync-error indicator + retry (R-LIST-023). */\n.prm-sync-error {\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  color: var(--warning, var(--accent-yellow, #d29922));\n  font-size: 10px;\n}\n\n.prm-sync-error-icon {\n  flex-shrink: 0;\n}\n\n.prm-sync-error-text {\n  text-transform: uppercase;\n  letter-spacing: 0.03em;\n  font-weight: 600;\n}\n\n/* Reviewers strip grouped by state (R-LIST-016). */\n.prm-reviewers {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 10px;\n  margin-top: 6px;\n}\n\n.prm-reviewers-group {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.prm-reviewers-label {\n  font-size: 10px;\n  color: var(--text-muted);\n  /* Item 8: breathing room between the group label and its avatars. */\n  margin-right: 4px;\n}\n\n.prm-reviewers--changes .prm-reviewer-avatar {\n  background: var(--danger);\n}\n\n.prm-reviewers--requested .prm-reviewer-avatar {\n  background: var(--text-muted);\n}\n\n.prm-reviewers--approved .prm-reviewer-avatar {\n  background: var(--success);\n}\n\n.prm-reviewer-avatar {\n  margin-left: -4px;\n}\n\n.prm-reviewer-avatar:first-of-type {\n  margin-left: 0;\n}\n\n/* Project-association ROW (item 5; R-LIST-020). Always present: muted when\n   unassociated (optional), primary when associated. Meaning is carried by the\n   label text and hover title, never by hue alone (AC-LIST-20.2a). */\n.prm-project-row {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  align-self: flex-start;\n  margin-top: 4px;\n  padding: 2px 6px 2px 4px;\n  border-radius: 6px;\n  border: 1px solid transparent;\n  background: transparent;\n  cursor: pointer;\n  font-size: 11px;\n  max-width: 100%;\n}\n\n.prm-project-row:hover {\n  background: var(--bg-hover);\n  border-color: var(--border);\n}\n\n.prm-project-row-icon {\n  flex-shrink: 0;\n}\n\n.prm-project-row-name {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.prm-project-row--associated {\n  color: var(--text-primary);\n}\n\n.prm-project-row--unassociated {\n  color: var(--text-muted);\n}\n\n/* Sync & Filter picker (R-LIST-002). Reuses prm-tile-menu base. */\n.prm-sync-filter {\n  min-width: 240px;\n  max-width: 320px;\n  padding: 6px;\n}\n\n.prm-sync-filter-header {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  padding: 4px 8px 8px;\n}\n\n.prm-sync-filter-desc {\n  font-size: 11px;\n  color: var(--text-muted);\n}\n\n.prm-sync-filter-check {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 14px;\n  color: var(--accent-blue);\n}\n\n.prm-sync-filter-host {\n  color: var(--text-dim);\n  font-size: 10px;\n}\n\n.prm-sync-filter-footer {\n  display: flex;\n  justify-content: flex-end;\n  gap: 6px;\n  padding: 8px 4px 2px;\n}\n\n/* Host filter picker (R-LIST-027). Reuses prm-tile-menu + prm-sync-filter-*. */\n.prm-host-filter {\n  min-width: 200px;\n  max-width: 280px;\n  padding: 6px;\n}\n\n/* Toolbar toggle button \u2014 highlighted while the host filter narrows the list. */\n.prm-btn.is-active {\n  background: var(--accent-blue);\n  border-color: var(--accent-blue);\n  color: white;\n}\n\n.prm-tile-checks {\n  margin-top: 6px;\n}\n\n/* Filtered-empty state (AC-LIST-24.2). */\n.prm-empty--filtered {\n  padding: 32px 16px;\n}\n\n.prm-empty-actions {\n  display: flex;\n  justify-content: center;\n  gap: 8px;\n  margin-top: 12px;\n}\n\n/* Modal description line shared by Pull PR (and others). */\n.prm-modal-desc {\n  margin: 0 0 12px;\n  font-size: 12px;\n  color: var(--text-muted);\n}\n\n/* \u2500\u2500 List / Board view toggle (BB-style segmented control) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-view-toggle {\n  display: inline-flex;\n  align-items: center;\n  gap: 1px;\n  padding: 2px;\n  border-radius: 8px;\n  background: var(--bg-elevated);\n  border: 1px solid var(--border);\n  flex-shrink: 0;\n}\n\n.prm-view-toggle-btn {\n  appearance: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  padding: 4px 8px;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--text-muted);\n  font-size: 11px;\n  font-weight: 550;\n  font-family: inherit;\n  cursor: pointer;\n  line-height: 1.2;\n}\n\n.prm-view-toggle-btn svg {\n  display: block;\n  flex-shrink: 0;\n}\n\n.prm-view-toggle-btn:hover {\n  color: var(--text-primary);\n}\n\n.prm-view-toggle-btn[aria-pressed=\'true\'] {\n  background: var(--bg-base);\n  color: var(--text-primary);\n  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);\n}\n\n.prm-view-toggle-btn:focus-visible {\n  outline: 2px solid var(--accent-blue);\n  outline-offset: 1px;\n}\n\n/* \u2500\u2500 Kanban board \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\n.prm-content--board {\n  overflow: hidden;\n}\n\n.prm-list--board {\n  overflow: hidden;\n  min-height: 0;\n  padding: 8px 10px 0;\n}\n\n.prm-list--board .prm-list-toolbar {\n  flex-shrink: 0;\n  margin-bottom: 0;\n  border-bottom: 0;\n  padding-bottom: 8px;\n}\n\n.prm-board {\n  flex: 1 1 auto;\n  min-height: 0;\n  display: flex;\n  align-items: stretch;\n  gap: 10px;\n  overflow-x: auto;\n  overflow-y: hidden;\n  padding: 0 2px 12px;\n}\n\n.prm-board-col {\n  display: flex;\n  flex-direction: column;\n  width: 260px;\n  min-width: 260px;\n  max-height: 100%;\n  background: color-mix(in srgb, var(--bg-elevated) 65%, transparent);\n  border: 1px solid var(--border);\n  border-radius: 12px;\n  overflow: hidden;\n}\n\n.prm-board-col-header {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 10px 12px 8px;\n  flex-shrink: 0;\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--text-primary);\n  border-bottom: 1px solid var(--border);\n}\n\n.prm-board-col-icon {\n  flex-shrink: 0;\n}\n\n.prm-board-col-title {\n  min-width: 0;\n}\n\n.prm-board-col-count {\n  font-weight: 500;\n  color: var(--text-muted);\n  font-variant-numeric: tabular-nums;\n}\n\n.prm-board-col-unread {\n  min-width: 16px;\n  padding: 0 6px;\n  border-radius: 8px;\n  background: var(--accent-blue);\n  color: white;\n  font-size: 10px;\n  font-weight: 700;\n  line-height: 16px;\n  text-align: center;\n  font-variant-numeric: tabular-nums;\n}\n\n.prm-board-col-collapse {\n  margin-left: auto;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 22px;\n  height: 22px;\n  padding: 0;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--text-muted);\n  cursor: pointer;\n}\n\n.prm-board-col-collapse:hover {\n  background: var(--bg-hover, color-mix(in srgb, var(--text) 8%, transparent));\n  color: var(--text);\n}\n\n.prm-board-col--collapsed {\n  width: 44px;\n  min-width: 44px;\n  max-width: 44px;\n}\n\n.prm-board-col--collapsed .prm-board-col-header {\n  flex: 1 1 auto;\n  flex-direction: column;\n  align-items: center;\n  gap: 8px;\n  padding: 10px 4px 12px;\n  border-bottom: 0;\n}\n\n.prm-board-col--collapsed .prm-board-col-title {\n  writing-mode: vertical-rl;\n  transform: rotate(180deg);\n  font-size: 11px;\n}\n\n.prm-board-col--collapsed .prm-board-col-count,\n.prm-board-col--collapsed .prm-board-col-unread {\n  writing-mode: horizontal-tb;\n}\n\n.prm-board-col--collapsed .prm-board-col-collapse {\n  margin-left: 0;\n  margin-top: auto;\n}\n\n.prm-board-col--collapsed .prm-board-col-body {\n  display: none;\n}\n\n.prm-board-col-body {\n  flex: 1 1 auto;\n  min-height: 0;\n  overflow-y: auto;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 8px;\n}\n\n.prm-board-col-empty {\n  padding: 18px 8px;\n  text-align: center;\n  font-size: 11px;\n  color: var(--text-dim);\n}\n\n.prm-board-col--conflict .prm-board-col-icon,\n.prm-board-col--failed .prm-board-col-icon {\n  color: var(--danger);\n}\n\n.prm-board-col--yellow .prm-board-col-icon,\n.prm-board-col--pending .prm-board-col-icon {\n  color: var(--accent-gold);\n}\n\n.prm-board-col--review-required .prm-board-col-icon,\n.prm-board-col--integrating .prm-board-col-icon {\n  color: var(--accent-blue);\n}\n\n.prm-board-col--green .prm-board-col-icon,\n.prm-board-col--closed-merged .prm-board-col-icon {\n  color: var(--success);\n}\n\n.prm-board-col--closed-abandoned .prm-board-col-icon {\n  color: var(--text-muted);\n}\n\n.prm-board-col--conflict,\n.prm-board-col--failed {\n  box-shadow: inset 0 2px 0 var(--danger);\n}\n\n.prm-board-col--yellow,\n.prm-board-col--pending {\n  box-shadow: inset 0 2px 0 var(--accent-gold);\n}\n\n.prm-board-col--review-required,\n.prm-board-col--integrating {\n  box-shadow: inset 0 2px 0 var(--accent-blue);\n}\n\n.prm-board-col--green,\n.prm-board-col--closed-merged {\n  box-shadow: inset 0 2px 0 var(--success);\n}\n\n.prm-board-card {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  padding: 10px 10px 8px;\n  border-radius: 10px;\n  background: var(--bg-panel, var(--bg-base));\n  border: 1px solid var(--border);\n  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);\n  cursor: default;\n  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;\n}\n\n.prm-board-card:hover {\n  border-color: var(--border-strong);\n  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);\n}\n\n.prm-board-card:focus-visible {\n  outline: 2px solid var(--accent-blue);\n  outline-offset: 1px;\n}\n\n.prm-board-card--unread {\n  border-left: 2px solid var(--accent-blue);\n  cursor: pointer;\n}\n\n.prm-board-card--unread .prm-board-card-title {\n  font-weight: 600;\n}\n\n.prm-board-card--favorite {\n  background: color-mix(in srgb, var(--accent-gold, #d4a017) 18%, var(--bg-base));\n}\n\n.prm-board-card--favorite:hover {\n  background: color-mix(in srgb, var(--accent-gold, #d4a017) 26%, var(--bg-base));\n}\n\n.prm-board-card--selected {\n  background: color-mix(in srgb, var(--accent-blue) 10%, var(--bg-base));\n  border-color: color-mix(in srgb, var(--accent-blue) 35%, var(--border));\n}\n\n.prm-board-card--closed {\n  opacity: 0.72;\n}\n\n.prm-board-card--stale {\n  border-left: 3px solid var(--warning, var(--accent-gold, #d29922));\n}\n\n.prm-board-card-top {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n}\n\n.prm-board-card-select {\n  flex-shrink: 0;\n  opacity: 0;\n  pointer-events: none;\n  margin: 0;\n}\n\n.prm-board-card:hover .prm-board-card-select,\n.prm-board-card:focus-within .prm-board-card-select,\n.prm-board-card--selected .prm-board-card-select,\n.prm-board-card--select-mode .prm-board-card-select,\n.prm-board-card--selectable .prm-board-card-select {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n.prm-board-card--select-mode {\n  cursor: pointer;\n}\n\n.prm-board-card-id {\n  display: flex;\n  align-items: baseline;\n  gap: 6px;\n  min-width: 0;\n  flex: 0 1 auto;\n  overflow: hidden;\n  font-size: 11px;\n  color: var(--text-muted);\n  font-variant-numeric: tabular-nums;\n}\n\n.prm-board-card-num {\n  flex-shrink: 0;\n  font-weight: 650;\n}\n\n.prm-board-card-repo {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 10px;\n  color: var(--text-faint, var(--text-dim));\n}\n\n.prm-board-card-wi {\n  flex-shrink: 0;\n  font-size: 9px;\n  padding: 1px 5px;\n}\n\n.prm-board-card-draft {\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  flex-shrink: 0;\n  font-size: 9px;\n  font-weight: 650;\n  letter-spacing: 0.04em;\n  text-transform: uppercase;\n  color: var(--text-faint, var(--text-dim));\n}\n\n.prm-board-card-actions {\n  display: flex;\n  align-items: center;\n  gap: 1px;\n  margin-left: auto;\n  flex-shrink: 0;\n  opacity: 0;\n  pointer-events: none;\n  transition: opacity 0.12s;\n}\n\n.prm-board-card:hover .prm-board-card-actions,\n.prm-board-card:focus-within .prm-board-card-actions,\n.prm-board-card--selected .prm-board-card-actions,\n.prm-board-card--favorite .prm-board-card-actions {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n@media (hover: none) {\n  .prm-board-card-actions,\n  .prm-board-card-select {\n    opacity: 1;\n    pointer-events: auto;\n  }\n}\n\n.prm-board-card-title {\n  font-size: 13px;\n  line-height: 1.35;\n  color: var(--text-primary);\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  line-clamp: 2;\n  overflow: hidden;\n}\n\n.prm-board-card-meta {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 6px;\n  font-size: 11px;\n  color: var(--text-muted);\n}\n\n.prm-board-card-time {\n  font-variant-numeric: tabular-nums;\n}\n\n.prm-board-card .prm-avatar {\n  width: 18px;\n  height: 18px;\n  font-size: 8px;\n}\n\n@media (max-width: 640px) {\n  .prm-view-toggle-btn span {\n    display: none;\n  }\n\n  .prm-board-col {\n    width: 220px;\n    min-width: 220px;\n  }\n}\n\n';

// app.tsx
var PLUGIN_ID = "pr-monitor";
var STYLE_TAG_ID = "prm-plugin-styles";
function injectStyles() {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = styles_default;
    return;
  }
  const tag = document.createElement("style");
  tag.id = STYLE_TAG_ID;
  tag.textContent = styles_default;
  document.head.appendChild(tag);
}
injectStyles();
var panelRootStyle = { height: "100%", minHeight: 0, display: "flex", flexDirection: "column" };
function Panel() {
  const host = useMemo(() => createPluginPanelHost(PLUGIN_ID), []);
  return /* @__PURE__ */ jsx("div", { style: panelRootStyle, children: /* @__PURE__ */ jsx(PrMonitorPanel, { host }) });
}
function NavBadge() {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const result = await callPluginRpc(PLUGIN_ID, "badge");
        if (!alive) return;
        const next = typeof result?.count === "number" && result.count > 0 ? result.count : null;
        setCount(next);
      } catch {
        if (alive) setCount(null);
      }
    };
    void tick();
    setBadgeRefresh(() => {
      void tick();
    });
    const id = window.setInterval(() => {
      void tick();
    }, 3e4);
    return () => {
      alive = false;
      window.clearInterval(id);
      setBadgeRefresh(void 0);
    };
  }, []);
  if (count == null) return null;
  return /* @__PURE__ */ jsx("span", { className: "nav-badge", children: count });
}
var app_default = definePluginApp((app) => {
  app.slots.navPanel({
    id: "main",
    title: "PR Monitor",
    icon: "GitPullRequest",
    component: Panel,
    experimental_sidebarAccessory: NavBadge
  });
  app.slots.commandPaletteAction({
    id: "open",
    title: "Open PR Monitor",
    run: (ctx) => {
      ctx.toPluginPanel("main");
    }
  });
});
export {
  app_default as default,
  injectStyles
};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs:
lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs:
lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs:
lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs:
lucide-react/dist/esm/defaultAttributes.mjs:
lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs:
lucide-react/dist/esm/context.mjs:
lucide-react/dist/esm/Icon.mjs:
lucide-react/dist/esm/createLucideIcon.mjs:
lucide-react/dist/esm/icons/arrow-down.mjs:
lucide-react/dist/esm/icons/arrow-left.mjs:
lucide-react/dist/esm/icons/arrow-up.mjs:
lucide-react/dist/esm/icons/bell-off.mjs:
lucide-react/dist/esm/icons/bell.mjs:
lucide-react/dist/esm/icons/book-marked.mjs:
lucide-react/dist/esm/icons/building-2.mjs:
lucide-react/dist/esm/icons/check.mjs:
lucide-react/dist/esm/icons/chevron-down.mjs:
lucide-react/dist/esm/icons/chevron-right.mjs:
lucide-react/dist/esm/icons/circle-alert.mjs:
lucide-react/dist/esm/icons/circle-check.mjs:
lucide-react/dist/esm/icons/circle-dashed.mjs:
lucide-react/dist/esm/icons/circle-question-mark.mjs:
lucide-react/dist/esm/icons/circle-x.mjs:
lucide-react/dist/esm/icons/clock.mjs:
lucide-react/dist/esm/icons/cloud-off.mjs:
lucide-react/dist/esm/icons/columns-3.mjs:
lucide-react/dist/esm/icons/download.mjs:
lucide-react/dist/esm/icons/external-link.mjs:
lucide-react/dist/esm/icons/eye-off.mjs:
lucide-react/dist/esm/icons/eye.mjs:
lucide-react/dist/esm/icons/folder-git-2.mjs:
lucide-react/dist/esm/icons/folder-search.mjs:
lucide-react/dist/esm/icons/git-branch.mjs:
lucide-react/dist/esm/icons/git-merge.mjs:
lucide-react/dist/esm/icons/git-pull-request-closed.mjs:
lucide-react/dist/esm/icons/git-pull-request-draft.mjs:
lucide-react/dist/esm/icons/git-pull-request.mjs:
lucide-react/dist/esm/icons/globe.mjs:
lucide-react/dist/esm/icons/layout-list.mjs:
lucide-react/dist/esm/icons/link-2.mjs:
lucide-react/dist/esm/icons/loader-circle.mjs:
lucide-react/dist/esm/icons/mail-open.mjs:
lucide-react/dist/esm/icons/mail.mjs:
lucide-react/dist/esm/icons/panel-left-close.mjs:
lucide-react/dist/esm/icons/pen.mjs:
lucide-react/dist/esm/icons/plus.mjs:
lucide-react/dist/esm/icons/refresh-cw.mjs:
lucide-react/dist/esm/icons/search.mjs:
lucide-react/dist/esm/icons/settings.mjs:
lucide-react/dist/esm/icons/shield-alert.mjs:
lucide-react/dist/esm/icons/sparkles.mjs:
lucide-react/dist/esm/icons/square-check-big.mjs:
lucide-react/dist/esm/icons/star.mjs:
lucide-react/dist/esm/icons/trash-2.mjs:
lucide-react/dist/esm/icons/triangle-alert.mjs:
lucide-react/dist/esm/icons/users.mjs:
lucide-react/dist/esm/icons/wifi-off.mjs:
lucide-react/dist/esm/icons/wifi.mjs:
lucide-react/dist/esm/icons/wrench.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.31.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
