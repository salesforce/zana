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

// zcc-host-react:react-dom
var ReactDOM = globalThis.__ZCC_HOST_REACT_DOM__;
if (ReactDOM == null) {
  throw new Error("host react-dom is not available");
}
var createPortal = ReactDOM.createPortal;
var flushSync = ReactDOM.flushSync;
var hydrate = ReactDOM.hydrate;
var render = ReactDOM.render;
var unmountComponentAtNode = ReactDOM.unmountComponentAtNode;
var findDOMNode = ReactDOM.findDOMNode;
var version2 = ReactDOM.version;

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
var toKebabCase = (string) => string?.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs
function toLucideIconData(iconName, iconNode, aliases = []) {
  if (iconNode == null) {
    throw new Error("[lucide]: iconNode is required when icon name is used");
  }
  return {
    name: toKebabCase(iconName),
    size: 24,
    node: iconNode,
    ...aliases.length > 0 ? { aliases } : {}
  };
}

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
var toCamelCase = (string) => {
  let out = "";
  let upperNext = false;
  for (const ch of string) {
    if (ch === "-" || ch === "_" || ch <= " ") {
      upperNext = out.length > 0;
      continue;
    }
    if (out.length === 0) {
      out += ch.toLowerCase();
    } else {
      out += upperNext ? ch.toUpperCase() : ch;
    }
    upperNext = false;
  }
  return out;
};

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs
var toPascalCase = (string) => {
  const camelCase = toCamelCase(string);
  return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
};

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/build/defaultAttributes.mjs
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
};

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconNode.mjs
function isDefined(value) {
  return value !== null && value !== void 0;
}
function buildLucideIconNode(icon, params = {}) {
  const attributeNames = params.attributeNames ?? {};
  const getAttributeName = (attributeName) => attributeNames[attributeName] ?? attributeName;
  const viewBoxWidth = icon.size ?? icon.width ?? defaultAttributes["width"];
  const viewBoxHeight = icon.size ?? icon.height ?? defaultAttributes["height"];
  const aliasClassNames = icon.aliases?.filter((alias) => typeof alias === "string" && alias.trim() !== "").map((alias) => `lucide-${alias}`) ?? [];
  const iconClassNames = [...icon.name ? [`lucide-${icon.name}`] : [], ...aliasClassNames];
  const classNamesFromClassName = params.className?.split(" ").filter(Boolean) ?? [];
  const className = params.includeDefaultClasses === false ? mergeClasses(...classNamesFromClassName) : mergeClasses("lucide", ...iconClassNames, ...classNamesFromClassName);
  const calculatedStrokeWidth = params.absoluteStrokeWidth ? Number(params.strokeWidth ?? defaultAttributes["stroke-width"]) * Number(icon.size ?? icon.width ?? defaultAttributes["width"]) / Number(params.size ?? params.width ?? defaultAttributes["width"]) : params.strokeWidth ?? defaultAttributes["stroke-width"];
  const attributes = {
    ...Object.entries(defaultAttributes).reduce((attrs, [attrName, value]) => {
      attrs[getAttributeName(attrName)] = value;
      return attrs;
    }, {}),
    ..."color" in params && params.color && {
      [getAttributeName("stroke")]: params.color
    },
    ..."size" in params && isDefined(params.size) && {
      [getAttributeName("width")]: params.size,
      [getAttributeName("height")]: params.size
    },
    ..."width" in params && isDefined(params.width) && {
      [getAttributeName("width")]: params.width
    },
    ..."height" in params && isDefined(params.height) && {
      [getAttributeName("height")]: params.height
    },
    [getAttributeName("stroke-width")]: calculatedStrokeWidth,
    ...className && {
      [getAttributeName("class")]: className
    },
    [getAttributeName("viewBox")]: `0 0 ${viewBoxWidth} ${viewBoxHeight}`,
    ...params.hasA11yProp === false ? {
      [getAttributeName("aria-hidden")]: "true"
    } : {},
    ..."attributes" in params && params.attributes
  };
  return [
    "svg",
    attributes,
    icon.node.map((child) => {
      const [name, attrs, children] = child;
      const nextAttrs = params.nonScalingStroke ? { [getAttributeName("vector-effect")]: "non-scaling-stroke", ...attrs } : attrs;
      return children ? [name, nextAttrs, children] : [name, nextAttrs];
    })
  ];
}

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconForReact.mjs
function buildLucideIconForReact(icon, params = {}) {
  return buildLucideIconNode(icon, {
    ...params,
    attributeNames: {
      ...params.attributeNames,
      class: "className",
      "stroke-width": "strokeWidth",
      "stroke-linecap": "strokeLinecap",
      "stroke-linejoin": "strokeLinejoin",
      "vector-effect": "vectorEffect"
    }
  });
}

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
var hasA11yProp = (props) => {
  for (const prop in props) {
    if (prop.startsWith("aria-") || prop === "role" || prop === "title") {
      return true;
    }
  }
  return false;
};

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/context.mjs
var LucideContext = createContext({});
var useLucideContext = () => useContext(LucideContext);

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/Icon.mjs
var Icon = forwardRef(
  ({
    color,
    size,
    width,
    height,
    strokeWidth,
    absoluteStrokeWidth,
    nonScalingStroke,
    className = "",
    children,
    iconNode = [],
    icon = {
      node: iconNode,
      aliases: [],
      size: 24
    },
    ...rest
  }, ref) => {
    const {
      size: contextSize = 24,
      strokeWidth: contextStrokeWidth = 2,
      absoluteStrokeWidth: contextAbsoluteStrokeWidth = false,
      nonScalingStroke: contextNonScalingStroke = false,
      color: contextColor = "currentColor",
      className: contextClass = ""
    } = useLucideContext() ?? {};
    const hasAccessibleProp = Boolean(children) || hasA11yProp(rest);
    const [name, svgAttributes, builtIconNode = []] = buildLucideIconForReact(icon, {
      color: color ?? contextColor,
      width: width ?? size ?? contextSize,
      height: height ?? size ?? contextSize,
      strokeWidth: strokeWidth ?? contextStrokeWidth,
      absoluteStrokeWidth: absoluteStrokeWidth ?? contextAbsoluteStrokeWidth,
      nonScalingStroke: nonScalingStroke ?? contextNonScalingStroke,
      className: mergeClasses(contextClass, className),
      hasA11yProp: hasAccessibleProp,
      attributes: rest
    });
    return createElement(
      name,
      {
        ref,
        ...svgAttributes
      },
      [
        ...builtIconNode.map(([tag, attrs]) => createElement(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/createLucideIcon.mjs
function createLucideIcon(iconDataOrName, iconNode = [], aliases = []) {
  const iconData = typeof iconDataOrName === "string" ? toLucideIconData(iconDataOrName, iconNode, aliases) : iconDataOrName;
  const Component2 = forwardRef(
    ({ className, ...props }, ref) => createElement(Icon, {
      ref,
      icon: iconData,
      className,
      ...props
    })
  );
  if (iconData.name) {
    Component2.displayName = toPascalCase(iconData.name);
  }
  return Component2;
}

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/icons/check.mjs
var __iconData = {
  name: "check",
  size: 24,
  node: [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]
};
__iconData.node;
var Check = createLucideIcon(__iconData);

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/icons/chevron-down.mjs
var __iconData2 = {
  name: "chevron-down",
  size: 24,
  node: [["path", { d: "m6 9 6 6 6-6", key: "qrunsl" }]]
};
__iconData2.node;
var ChevronDown = createLucideIcon(__iconData2);

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/icons/pin.mjs
var __iconData3 = {
  name: "pin",
  size: 24,
  node: [
    ["path", { d: "M12 17v5", key: "bb1du9" }],
    [
      "path",
      {
        d: "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
        key: "1nkz8b"
      }
    ]
  ]
};
__iconData3.node;
var Pin = createLucideIcon(__iconData3);

// ../../node_modules/.pnpm/lucide-react@1.47.0_react@19.3.0/node_modules/lucide-react/dist/esm/icons/search.mjs
var __iconData4 = {
  name: "search",
  size: 24,
  node: [
    ["path", { d: "m21 21-4.34-4.34", key: "14j7rj" }],
    ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }]
  ]
};
__iconData4.node;
var Search = createLucideIcon(__iconData4);

// ../../packages/ui/src/use-exclusive-popover.ts
var activeId = null;
var listeners = /* @__PURE__ */ new Set();
function emit() {
  listeners.forEach((listener) => listener());
}
function open(id) {
  if (activeId === id) return;
  activeId = id;
  emit();
}
function close(id) {
  if (activeId !== id) return;
  activeId = null;
  emit();
}
function isOpen(id) {
  return activeId === id;
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function useExclusivePopover() {
  const idRef = useRef(null);
  if (!idRef.current) idRef.current = /* @__PURE__ */ Symbol("popover");
  const id = idRef.current;
  const isCurrentlyOpen = useSyncExternalStore(subscribe, () => isOpen(id), () => false);
  const setOpen = (next) => {
    const resolved = typeof next === "function" ? next(isOpen(id)) : next;
    if (resolved) open(id);
    else close(id);
  };
  return [isCurrentlyOpen, setOpen];
}

// zcc-host-react:react/jsx-runtime
var React2 = globalThis.__ZCC_HOST_REACT__;
var Fragment2 = React2.Fragment;
function jsx(type, props, key) {
  return React2.createElement(type, key === void 0 ? props : { ...props, key });
}
var jsxs = jsx;

// ../../packages/ui/src/popover-picklist.tsx
var useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
var VIEWPORT_PAD = 8;
var MENU_GAP = 4;
var FLIP_BELOW_PX = 160;
var MENU_MAX_HEIGHT_PX = 360;
var MENU_MAX_HEIGHT_VH = 0.55;
function placePopoverMenu(trigger, viewport, minWidth) {
  const width = Math.min(Math.max(trigger.width, minWidth), Math.max(0, viewport.width - 2 * VIEWPORT_PAD));
  let left = trigger.left;
  if (left + width > viewport.width - VIEWPORT_PAD) {
    left = trigger.right - width;
  }
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
  if (left + width > viewport.width - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, viewport.width - width - VIEWPORT_PAD);
  }
  const spaceBelow = viewport.height - trigger.bottom - VIEWPORT_PAD;
  const spaceAbove = trigger.top - VIEWPORT_PAD;
  const openAbove = spaceBelow < FLIP_BELOW_PX && spaceAbove > spaceBelow;
  const available = Math.max(0, (openAbove ? spaceAbove : spaceBelow) - MENU_GAP);
  const cap = Math.min(
    MENU_MAX_HEIGHT_PX,
    Math.floor(viewport.height * MENU_MAX_HEIGHT_VH)
  );
  const maxHeight = Math.min(available, cap);
  if (openAbove) {
    return {
      left,
      width,
      maxHeight,
      bottom: viewport.height - trigger.top + MENU_GAP
    };
  }
  return {
    left,
    width,
    maxHeight,
    top: trigger.bottom + MENU_GAP
  };
}
function picklistOptionVisible(option, query) {
  if (option.sticky) return true;
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = `${option.label} ${option.compactLabel ?? ""} ${option.description ?? ""}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}
function splitPicklistOptions(options, query, searchable = true) {
  const items = [];
  const sticky = [];
  for (const option of options) {
    if (option.sticky) {
      sticky.push(option);
      continue;
    }
    if (!searchable || picklistOptionVisible(option, query)) items.push(option);
  }
  return { items, sticky };
}
function PicklistOptionRow({
  option,
  previousGroup,
  optionId,
  selected,
  active,
  onHover,
  onSelect
}) {
  return /* @__PURE__ */ jsxs("div", { children: [
    option.group && option.group !== previousGroup && /* @__PURE__ */ jsx("div", { className: "launch-model-picker-group-label", children: option.group }),
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        id: optionId,
        className: `launch-model-picker-option${option.description ? " launch-model-picker-option--stacked" : ""}${option.className ? ` ${option.className}` : ""}${selected ? " is-selected" : ""}${active ? " is-active" : ""}${option.tone === "warning" ? " is-warning" : ""}`,
        role: "option",
        "aria-selected": selected,
        "aria-disabled": option.disabled || void 0,
        disabled: option.disabled,
        tabIndex: -1,
        onMouseEnter: onHover,
        onFocus: onHover,
        onClick: onSelect,
        children: [
          option.content || option.description ? /* @__PURE__ */ jsxs("span", { className: "launch-model-picker-option-copy", children: [
            option.content ?? /* @__PURE__ */ jsx("span", { children: option.label }),
            option.description ? /* @__PURE__ */ jsx("span", { className: "launch-model-picker-option-description", children: option.description }) : null
          ] }) : /* @__PURE__ */ jsx("span", { children: option.label }),
          selected && /* @__PURE__ */ jsx(Check, { size: 14, "aria-hidden": "true" })
        ]
      }
    )
  ] });
}
function PopoverPicklist({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder = "Select\u2026",
  disabled,
  title,
  ariaKeyshortcuts,
  searchable = true,
  searchPlaceholder = "Search\u2026",
  emptyHint = "No matches",
  className = "",
  triggerClassName = "launch-model-picker-trigger",
  triggerTestId,
  triggerIcon,
  minWidth = 200,
  anchorToParent = false
}) {
  const [open2, setOpen] = useExclusivePopover();
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const wasOpenRef = useRef(false);
  const menuId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const { items: visibleItems, sticky: stickyOptions } = useMemo(
    () => splitPicklistOptions(options, query, searchable),
    [options, query, searchable]
  );
  const visibleOptions = useMemo(
    () => [...visibleItems, ...stickyOptions],
    [stickyOptions, visibleItems]
  );
  const activeOption = visibleOptions[activeIndex];
  const optionId = (option) => `${menuId}-${option.value}`;
  const selectOption = (option) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };
  const moveActive = (direction) => {
    if (visibleOptions.length === 0) return;
    setActiveIndex((current) => {
      for (let offset = 1; offset <= visibleOptions.length; offset += 1) {
        const index = (current + direction * offset + visibleOptions.length) % visibleOptions.length;
        if (!visibleOptions[index].disabled) return index;
      }
      return current;
    });
  };
  const handleMenuKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const index = visibleOptions.findIndex((option) => !option.disabled);
      if (index >= 0) setActiveIndex(index);
    } else if (event.key === "End") {
      event.preventDefault();
      const index = visibleOptions.length - 1 - [...visibleOptions].reverse().findIndex((option) => !option.disabled);
      if (index >= 0) setActiveIndex(index);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectOption(activeOption);
    }
  };
  useIsomorphicLayoutEffect(() => {
    if (!open2 || !triggerRef.current) return;
    const trigger = triggerRef.current;
    const anchor = anchorToParent && trigger.parentElement || trigger;
    const place = () => {
      setPosition(placePopoverMenu(anchor.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight
      }, minWidth));
    };
    const onScroll = (event) => {
      if (!menuRef.current?.contains(event.target)) place();
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", onScroll, true);
    const observer = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(place);
    observer?.observe(anchor);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open2, anchorToParent, minWidth]);
  useEffect(() => {
    if (!open2) return;
    const close2 = (event) => {
      const target = event.target;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close2, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", close2, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open2]);
  useEffect(() => {
    if (open2) {
      const selectedIndex = visibleOptions.findIndex((option) => option.value === value && !option.disabled);
      const firstEnabledIndex = visibleOptions.findIndex((option) => !option.disabled);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : Math.max(0, firstEnabledIndex));
    } else {
      setQuery("");
      if (wasOpenRef.current) triggerRef.current?.focus({ preventScroll: true });
    }
    wasOpenRef.current = open2;
  }, [open2, searchable, value]);
  const menuPlaced = open2 && position !== null;
  useEffect(() => {
    if (!menuPlaced) return;
    if (searchable) searchRef.current?.focus({ preventScroll: true });
    else menuRef.current?.focus({ preventScroll: true });
  }, [menuPlaced, searchable]);
  useEffect(() => {
    if (activeIndex >= visibleOptions.length) setActiveIndex(0);
  }, [activeIndex, visibleOptions.length]);
  useEffect(() => {
    if (!open2 || !activeOption || activeOption.sticky) return;
    const node = menuRef.current?.querySelector(`[id="${CSS.escape(optionId(activeOption))}"]`);
    const list = node?.closest(".launch-model-picker-options");
    if (!node || !list) return;
    const option = node.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (option.bottom > bounds.bottom) list.scrollTop += option.bottom - bounds.bottom;
    else if (option.top < bounds.top) list.scrollTop -= bounds.top - option.top;
  }, [activeIndex, activeOption, open2]);
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        ref: triggerRef,
        id,
        type: "button",
        className: `${triggerClassName} ${className}${selected?.tone === "warning" ? " is-warning" : ""}`,
        disabled,
        title,
        "aria-keyshortcuts": ariaKeyshortcuts,
        onClick: () => setOpen((current) => !current),
        onKeyDown: (event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        },
        "aria-haspopup": "listbox",
        "aria-expanded": open2,
        "aria-controls": open2 ? menuId : void 0,
        "aria-label": ariaLabel,
        "data-testid": triggerTestId ?? id,
        children: [
          triggerIcon,
          /* @__PURE__ */ jsx("span", { children: selected?.compactLabel ?? selected?.label ?? placeholder }),
          /* @__PURE__ */ jsx(ChevronDown, { size: 14, "aria-hidden": "true" })
        ]
      }
    ),
    open2 && createPortal(
      /* @__PURE__ */ jsxs(
        "div",
        {
          ref: menuRef,
          className: "launch-model-picker-menu launch-model-picker-menu--split",
          role: "listbox",
          id: menuId,
          tabIndex: -1,
          "aria-label": ariaLabel,
          "aria-activedescendant": activeOption ? optionId(activeOption) : void 0,
          onKeyDown: handleMenuKeyDown,
          style: position ? {
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            ...position.bottom != null ? { bottom: position.bottom, top: "auto" } : { top: position.top }
          } : { visibility: "hidden" },
          children: [
            searchable && /* @__PURE__ */ jsxs("div", { className: "launch-model-picker-search", children: [
              /* @__PURE__ */ jsx(Search, { size: 13, "aria-hidden": "true" }),
              /* @__PURE__ */ jsx(
                "input",
                {
                  ref: searchRef,
                  value: query,
                  onChange: (event) => setQuery(event.target.value),
                  placeholder: searchPlaceholder,
                  "aria-label": searchPlaceholder,
                  "aria-activedescendant": activeOption ? optionId(activeOption) : void 0
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "launch-model-picker-options", children: [
              visibleItems.map((option, index) => /* @__PURE__ */ jsx(
                PicklistOptionRow,
                {
                  option,
                  previousGroup: visibleItems[index - 1]?.group,
                  optionId: optionId(option),
                  selected: value === option.value,
                  active: activeIndex === index,
                  onHover: () => setActiveIndex(index),
                  onSelect: () => selectOption(option)
                },
                option.value
              )),
              visibleItems.length === 0 && /* @__PURE__ */ jsx("div", { className: "launch-model-picker-hint", children: emptyHint })
            ] }),
            stickyOptions.length > 0 && /* @__PURE__ */ jsx("div", { className: "launch-model-picker-footer", children: stickyOptions.map((option, offset) => {
              const index = visibleItems.length + offset;
              return /* @__PURE__ */ jsx(
                PicklistOptionRow,
                {
                  option,
                  previousGroup: offset === 0 ? void 0 : stickyOptions[offset - 1]?.group,
                  optionId: optionId(option),
                  selected: value === option.value,
                  active: activeIndex === index,
                  onHover: () => setActiveIndex(index),
                  onSelect: () => selectOption(option)
                },
                option.value
              );
            }) })
          ]
        }
      ),
      document.body
    )
  ] });
}

// ../../packages/plugin-sdk/src/app.ts
function pluginHost() {
  const host = globalThis.__ZCC_PLUGIN_HOST__;
  if (!host) throw new Error("plugin host is not available");
  return host;
}
function pluginRuntime() {
  return globalThis.__ZCC_PLUGIN_RUNTIME__ ?? {};
}
function missing(name) {
  throw new Error(`${name} is not available until the host plugin runtime is installed`);
}
async function callPluginRpc(pluginId, method, args) {
  return pluginHost().callRpc(pluginId, method, args);
}
function definePluginApp(setup) {
  return { __zccPluginApp: true, setup };
}
function useRpc() {
  return pluginRuntime().useRpc?.() ?? missing("useRpc");
}
function useRealtime(channel, handler) {
  pluginRuntime().useRealtime?.(channel, handler);
}
function useZccNavigate() {
  return pluginRuntime().useZccNavigate?.() ?? missing("useZccNavigate");
}

// src/BotMemory.tsx
function BotMemory({ tag, projectId }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    setPage(null);
    callPluginRpc("memory", "listTagged", { tag, projectId, offset }).then((result) => {
      if (live) setPage(result);
    }).catch(() => {
      if (live) setError("Couldn\u2019t load memories. Check that the Memory plugin is enabled and up to date.");
    });
    return () => {
      live = false;
    };
  }, [tag, projectId, offset, retry]);
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    error ? /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
      /* @__PURE__ */ jsx("span", { role: "alert", children: error }),
      /* @__PURE__ */ jsx("button", { className: "bt-btn", onClick: () => setRetry(retry + 1), children: "Retry" })
    ] }) : !page ? /* @__PURE__ */ jsx("p", { className: "bt-empty-line", children: "Loading memories\u2026" }) : !page.memories.length ? /* @__PURE__ */ jsx("p", { className: "bt-empty-line", children: "No memories on this page." }) : page.memories.map((memory) => /* @__PURE__ */ jsxs("details", { className: "bt-memory", children: [
      /* @__PURE__ */ jsxs("summary", { children: [
        /* @__PURE__ */ jsx("strong", { children: memory.name }),
        /* @__PURE__ */ jsx("span", { className: "bt-sub", children: memory.summary })
      ] }),
      /* @__PURE__ */ jsx("p", { children: memory.details })
    ] }, memory.id)),
    (offset > 0 || page?.hasMore) && /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
      /* @__PURE__ */ jsx("button", { className: "bt-btn", disabled: !offset, onClick: () => setOffset(offset - 20), children: "Previous" }),
      /* @__PURE__ */ jsx("button", { className: "bt-btn", disabled: !page?.hasMore, onClick: () => setOffset(offset + 20), children: "Next" })
    ] }),
    /* @__PURE__ */ jsxs("details", { className: "bt-memory", children: [
      /* @__PURE__ */ jsx("summary", { children: "CLI command" }),
      /* @__PURE__ */ jsxs("code", { children: [
        "zcc memory search ",
        tag,
        " --scope all"
      ] })
    ] })
  ] });
}

// src/model.ts
var BOT_COLORS = ["#3b82f6", "#f97316", "#10b981", "#a855f7", "#ef4444", "#eab308", "#ec4899", "#14b8a6"];
var BOT_SHAPES = ["blob", "cloud", "hexagon", "round"];
function idHash(id, seed = 0, factor = 31) {
  let hash = seed;
  for (const char of id) hash = Math.imul(hash, factor) + char.charCodeAt(0) >>> 0;
  return hash;
}
function defaultBotColor(id) {
  return BOT_COLORS[idHash(id) % BOT_COLORS.length];
}
function defaultBotShape(id) {
  return BOT_SHAPES[(idHash(id, 2166136261, 16777619) >>> 7) % BOT_SHAPES.length];
}
var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function clock(hour, minute) {
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}
function dayList(field) {
  if (field === "*") return "Every day";
  const days = [...new Set(field.split(",").flatMap((token) => {
    const range = /^(\d)-(\d)$/.exec(token);
    if (!range) return [Number(token)];
    const from = Number(range[1]);
    return Array.from({ length: Math.max(0, Number(range[2]) - from + 1) }, (_, offset) => from + offset);
  }))].sort((a, b) => a - b);
  if (days.length === 0) return null;
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null;
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  if (days.length === 7) return "Every day";
  if (days.length === 1) return `${WEEKDAYS[days[0]]}s`;
  return days.map((day) => WEEKDAYS[day].slice(0, 3)).join(", ");
}
function describeCron(cron) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return `Custom \xB7 ${cron}`;
  const [minute, hour, dom, month, dow] = fields;
  const calendarFree = dom === "*" && month === "*";
  if (calendarFree && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const days = dayList(dow);
    if (days) return `${days} around ${clock(Number(hour), Number(minute))}`;
  }
  if (calendarFree && dow === "*" && hour === "*") {
    if (minute === "*") return "Every minute";
    if (/^\d+$/.test(minute)) return `Every hour at :${minute.padStart(2, "0")}`;
    const step = /^\*\/(\d+)$/.exec(minute);
    if (step) return `Every ${step[1]} minutes`;
  }
  return `Custom \xB7 ${cron}`;
}
function botMemoryTag(bot) {
  return `bot:${bot.id}`;
}

// app.tsx
var CHANNEL = "bots:changed";
var muted = { color: "var(--text-muted)" };
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
function botState(bot) {
  if (!bot.mainThreadId) return "new";
  if (!bot.mainThreadStatus) return "missing";
  if (bot.mainThreadStatus === "unknown") return "unknown";
  if (bot.mainThreadStatus === "active" || bot.mainThreadStatus === "starting" || bot.activeJobs > 0) return "working";
  return "asleep";
}
var STATE_LABEL = { new: "Not started", working: "Working", asleep: "Asleep", missing: "Thread missing", unknown: "Status unavailable" };
var COLOR_NAMES = ["Blue", "Orange", "Green", "Purple", "Red", "Yellow", "Pink", "Teal"];
var NOTICE_MS = 4e3;
var CSS2 = `
.bt-root{container-type:inline-size;line-height:1.5;background:var(--bg-panel);display:flex;height:100%;min-height:0;font-size:13px;color:var(--text-primary)}
.bt-layout{display:grid;width:100%;min-height:0;grid-template-columns:170px minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.bt-root button{font:inherit;color:inherit}
.bt-root :focus-visible{outline:2px solid var(--accent-blue);outline-offset:2px}
.bt-list{min-width:0;background:var(--bg-base);border-right:1px solid var(--border);padding:8px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.bt-list-head{display:flex;align-items:center;justify-content:space-between;padding:4px 4px 8px}
.bt-list-head h1{font-size:13px;font-weight:600;margin:0}
.bt-item{width:100%;display:flex;gap:10px;align-items:center;text-align:left;padding:7px 8px;border:0;background:transparent;border-radius:8px;cursor:pointer}
.bt-item:hover{background:var(--bg-hover)}
.bt-item[aria-current="true"]{background:var(--bg-elevated)}
.bt-item .bt-name{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-item small{color:var(--text-muted);font-size:11px}
.bt-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:1px;background:var(--text-dim,#6e7681)}
.bt-dot[data-state="working"]{background:var(--success,#3fb950);box-shadow:0 0 0 3px color-mix(in srgb,var(--success,#3fb950) 20%,transparent)}
.bt-dot[data-state="missing"],.bt-dot[data-state="unknown"]{background:var(--accent-gold,#d4a017)}
.bt-main{min-height:0;flex:1;min-width:0;overflow:auto}
.bt-inner{padding:22px clamp(16px,3%,40px) 48px}
.bt-hero{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.bt-hero-text{flex:1;min-width:180px}
.bt-hero h2{margin:0;font-size:23px;letter-spacing:-.035em;font-weight:600}
.bt-hero p{margin:2px 0 0;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bt-actions{display:flex;gap:6px}
.bt-chips{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.bt-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--bg-elevated);color:var(--text-muted);border:1px solid var(--border)}
.bt-chip.is-warn{color:var(--warning,var(--text-muted));background:transparent;border:0;padding:0}
.bt-tabs{display:flex;gap:16px;margin-top:18px;border-bottom:1px solid var(--border)}
.bt-tabs button{border:0;background:transparent;padding:8px 0;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.bt-tabs button[aria-selected="true"]{color:var(--text-primary);border-bottom-color:var(--accent-blue);font-weight:500}
.bt-sec{margin-top:18px}
.bt-sec h3{font-size:15px;font-weight:600;margin:0}
.bt-card{border:1px solid var(--border);border-radius:8px;background:var(--bg-panel)}
.bt-row{display:flex;align-items:center;gap:12px;padding:10px 12px;width:100%;box-sizing:border-box}
.bt-row+.bt-row,.bt-row+form,.bt-card>p+.bt-row{border-top:1px solid var(--border)}
button.bt-row{border:0;background:transparent;text-align:left;cursor:pointer}
button.bt-row:hover{background:var(--bg-hover)}
.bt-row+button.bt-row{border-top:1px solid var(--border)}
.bt-grow{flex:1;min-width:0}
.bt-sub{display:block;font-size:12px;color:var(--text-muted)}
 .bt-rowacts{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.bt-row.is-routine{flex-wrap:wrap}
.bt-when{text-align:right;font-size:12px;color:var(--text-muted)}
.bt-row.is-routine .bt-grow{flex:1 1 130px}
.bt-ico{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;flex:none;background:var(--bg-elevated);color:var(--text-muted);font-size:12px}
.bt-btn{border:1px solid var(--border);background:var(--bg-panel);border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap}
.bt-btn:hover:not(:disabled){background:var(--bg-hover)}
.bt-btn:disabled{opacity:.5;cursor:default}
.bt-btn.is-primary{background:var(--accent-blue);border-color:var(--accent-blue);color:#fff}
.bt-btn.is-ghost{border-color:transparent;background:transparent}
.bt-btn.is-danger{color:var(--danger,#f85149)}
.bt-btn.is-sm{padding:2px 8px;font-size:12px}
.bt-sw{width:30px;height:18px;border-radius:999px;border:0;background:var(--border-strong,#4a4c57);position:relative;cursor:pointer;flex:none;padding:0}
.bt-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.bt-sw[aria-checked="true"]{background:var(--accent-blue)}
.bt-sw[aria-checked="true"]::after{left:14px}
.bt-sw:disabled{cursor:progress;opacity:.7}
.bt-field>.bt-picker{width:100%;margin-top:4px}
.bt-field{display:block;margin-top:10px;color:var(--text-muted);font-size:12px}
.bt-field input,.bt-field textarea,.bt-field select{display:block;width:100%;margin-top:4px;font-size:13px}
.bt-colors{display:flex;gap:6px}
.bt-colors button{width:16px;height:16px;border-radius:50%;border:0;cursor:pointer;padding:0}
.bt-colors button[aria-checked="true"]{box-shadow:0 0 0 2px var(--bg-panel),0 0 0 3.5px var(--text-primary)}
.bt-colors.is-lg button{width:20px;height:20px}
.bt-note{font-size:12px;color:var(--text-muted);margin:6px 0 0}
.bt-alert{font-size:12px;color:var(--danger,#f85149);margin:6px 0 0}
.bt-start{margin-top:18px;padding:14px;border:1px dashed var(--border-strong,var(--border));border-radius:8px}
.bt-start textarea{width:100%;min-height:72px;margin-top:8px}
.bt-create{max-width:520px;margin:0 auto;padding:28px 20px}
.bt-empty{padding:24px;color:var(--text-muted)}
.bt-av{position:relative;display:inline-block;flex:none}
.bt-av svg{display:block;overflow:visible}
.bt-av g{transform-box:view-box}
.bt-av .bt-body{transform-origin:50px 86px}
.bt-av .bt-blink{transform-origin:50px 46px}
.bt-av.is-live .bt-body,.bt-item:is(:hover,:focus-visible) .bt-av .bt-body{animation:bt-wobble 2.6s ease-in-out infinite}
.bt-av.is-live[data-state="working"] .bt-body,.bt-item:is(:hover,:focus-visible) .bt-av[data-state="working"] .bt-body{animation:bt-hop .9s ease-in-out infinite}
.bt-av.is-live[data-state="asleep"] .bt-body,.bt-item:is(:hover,:focus-visible) .bt-av[data-state="asleep"] .bt-body{animation:bt-breathe 3s ease-in-out infinite}
.bt-av.is-live .bt-look,.bt-item:is(:hover,:focus-visible) .bt-av .bt-look{animation:bt-look 5s ease-in-out infinite}
.bt-av.is-live .bt-blink,.bt-item:is(:hover,:focus-visible) .bt-av .bt-blink{animation:bt-blink 3.8s infinite}
@keyframes bt-wobble{0%,100%{transform:rotate(0)}25%{transform:translateX(-3px) rotate(-7deg)}50%{transform:translateY(-3px)}75%{transform:translateX(3px) rotate(7deg)}}
@keyframes bt-hop{0%,100%{transform:translateY(0) scale(1)}45%{transform:translateY(-7px) scale(.98,1.03)}80%{transform:translateY(0) scale(1.04,.96)}}
@keyframes bt-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.045,.92)}}
@keyframes bt-look{0%,22%,100%{transform:translate(0,0)}30%,48%{transform:translate(6px,-1px)}56%,74%{transform:translate(-5px,1px)}}
@keyframes bt-blink{0%,90%,100%{transform:scaleY(1)}94%{transform:scaleY(.1)}}
@media (prefers-reduced-motion:reduce){.bt-av *{animation:none!important}}
.bt-topline,.bt-section-head,.bt-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bt-section-head{justify-content:space-between;margin:0 0 8px}
.bt-topline{border-bottom:1px solid var(--border);padding:9px 24px;color:var(--text-muted);font-size:12px}
.bt-meta{font-size:12px;color:var(--text-muted)}
#bot-panel-settings{max-width:720px}
#bot-panel-settings .bt-card{border:0}
#bot-panel-settings .bt-row{padding:12px 0}
#bot-panel-settings .bt-row :is(input,select,textarea,.bt-picker){width:min(55%,310px);box-sizing:border-box}
.bt-root .bt-field :is(input,select,textarea),.bt-start textarea{box-sizing:border-box}
.bt-sec .bt-memory{padding:10px 14px}
.bt-memory+.bt-memory{border-top:1px solid var(--border)}
.bt-memory summary{cursor:pointer}.bt-memory p{white-space:pre-wrap;overflow-wrap:anywhere}
.bt-empty-line{margin:0;padding:12px;color:var(--text-muted)}
.bt-grow,.bt-hero-text,.bt-memory{overflow-wrap:anywhere}
.bt-root .settings-field{margin-bottom:0}
@container (max-width:700px){.bt-layout{grid-template-columns:135px minmax(0,1fr)}.bt-list-head{flex-wrap:wrap}.bt-when{text-align:left}.bt-row.is-routine .bt-grow{flex-basis:55%}}
@container (max-width:520px){.bt-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.bt-root .bt-list{max-height:110px;flex-direction:row;align-items:center;overflow:auto;border-right:0;border-bottom:1px solid var(--border)}.bt-list .bt-item{width:auto;flex:none}.bt-list-head{flex:none;gap:4px}.bt-inner{padding:16px 12px 32px}.bt-row{flex-wrap:wrap}#bot-panel-settings .bt-row :is(input,select,textarea,.bt-picker){width:100%}.bt-colors{flex-wrap:wrap}}
.bt-root code{font-size:12px}
`;
var BODY = {
  blob: /* @__PURE__ */ jsx("path", { d: "M50 14c20 0 34 14 34 34 0 6 2 10 2 16 0 14-14 22-36 22S14 78 14 64c0-6 2-10 2-16 0-20 14-34 34-34z" }),
  cloud: /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsx("circle", { cx: 38, cy: 50, r: 20 }),
    /* @__PURE__ */ jsx("circle", { cx: 61, cy: 43, r: 22 }),
    /* @__PURE__ */ jsx("circle", { cx: 73, cy: 62, r: 15 }),
    /* @__PURE__ */ jsx("circle", { cx: 28, cy: 64, r: 15 }),
    /* @__PURE__ */ jsx("rect", { x: 28, y: 54, width: 46, height: 26, rx: 13 })
  ] }),
  hexagon: /* @__PURE__ */ jsx("polygon", { points: "50,17 79,34 79,66 50,83 21,66 21,34", strokeWidth: 14, strokeLinejoin: "round" }),
  round: /* @__PURE__ */ jsx("circle", { cx: 50, cy: 52, r: 34 })
};
function BotAvatar({ bot, size = 40, live = false }) {
  const state = botState(bot);
  const color = bot.color ?? defaultBotColor(bot.id);
  const shape = defaultBotShape(bot.id);
  const asleep = state === "asleep";
  const eye = state === "working" ? 16 : 14;
  return /* @__PURE__ */ jsx("span", { className: `bt-av${live ? " is-live" : ""}`, style: { width: size, height: size }, "data-state": state, "data-shape": shape, "aria-hidden": "true", children: /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 100 100", children: /* @__PURE__ */ jsxs("g", { className: "bt-body", children: [
    /* @__PURE__ */ jsx("g", { style: { fill: color, stroke: color }, strokeWidth: 0, children: BODY[shape] }),
    asleep ? /* @__PURE__ */ jsx("path", { d: "M36 52q5 4 10 0M56 52q5 4 10 0", stroke: "#fff", strokeWidth: 4, fill: "none", strokeLinecap: "round" }) : /* @__PURE__ */ jsx("g", { className: "bt-look", children: /* @__PURE__ */ jsxs("g", { className: "bt-blink", children: [
      /* @__PURE__ */ jsx("rect", { x: 38, y: 38, width: 7, height: eye, rx: 3.5, fill: "#fff", transform: "rotate(-8 41 45)" }),
      /* @__PURE__ */ jsx("rect", { x: 55, y: 38, width: 7, height: eye, rx: 3.5, fill: "#fff", transform: "rotate(-8 58 45)" })
    ] }) })
  ] }) }) });
}
function BotListIdentity({ bot, live, statusId, children }) {
  const state = botState(bot);
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsx(BotAvatar, { bot, size: 30, live }),
    /* @__PURE__ */ jsxs("span", { style: { minWidth: 0 }, children: [
      /* @__PURE__ */ jsx("span", { className: "bt-name", children: bot.name }),
      /* @__PURE__ */ jsxs("small", { id: statusId, children: [
        /* @__PURE__ */ jsx("span", { className: "bt-dot", "data-state": state }),
        STATE_LABEL[state],
        children
      ] })
    ] })
  ] });
}
function Section({ label, children, action }) {
  return /* @__PURE__ */ jsxs("section", { className: "bt-sec", "aria-label": label, children: [
    /* @__PURE__ */ jsxs("div", { className: "bt-section-head", children: [
      /* @__PURE__ */ jsx("h3", { children: label }),
      action
    ] }),
    /* @__PURE__ */ jsx("div", { className: "bt-card", children })
  ] });
}
function Switch({ on, label, disabled, onChange }) {
  return /* @__PURE__ */ jsx("button", { type: "button", className: "bt-sw", role: "switch", "aria-checked": on, "aria-label": label, disabled, onClick: () => onChange(!on) });
}
function arrowNav(event, count, index, pick) {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : step ? (index + step + count) % count : -1;
  if (next < 0) return;
  event.preventDefault();
  pick(next);
  const items = event.currentTarget.parentElement?.querySelectorAll('[role="tab"],[role="radio"]');
  items?.[next]?.focus();
}
function useAction(botId) {
  const rpc = useRpc();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = useCallback(async (method, args, done) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await rpc.call(method, { bot: botId, ...args });
      if (done) setNotice(done);
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [rpc, botId]);
  const feedback = /* @__PURE__ */ jsxs(Fragment2, { children: [
    error && /* @__PURE__ */ jsx("span", { role: "alert", className: "bt-alert", style: { display: "block" }, children: error }),
    notice && /* @__PURE__ */ jsx("span", { role: "status", className: "bt-note", style: { display: "block" }, children: notice })
  ] });
  return { run, busy, feedback, clearError: () => setError("") };
}
function useBotList() {
  const rpc = useRpc();
  const [bots, setBots] = useState([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const rows = await rpc.call("list");
      if (mine !== seq.current) return;
      setBots(rows);
      setError("");
    } catch (err) {
      if (mine === seq.current) setError(message(err));
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [rpc]);
  useEffect(() => {
    void refresh();
    return () => {
      seq.current++;
    };
  }, [refresh]);
  useRealtime(CHANNEL, () => void refresh());
  return { bots, loaded, error, refresh };
}
var BASIC_BOT_LIMIT = 5;
var basicListCss = `
.bt-basic { margin-bottom: 18px; font-size: 13px; line-height: 1.5; color: var(--text-primary); }
.bt-basic .bt-list-head h2 { margin: 0; font-size: 13px; font-weight: 600; color: inherit; }
.bt-basic .bt-list-head button { color: inherit; font-family: inherit; }
.bt-basic-list { display: grid; gap: 2px; }
.bt-basic-item { position: relative; display: flex; align-items: center; border-radius: 8px; }
.bt-basic-item:is(:hover, :focus-within) { background: var(--bg-hover); }
.bt-basic-item:has([aria-current="page"], [aria-expanded="true"]) { background: var(--bg-elevated); }
.bt-basic-pin { display: grid; place-items: center; flex: 0 0 30px; height: 30px; border-radius: 6px;
  padding: 0; margin-right: 4px; background: transparent; border: 0; color: var(--text-muted); cursor: pointer; }
.bt-basic-pin:hover, .bt-basic-pin:focus-visible { color: var(--text-primary); background: var(--bg-hover); }
.bt-basic-pin svg { transform: rotate(35deg); }
.bt-basic-pin[aria-pressed="true"] svg { fill: currentColor; }
@media (hover: hover) and (pointer: fine) {
  .bt-basic-item:not(:hover):not(:focus-within) .bt-basic-pin[aria-pressed="false"] { position: absolute; right: 0; opacity: 0; }
}
.bt-basic-more { display: block; padding: 8px 10px 8px 48px; border: 0; background: transparent;
  color: var(--text-muted); font: inherit; font-size: 12px; cursor: pointer; }
.bt-basic-more:hover, .bt-basic-more:focus-visible { color: var(--text-primary); }
.bt-basic .bt-basic-row { flex: 1; min-width: 0; font: inherit; color: inherit; background: transparent; }
.bt-basic-dialog { box-sizing: border-box; width: min(500px, calc(100vw - 32px)); max-height: calc(100dvh - 32px);
  padding: 0; margin: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-panel); }
.bt-basic-dialog::backdrop { background: rgb(0 0 0 / 45%); }
.bt-basic-dialog .bt-root { height: auto; }
.bt-basic-dialog .bt-create { min-width: 0; }
.bt-basic .bt-start { display: grid; gap: 7px; margin: 5px 10px 12px; }
.bt-basic .bt-start textarea { width: 100%; box-sizing: border-box; min-height: 64px; resize: vertical; }
.bt-basic .bt-note, .bt-basic [role="alert"] { color: var(--text-muted); font-size: 11px; }
`;
function BasicBotRow({ bot, activeThreadId, starting, setStarting, openThread }) {
  const state = botState(bot);
  const canOpen = Boolean(bot.mainThreadId && state !== "missing");
  const expanded = !canOpen && starting;
  const current = Boolean(activeThreadId && bot.mainThreadId === activeThreadId);
  const statusId = useId();
  const pinned = bot.pinnedAt != null;
  const { busy, feedback, run } = useAction(bot.id);
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsxs("div", { className: "bt-basic-item", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "bt-item bt-basic-row",
          title: bot.name,
          "aria-label": bot.name,
          "aria-describedby": statusId,
          "aria-current": current ? "page" : void 0,
          "aria-expanded": canOpen ? void 0 : expanded,
          onClick: () => {
            if (canOpen && bot.mainThreadId) {
              setStarting(false);
              openThread(bot.mainThreadId);
            } else setStarting(!expanded);
          },
          children: /* @__PURE__ */ jsx(BotListIdentity, { bot, live: current || expanded, statusId })
        }
      ),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "bt-basic-pin",
          "aria-label": `${pinned ? "Unpin" : "Pin"} ${bot.name}`,
          title: pinned ? "Unpin bot" : "Pin bot",
          "aria-pressed": pinned,
          disabled: busy,
          onClick: () => void run("update", { patch: { pinned: !pinned } }),
          children: /* @__PURE__ */ jsx(Pin, { size: 15, "aria-hidden": "true" })
        }
      )
    ] }),
    feedback,
    expanded && /* @__PURE__ */ jsx(StartConversation, { bot, state, compact: true, onStarted: openThread })
  ] });
}
function BasicBots({ searchQuery, activeThreadId, projectIds, openThread, registerThreads }) {
  const { bots, loaded, error, refresh } = useBotList();
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const [starting, setStarting] = useState(null);
  const eligible = useMemo(() => bots.filter((bot) => projectIds.includes(bot.projectId)), [bots, projectIds]);
  useEffect(() => {
    const ids = eligible.flatMap((bot) => bot.mainThreadId ? [bot.mainThreadId] : []);
    if (ids.length) return registerThreads(ids);
  }, [eligible, registerThreads]);
  const query = searchQuery.trim().toLocaleLowerCase();
  const matches = eligible.filter((bot) => bot.name.toLocaleLowerCase().includes(query)).sort((a, b) => (b.pinnedAt ?? -1) - (a.pinnedAt ?? -1));
  const visible = showAll || query ? matches : matches.slice(0, BASIC_BOT_LIMIT);
  if (!matches.length && !error && (!loaded || query || !projectIds.length)) return null;
  return /* @__PURE__ */ jsxs("section", { className: "bt-basic", "aria-label": "Bots", children: [
    /* @__PURE__ */ jsx("style", { children: CSS2 + basicListCss }),
    /* @__PURE__ */ jsxs("div", { className: "bt-list-head", children: [
      /* @__PURE__ */ jsx("h2", { children: "Bots" }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-ghost is-sm", "aria-haspopup": "dialog", onClick: () => setCreating(true), children: "\uFF0B New bot" })
    ] }),
    creating && /* @__PURE__ */ jsx(
      CreateBotDialog,
      {
        projectId: projectIds.length === 1 ? projectIds[0] : void 0,
        onCancel: () => setCreating(false),
        onCreated: (id) => {
          setCreating(false);
          setShowAll(true);
          setStarting(id);
          void refresh();
        }
      }
    ),
    error && /* @__PURE__ */ jsxs("p", { role: "alert", children: [
      "Couldn\u2019t load bots. ",
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => void refresh(), children: "Retry" })
    ] }),
    /* @__PURE__ */ jsx("div", { id: listId, className: "bt-basic-list", children: visible.map((bot) => /* @__PURE__ */ jsx(
      BasicBotRow,
      {
        bot,
        activeThreadId,
        openThread,
        starting: starting === bot.id,
        setStarting: (open2) => setStarting(open2 ? bot.id : null)
      },
      bot.id
    )) }),
    !query && matches.length > BASIC_BOT_LIMIT && /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "bt-basic-more",
        "aria-expanded": showAll,
        "aria-controls": listId,
        onClick: () => setShowAll(!showAll),
        children: showAll ? "Show less" : "Show more"
      }
    )
  ] });
}
function BotsPanel() {
  const { bots, loaded, error, refresh } = useBotList();
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const bot = bots.find((row) => row.id === selected) ?? bots[0] ?? null;
  const showCreate = creating || loaded && bots.length === 0;
  return /* @__PURE__ */ jsxs("div", { className: "bt-root", children: [
    /* @__PURE__ */ jsx("style", { children: CSS2 }),
    /* @__PURE__ */ jsxs("div", { className: "bt-layout", children: [
      /* @__PURE__ */ jsxs("nav", { className: "bt-list", "aria-label": "Bots", children: [
        /* @__PURE__ */ jsxs("div", { className: "bt-list-head", children: [
          /* @__PURE__ */ jsx("h1", { children: "Bots" }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-ghost is-sm", onClick: () => setCreating(true), children: "\uFF0B New bot" })
        ] }),
        error && /* @__PURE__ */ jsx("p", { role: "alert", className: "bt-alert", children: error }),
        bots.map((row) => {
          const active = row.id === bot?.id && !showCreate;
          const routines = row.routines.filter((r) => r.enabled).length;
          return /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "bt-item",
              "aria-current": active ? "true" : void 0,
              onClick: () => {
                setSelected(row.id);
                setCreating(false);
              },
              children: /* @__PURE__ */ jsxs(BotListIdentity, { bot: row, live: active, children: [
                routines ? ` \xB7 ${routines} routine${routines === 1 ? "" : "s"}` : "",
                row.activeJobs ? ` \xB7 ${row.activeJobs} job${row.activeJobs === 1 ? "" : "s"}` : ""
              ] })
            },
            row.id
          );
        })
      ] }),
      /* @__PURE__ */ jsx("main", { className: "bt-main", children: showCreate ? /* @__PURE__ */ jsx(
        CreateBot,
        {
          canCancel: bots.length > 0,
          onCancel: () => setCreating(false),
          onCreated: (id) => {
            setCreating(false);
            setSelected(id);
            void refresh();
          }
        }
      ) : bot ? /* @__PURE__ */ jsx(BotPage, { bot, onDeleted: () => {
        setSelected(null);
        void refresh();
      } }, bot.id) : /* @__PURE__ */ jsx("p", { role: "status", className: "bt-empty", children: loaded ? "" : "Loading bots\u2026" }) })
    ] })
  ] });
}
function CreateBotDialog(props) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return /* @__PURE__ */ jsx(
    "dialog",
    {
      ref,
      className: "bt-basic-dialog",
      "aria-label": "New bot",
      onCancel: (event) => {
        event.preventDefault();
        props.onCancel();
      },
      children: /* @__PURE__ */ jsx("div", { className: "bt-root", children: /* @__PURE__ */ jsx(CreateBot, { ...props, canCancel: true }) })
    }
  );
}
function CreateBot(props) {
  const rpc = useRpc();
  const [name, setName] = useState("");
  const [color, setColor] = useState(BOT_COLORS[0]);
  const [personality, setPersonality] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const edit = (setter) => (e) => {
    setter(e.target.value);
    setError("");
  };
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const bot = await rpc.call("create", { name, color, personality, ...props.projectId && { projectId: props.projectId } });
      props.onCreated(bot.id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const preview = { id: "preview", name: name || "New bot", color, routines: [], activeJobs: 0, mainThreadStatus: null };
  return /* @__PURE__ */ jsxs("form", { className: "bt-create", onSubmit: (event) => void submit(event), "aria-label": "Create a bot", children: [
    /* @__PURE__ */ jsxs("div", { className: "bt-hero", children: [
      /* @__PURE__ */ jsx(BotAvatar, { bot: preview, size: 64, live: true }),
      /* @__PURE__ */ jsxs("div", { className: "bt-hero-text", children: [
        /* @__PURE__ */ jsx("h2", { children: "Create a bot" }),
        /* @__PURE__ */ jsx("p", { children: "One persistent thread with a personality. Anyone can message it, routines wake it on a schedule, and it runs heavy work in hidden background jobs." })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "bt-chips", children: /* @__PURE__ */ jsx("span", { className: "bt-chip is-warn", title: "Bots run without asking for approval", children: "Full access" }) }),
    /* @__PURE__ */ jsxs("label", { className: "bt-field settings-field", children: [
      "Name",
      /* @__PURE__ */ jsx("input", { value: name, onChange: edit(setName), placeholder: "Release Scout" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "bt-field settings-field", children: [
      "Color",
      /* @__PURE__ */ jsx("div", { style: { marginTop: 6 }, children: /* @__PURE__ */ jsx(ColorPicker, { value: color, onChange: setColor, large: true }) })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "bt-field settings-field", children: [
      "Personality and role",
      /* @__PURE__ */ jsx(
        "textarea",
        {
          rows: 5,
          value: personality,
          onChange: edit(setPersonality),
          placeholder: "You watch our release branches, summarize what changed each morning, and flag risky merges."
        }
      )
    ] }),
    error && /* @__PURE__ */ jsx("p", { role: "alert", className: "bt-alert", children: error }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginTop: 14 }, children: [
      /* @__PURE__ */ jsx("button", { type: "submit", className: "bt-btn is-primary", disabled: busy || !name.trim(), children: busy ? "Creating\u2026" : "Create bot" }),
      props.canCancel && /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn", onClick: props.onCancel, children: "Cancel" })
    ] })
  ] });
}
function ColorPicker({ value, disabled, large, onChange }) {
  const current = BOT_COLORS.indexOf(value);
  return /* @__PURE__ */ jsx("div", { role: "radiogroup", "aria-label": "Color", className: large ? "bt-colors is-lg" : "bt-colors", children: BOT_COLORS.map((color, index) => {
    const checked = color === value;
    return /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        role: "radio",
        "aria-checked": checked,
        "aria-label": COLOR_NAMES[index],
        disabled,
        tabIndex: checked || current < 0 && index === 0 ? 0 : -1,
        onClick: () => onChange(color),
        onKeyDown: (event) => arrowNav(event, BOT_COLORS.length, index, (next) => onChange(BOT_COLORS[next])),
        style: { background: color }
      },
      color
    );
  }) });
}
function useOpenChat() {
  const navigate = useZccNavigate();
  return useCallback((bot, threadId) => {
    if (navigate.openPanelAgent?.({ threadId, title: bot.name })) return;
    navigate.toThread(threadId);
  }, [navigate]);
}
var TABS = [["details", "Overview"], ["library", "Library"], ["settings", "Settings"]];
var WAKE_MESSAGE = "Check in: anything new since your last run? Reply in a few lines.";
function BotPage({ bot, onDeleted }) {
  const [tab, setTab] = useState("details");
  const openChat = useOpenChat();
  const wake = useAction(bot.id);
  const catalog = useCatalog(bot.providerId ?? "");
  const jobs = useJobs(bot.id);
  const state = botState(bot);
  const hasThread = Boolean(bot.mainThreadId) && (state === "working" || state === "asleep");
  const projectName = catalog.data?.projects.find((row) => row.id === bot.projectId)?.name ?? (catalog.data || catalog.error ? bot.projectId : "\u2026");
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsxs("div", { className: "bt-topline", children: [
      "Bots ",
      /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "/" }),
      " ",
      bot.name
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "bt-inner", children: [
      /* @__PURE__ */ jsxs("header", { className: "bt-hero", children: [
        /* @__PURE__ */ jsx(BotAvatar, { bot, size: 44, live: true }),
        /* @__PURE__ */ jsxs("div", { className: "bt-hero-text", children: [
          /* @__PURE__ */ jsxs("div", { className: "bt-title", children: [
            /* @__PURE__ */ jsx("h2", { children: bot.name }),
            /* @__PURE__ */ jsxs("span", { className: "bt-chip", children: [
              /* @__PURE__ */ jsx("span", { className: "bt-dot", "data-state": state }),
              STATE_LABEL[state],
              bot.activeJobs ? ` \xB7 ${bot.activeJobs} background job${bot.activeJobs === 1 ? "" : "s"}` : ""
            ] })
          ] }),
          /* @__PURE__ */ jsxs("span", { className: "bt-meta", children: [
            projectName,
            " \xB7 ",
            /* @__PURE__ */ jsx("span", { className: "bt-chip is-warn", title: "Bots run without asking for approval", children: "Full access" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "bt-actions", children: [
          hasThread && /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-primary", onClick: () => openChat(bot, bot.mainThreadId), children: "Chat" }),
          state === "asleep" && /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "bt-btn",
              disabled: wake.busy,
              onClick: () => void wake.run("send", { message: WAKE_MESSAGE }, `${bot.name} is waking up`),
              children: "Wake"
            }
          )
        ] })
      ] }),
      wake.feedback,
      /* @__PURE__ */ jsx("div", { role: "tablist", "aria-label": `${bot.name} sections`, className: "bt-tabs", children: TABS.map(([id, label], index) => /* @__PURE__ */ jsx(
        "button",
        {
          id: `bot-tab-${id}`,
          type: "button",
          role: "tab",
          "aria-selected": tab === id,
          "aria-controls": `bot-panel-${id}`,
          tabIndex: tab === id ? 0 : -1,
          onClick: () => setTab(id),
          onKeyDown: (event) => arrowNav(event, TABS.length, index, (next) => setTab(TABS[next][0])),
          children: label
        },
        id
      )) }),
      /* @__PURE__ */ jsxs("div", { role: "tabpanel", id: "bot-panel-details", "aria-labelledby": "bot-tab-details", hidden: tab !== "details", children: [
        !hasThread && /* @__PURE__ */ jsx(StartConversation, { bot, state, onStarted: (threadId) => openChat(bot, threadId) }),
        /* @__PURE__ */ jsx(Details, { bot, jobs, openLibrary: () => setTab("library"), visible: tab === "details" })
      ] }),
      /* @__PURE__ */ jsx("div", { role: "tabpanel", id: "bot-panel-library", "aria-labelledby": "bot-tab-library", hidden: tab !== "library", children: /* @__PURE__ */ jsx(Library, { bot, jobsState: jobs, visible: tab === "library" }) }),
      /* @__PURE__ */ jsx("div", { role: "tabpanel", id: "bot-panel-settings", "aria-labelledby": "bot-tab-settings", hidden: tab !== "settings", children: /* @__PURE__ */ jsx(Settings, { bot, onDeleted }) })
    ] })
  ] });
}
function StartConversation({ bot, state, onStarted, compact = false }) {
  const rpc = useRpc();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (state === "unknown") {
    return /* @__PURE__ */ jsxs("p", { role: "status", className: "bt-start bt-note", children: [
      "Can't reach ",
      bot.name,
      "'s thread right now. It will reappear when the host responds."
    ] });
  }
  const start = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await rpc.call("send", { bot: bot.id, message: text });
      setText("");
      if (result?.threadId) onStarted(result.threadId);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ jsxs("form", { className: "bt-start settings-field", "aria-label": `Start ${bot.name}`, onSubmit: (event) => void start(event), children: [
    /* @__PURE__ */ jsx("span", { className: "bt-note", style: { margin: 0 }, children: compact ? "Send a first message to open this bot\u2019s chat." : state === "missing" ? `${bot.name}'s main thread was deleted. Your next message starts a fresh main thread; routines and memory are kept.` : `${bot.name} has no thread yet. The first message wakes it up and opens the chat beside this page.` }),
    /* @__PURE__ */ jsx(
      "textarea",
      {
        "aria-label": `Message ${bot.name}`,
        value: text,
        onChange: (e) => {
          setText(e.target.value);
          setError("");
        },
        placeholder: "Introduce yourself and tell me what you can do."
      }
    ),
    error && /* @__PURE__ */ jsx("p", { role: "alert", className: "bt-alert", children: error }),
    /* @__PURE__ */ jsx("button", { type: "submit", className: compact ? "btn btn-sm" : "bt-btn is-primary", disabled: busy || !text.trim(), style: { marginTop: 8 }, children: busy ? "Starting\u2026" : "Start conversation" })
  ] });
}
function Details({ bot, jobs, openLibrary, visible }) {
  const [adding, setAdding] = useState(false);
  const [nextRuns, setNextRuns] = useState({});
  const rpc = useRpc();
  const scheduleKey = JSON.stringify(bot.routines.map((r) => [r.id, r.enabled, r.cron]));
  useEffect(() => {
    if (!visible || !bot.routines.length) return;
    let seq = 0;
    const refresh = async () => {
      const request = ++seq;
      try {
        const forecast = await rpc.call("nextRuns", { bot: bot.id });
        if (request === seq) setNextRuns(forecast);
      } catch {
        if (request === seq) setNextRuns({});
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 6e4);
    return () => {
      seq++;
      clearInterval(timer);
    };
  }, [rpc, bot.id, scheduleKey, visible]);
  const openChat = useOpenChat();
  const activity = [
    ...bot.routines.filter((r) => r.lastRunAt).map((r) => ({ key: "routine-" + r.id, name: r.name, at: r.lastRunAt, detail: "Routine ran", threadId: bot.mainThreadId, title: bot.name })),
    ...(jobs.jobs ?? []).map((j) => ({ key: "job-" + j.threadId, name: j.title, at: j.startedAt, detail: j.archived ? "Archived job" : "Job \xB7 " + j.status, threadId: j.threadId, title: j.title }))
  ].sort((a, b) => b.at - a.at).slice(0, 5);
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsxs(Section, { label: "Routines", action: !adding && /* @__PURE__ */ jsx("button", { className: "bt-btn is-sm", onClick: () => setAdding(true), children: "\uFF0B Add routine" }), children: [
      bot.routines.map((routine) => /* @__PURE__ */ jsx(RoutineRow, { bot, routine, nextRun: nextRuns[routine.id] }, routine.id)),
      !adding && !bot.routines.length && /* @__PURE__ */ jsx("p", { className: "bt-empty-line", children: "No routines scheduled." }),
      adding && /* @__PURE__ */ jsx(AddRoutine, { bot, onDone: () => setAdding(false) })
    ] }),
    /* @__PURE__ */ jsxs(Section, { label: "Recent activity", action: /* @__PURE__ */ jsx("button", { className: "bt-btn is-ghost is-sm", onClick: openLibrary, children: "Open library \u2192" }), children: [
      jobs.error && /* @__PURE__ */ jsxs("p", { className: "bt-empty-line", children: [
        "Couldn\u2019t load job activity. ",
        jobs.error
      ] }),
      !activity.length && !jobs.error && /* @__PURE__ */ jsx("p", { className: "bt-empty-line", children: jobs.jobs ? "No recent activity." : "Loading activity\u2026" }),
      visible && activity.map((row) => /* @__PURE__ */ jsxs(
        "button",
        {
          className: "bt-row",
          disabled: !row.threadId,
          onClick: () => row.threadId && openChat({ name: row.title }, row.threadId),
          children: [
            /* @__PURE__ */ jsxs("span", { className: "bt-grow", children: [
              row.name,
              /* @__PURE__ */ jsx("span", { className: "bt-sub", children: row.detail })
            ] }),
            /* @__PURE__ */ jsx("time", { className: "bt-sub", dateTime: new Date(row.at).toISOString(), children: new Date(row.at).toLocaleString() })
          ]
        },
        row.key
      ))
    ] })
  ] });
}
function RoutineRow({ bot, routine, nextRun }) {
  const action = useAction(bot.id);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setEnabled(routine.enabled), [routine.enabled]);
  const labelId = `routine-${bot.id}-${routine.id}`;
  const toggle = async (next) => {
    setEnabled(next);
    if (!await action.run("updateRoutine", { routineId: routine.id, patch: { enabled: next } })) setEnabled(!next);
  };
  return /* @__PURE__ */ jsxs("div", { role: "group", "aria-labelledby": labelId, className: "bt-row is-routine", children: [
    /* @__PURE__ */ jsx("span", { className: "bt-ico", "aria-hidden": "true", children: /* @__PURE__ */ jsxs("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", children: [
      /* @__PURE__ */ jsx("circle", { cx: "12", cy: "12", r: "9" }),
      /* @__PURE__ */ jsx("path", { d: "M12 6v6l4 2" })
    ] }) }),
    /* @__PURE__ */ jsxs("span", { className: "bt-grow", children: [
      /* @__PURE__ */ jsx("span", { id: labelId, children: routine.name }),
      /* @__PURE__ */ jsxs("span", { className: "bt-sub", children: [
        describeCron(routine.cron),
        " \xB7 ",
        routine.lastRunAt ? `last ${new Date(routine.lastRunAt).toLocaleString()}` : "never run"
      ] }),
      action.feedback
    ] }),
    enabled && nextRun && /* @__PURE__ */ jsxs("span", { className: "bt-when", children: [
      "Next run",
      /* @__PURE__ */ jsx("span", { className: "bt-sub", children: new Date(nextRun).toLocaleString(void 0, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })
    ] }),
    /* @__PURE__ */ jsx("span", { className: confirming || action.busy ? "bt-rowacts is-pinned" : "bt-rowacts", children: confirming ? /* @__PURE__ */ jsxs(Fragment2, { children: [
      /* @__PURE__ */ jsxs(
        "button",
        {
          type: "button",
          className: "bt-btn is-sm is-danger",
          disabled: action.busy,
          onClick: () => void action.run("removeRoutine", { routineId: routine.id }),
          children: [
            "Delete ",
            routine.name
          ]
        }
      ),
      /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-ghost is-sm", onClick: () => setConfirming(false), children: "Keep" })
    ] }) : /* @__PURE__ */ jsxs(Fragment2, { children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: "bt-btn is-sm",
          disabled: action.busy,
          onClick: () => void action.run("runRoutine", { routineId: routine.id }, `Ran ${routine.name}`),
          children: "Run now"
        }
      ),
      /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-ghost is-sm", "aria-label": `More actions for ${routine.name}`, "aria-expanded": false, onClick: () => setConfirming(true), children: "\u2022\u2022\u2022" })
    ] }) }),
    /* @__PURE__ */ jsx(Switch, { on: enabled, label: `Enable ${routine.name}`, disabled: action.busy, onChange: (next) => void toggle(next) })
  ] });
}
var FREQUENCIES = [["weekdays", "Weekdays"], ["daily", "Every day"], ["weekly", "Weekly"], ["hourly", "Hourly"], ["custom", "Custom cron"]];
function cronFor(freq, time, day, custom, minuteOfHour = "0") {
  const [hour, minute] = /^\d{1,2}:\d{2}$/.test(time) ? time.split(":").map(Number) : [9, 0];
  if (freq === "weekdays") return `${minute} ${hour} * * 1-5`;
  if (freq === "daily") return `${minute} ${hour} * * *`;
  if (freq === "weekly") return `${minute} ${hour} * * ${day}`;
  if (freq === "hourly") {
    const at = Number(minuteOfHour);
    return `${Number.isInteger(at) && at >= 0 && at <= 59 ? at : 0} * * * *`;
  }
  return custom.trim();
}
function AddRoutine({ bot, onDone }) {
  const action = useAction(bot.id);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [freq, setFreq] = useState("weekdays");
  const [time, setTime] = useState("08:00");
  const [minute, setMinute] = useState("0");
  const [day, setDay] = useState("1");
  const [custom, setCustom] = useState("0 9 * * 1-5");
  const cron = cronFor(freq, time, day, custom, minute);
  const edit = (setter) => (e) => {
    setter(e.target.value);
    action.clearError();
  };
  const submit = async (event) => {
    event.preventDefault();
    if (await action.run("addRoutine", { routine: { name, cron, prompt } })) onDone();
  };
  return /* @__PURE__ */ jsxs("form", { "aria-label": "Add routine", onSubmit: (event) => void submit(event), style: { padding: "4px 12px 12px", borderTop: bot.routines.length ? "1px solid var(--border)" : "none" }, children: [
    /* @__PURE__ */ jsxs("label", { className: "bt-field settings-field", children: [
      "Name",
      /* @__PURE__ */ jsx("input", { value: name, onChange: edit(setName), placeholder: "Morning digest" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "bt-field settings-field", children: [
      "When",
      /* @__PURE__ */ jsx(
        PopoverPicklist,
        {
          ariaLabel: "When",
          className: "bt-picker",
          value: freq,
          options: FREQUENCIES.map(([value, label]) => ({ value, label })),
          onChange: setFreq,
          searchPlaceholder: "Search frequencies"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
      freq === "hourly" && /* @__PURE__ */ jsxs("label", { className: "bt-field settings-field", style: { flex: 1 }, children: [
        "Minute past the hour",
        /* @__PURE__ */ jsx("input", { type: "number", min: 0, max: 59, value: minute, onChange: edit(setMinute) })
      ] }),
      freq !== "custom" && freq !== "hourly" && /* @__PURE__ */ jsxs("label", { className: "bt-field settings-field", style: { flex: 1 }, children: [
        "Around",
        /* @__PURE__ */ jsx("input", { type: "time", value: time, onChange: edit(setTime) })
      ] }),
      freq === "weekly" && /* @__PURE__ */ jsxs("div", { className: "bt-field settings-field", style: { flex: 1 }, children: [
        "Day",
        /* @__PURE__ */ jsx(
          PopoverPicklist,
          {
            ariaLabel: "Day",
            className: "bt-picker",
            value: day,
            options: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, index) => ({ value: String(index), label })),
            onChange: setDay,
            searchPlaceholder: "Search days"
          }
        )
      ] }),
      freq === "custom" && /* @__PURE__ */ jsxs("label", { className: "bt-field settings-field", style: { flex: 1 }, children: [
        "Cron (minute hour day month weekday)",
        /* @__PURE__ */ jsx("input", { value: custom, onChange: edit(setCustom) })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "bt-field settings-field", children: [
      "What should it do?",
      /* @__PURE__ */ jsx(
        "textarea",
        {
          rows: 3,
          value: prompt,
          onChange: edit(setPrompt),
          placeholder: "Summarize what changed since yesterday and flag anything that needs me."
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("p", { className: "bt-note", children: [
      "Runs: ",
      describeCron(cron),
      " (host local time, at most every 15 minutes)"
    ] }),
    action.feedback,
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginTop: 10 }, children: [
      /* @__PURE__ */ jsx("button", { type: "submit", className: "bt-btn is-primary is-sm", disabled: action.busy || !name.trim() || !prompt.trim(), children: action.busy ? "Adding\u2026" : "Add routine" }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-ghost is-sm", onClick: onDone, children: "Cancel" })
    ] })
  ] });
}
function useCatalog(providerId) {
  const rpc = useRpc();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setData((current) => current ? { ...current, models: [], modelError: null } : current);
    rpc.call("catalog", { providerId }).then((next) => {
      if (live) {
        setData(next);
        setError("");
      }
    }).catch((err) => {
      if (live) {
        setData(null);
        setError(message(err));
      }
    });
    return () => {
      live = false;
    };
  }, [rpc, providerId]);
  return { data, error };
}
function withCurrent(options, current) {
  return current && !options.some((row) => row.id === current) ? [...options, { id: current, name: `${current} (unavailable)` }] : options;
}
function settingsOf(bot) {
  return { name: bot.name, personality: bot.personality, projectId: bot.projectId, providerId: bot.providerId ?? "", model: bot.model ?? "" };
}
function Settings({ bot, onDeleted }) {
  const action = useAction(bot.id);
  const color = useAction(bot.id);
  const saved = settingsOf(bot);
  const [form, setForm] = useState(saved);
  const [dirty, setDirty] = useState(/* @__PURE__ */ new Set());
  const catalog = useCatalog(form.providerId);
  const [editingModel, setEditingModel] = useState(false);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    const next = JSON.parse(savedKey);
    setForm((current) => {
      const merged = { ...next };
      for (const key of dirty) merged[key] = current[key];
      return merged;
    });
  }, [savedKey]);
  const update = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty((current) => /* @__PURE__ */ new Set([...current, ...Object.keys(patch)]));
    action.clearError();
  };
  const set = (key) => (e) => update({ [key]: e.target.value });
  const changed = [...dirty].filter((key) => form[key] !== saved[key]);
  const save = async (event) => {
    event.preventDefault();
    if (changed.length === 0) return;
    const patch = Object.fromEntries(changed.map((key) => [key, form[key]]));
    const runtime = changed.some((key) => key === "providerId" || key === "model" || key === "projectId");
    const done = runtime ? "Saved. Personality applies from the next turn; provider, model and project apply when a new main thread is created." : "Saved. Applies from the next turn.";
    if (await action.run("update", { patch }, done)) setDirty(/* @__PURE__ */ new Set());
  };
  const data = catalog.data;
  const providers = withCurrent(data?.providers ?? [], form.providerId);
  const models = withCurrent((data?.models ?? []).map((id) => ({ id, name: id })), form.model);
  const projects = withCurrent(data?.projects ?? [], form.projectId);
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsxs("form", { className: "settings-field", onSubmit: (event) => void save(event), "aria-label": "Bot settings", children: [
      /* @__PURE__ */ jsxs(Section, { label: "Identity", children: [
        /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
          /* @__PURE__ */ jsxs("span", { className: "bt-grow", children: [
            "Color",
            color.feedback
          ] }),
          /* @__PURE__ */ jsx(
            ColorPicker,
            {
              value: bot.color ?? defaultBotColor(bot.id),
              disabled: color.busy,
              onChange: (next) => void color.run("update", { patch: { color: next } })
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
          /* @__PURE__ */ jsx("span", { className: "bt-grow", children: "Name" }),
          /* @__PURE__ */ jsx("input", { "aria-label": "Name", value: form.name, onChange: set("name") })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "bt-row", style: { alignItems: "flex-start" }, children: [
          /* @__PURE__ */ jsxs("span", { className: "bt-grow", children: [
            "Personality and role",
            /* @__PURE__ */ jsx("span", { className: "bt-sub", children: "Applies from the next turn" })
          ] }),
          /* @__PURE__ */ jsx("textarea", { "aria-label": "Personality and role", rows: 4, value: form.personality, onChange: set("personality") })
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Section, { label: "Provider and model", children: [
        catalog.error && /* @__PURE__ */ jsxs("p", { role: "alert", className: "bt-alert", style: { padding: "8px 12px 0", margin: 0 }, children: [
          "Couldn't load providers: ",
          catalog.error
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
          /* @__PURE__ */ jsxs("span", { className: "bt-grow", children: [
            "Provider",
            /* @__PURE__ */ jsx("span", { className: "bt-sub", children: "Applies when a new main thread starts" })
          ] }),
          /* @__PURE__ */ jsx(
            PopoverPicklist,
            {
              ariaLabel: "Provider",
              className: "bt-picker",
              value: form.providerId,
              options: [{ value: "", label: "Project default" }, ...providers.map((row) => ({ value: row.id, label: row.name }))],
              onChange: (providerId) => {
                setEditingModel(false);
                update({ providerId, model: "" });
              },
              searchPlaceholder: "Search providers"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
          /* @__PURE__ */ jsxs("span", { className: "bt-grow", children: [
            "Model",
            data?.modelError && /* @__PURE__ */ jsxs("span", { className: "bt-sub", children: [
              "Models unavailable: ",
              data.modelError
            ] })
          ] }),
          /* @__PURE__ */ jsx(
            PopoverPicklist,
            {
              ariaLabel: "Model",
              className: "bt-picker",
              value: editingModel ? "custom" : form.model ? "model:" + form.model : "",
              options: [
                { value: "", label: "Default" },
                ...models.map((row) => ({ value: "model:" + row.id, label: row.name })),
                { value: "custom", label: "Custom model\u2026" }
              ],
              onChange: (choice) => {
                setEditingModel(choice === "custom");
                if (choice !== "custom") update({ model: choice.slice("model:".length) });
              },
              searchPlaceholder: "Search models"
            }
          )
        ] }),
        editingModel && /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
          /* @__PURE__ */ jsx("span", { className: "bt-grow", children: "Model ID" }),
          /* @__PURE__ */ jsx("input", { "aria-label": "Model ID", value: form.model, onChange: set("model"), autoFocus: true })
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Section, { label: "Project and access", children: [
        /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
          /* @__PURE__ */ jsx("span", { className: "bt-grow", children: "Project" }),
          /* @__PURE__ */ jsx(
            PopoverPicklist,
            {
              ariaLabel: "Project",
              className: "bt-picker",
              value: form.projectId,
              options: projects.map((project) => ({ value: project.id, label: project.name })),
              onChange: (projectId) => update({ projectId }),
              searchable: true,
              searchPlaceholder: "Search projects",
              emptyHint: "No matching projects"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
          /* @__PURE__ */ jsx("span", { className: "bt-grow", children: "Access" }),
          /* @__PURE__ */ jsx("span", { className: "bt-chip is-warn", children: "Full \xB7 runs without asking" })
        ] })
      ] }),
      action.feedback,
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginTop: 14, alignItems: "center" }, children: [
        /* @__PURE__ */ jsx("button", { type: "submit", className: "bt-btn is-primary", disabled: action.busy || changed.length === 0, children: action.busy ? "Saving\u2026" : "Save" }),
        changed.length === 0 && /* @__PURE__ */ jsx("span", { className: "bt-note", style: { margin: 0 }, children: "No changes" })
      ] })
    ] }),
    /* @__PURE__ */ jsx(DeleteBot, { bot, onDeleted })
  ] });
}
function DeleteBot({ bot, onDeleted }) {
  const action = useAction(bot.id);
  const [confirming, setConfirming] = useState(false);
  const remove = async (archiveThreads) => {
    if (await action.run("remove", { archiveThreads })) onDeleted();
  };
  if (!confirming) {
    return /* @__PURE__ */ jsx(Section, { label: "Danger zone", children: /* @__PURE__ */ jsxs("div", { className: "bt-row", children: [
      /* @__PURE__ */ jsxs("span", { className: "bt-grow", children: [
        "Delete ",
        bot.name,
        /* @__PURE__ */ jsx("span", { className: "bt-sub", children: "Its routines stop immediately." })
      ] }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-danger", onClick: () => setConfirming(true), children: "Delete bot\u2026" })
    ] }) });
  }
  return /* @__PURE__ */ jsx(Section, { label: "Danger zone", children: /* @__PURE__ */ jsxs("div", { role: "group", "aria-label": "Confirm delete", className: "bt-row", style: { flexDirection: "column", alignItems: "stretch" }, children: [
    /* @__PURE__ */ jsxs("span", { children: [
      "Delete ",
      bot.name,
      "? Its routines stop immediately."
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-danger", disabled: action.busy, onClick: () => void remove(true), children: "Delete and archive its threads" }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-danger", disabled: action.busy, onClick: () => void remove(false), children: "Delete, keep threads" }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "bt-btn is-ghost", onClick: () => setConfirming(false), children: "Cancel" })
    ] }),
    action.feedback
  ] }) });
}
function useJobs(botId) {
  const rpc = useRpc();
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const rows = await rpc.call("jobs", { bot: botId });
      if (mine !== seq.current) return;
      setJobs(rows);
      setError("");
    } catch (err) {
      if (mine === seq.current) setError(message(err));
    }
  }, [rpc, botId]);
  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);
  useRealtime(CHANNEL, (payload) => {
    const id = payload?.botId;
    if (!id || id === botId) void load();
  });
  return { jobs, error };
}
function Library({ bot, visible, jobsState }) {
  const openChat = useOpenChat();
  const { jobs, error } = jobsState;
  const tag = botMemoryTag(bot);
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    /* @__PURE__ */ jsxs(Section, { label: "Background jobs", children: [
      error && /* @__PURE__ */ jsx("p", { role: "alert", className: "bt-alert", style: { padding: "8px 12px", margin: 0 }, children: error }),
      jobs === null && !error && /* @__PURE__ */ jsx("p", { role: "status", className: "bt-note", style: { padding: "10px 12px", margin: 0 }, children: "Loading jobs\u2026" }),
      jobs?.length === 0 && /* @__PURE__ */ jsx("p", { role: "status", className: "bt-note", style: { padding: "10px 12px", margin: 0 }, children: "No background jobs yet." }),
      jobs?.map((job) => /* @__PURE__ */ jsxs("button", { type: "button", className: "bt-row", onClick: () => openChat({ name: job.title }, job.threadId), children: [
        /* @__PURE__ */ jsx("span", { className: "bt-ico", "aria-hidden": "true", children: ACTIVE_JOB.has(job.status) ? "\u2026" : "\u2713" }),
        /* @__PURE__ */ jsxs("span", { className: "bt-grow", children: [
          job.title,
          /* @__PURE__ */ jsxs("span", { className: "bt-sub", children: [
            job.archived ? "archived" : job.status,
            " \xB7 ",
            new Date(job.startedAt).toLocaleString()
          ] })
        ] }),
        /* @__PURE__ */ jsx("span", { style: muted, "aria-hidden": "true", children: "\u203A" })
      ] }, job.threadId))
    ] }),
    /* @__PURE__ */ jsx(Section, { label: "Memory", children: visible && /* @__PURE__ */ jsx(BotMemory, { tag, projectId: bot.projectId }, bot.projectId) })
  ] });
}
var ACTIVE_JOB = /* @__PURE__ */ new Set(["active", "starting", "stopping"]);
var app_default = definePluginApp((app) => {
  app.slots.navPanel({ id: "bots", title: "Bots", icon: "Bot", component: BotsPanel, experimental_basicSidebarSection: BasicBots });
});
export {
  BasicBots,
  BotAvatar,
  BotsPanel,
  botState,
  cronFor,
  app_default as default
};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs:
lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs:
lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs:
lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs:
lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs:
lucide-react/dist/esm/shared/src/build/defaultAttributes.mjs:
lucide-react/dist/esm/shared/src/build/buildLucideIconNode.mjs:
lucide-react/dist/esm/shared/src/build/buildLucideIconForReact.mjs:
lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs:
lucide-react/dist/esm/context.mjs:
lucide-react/dist/esm/Icon.mjs:
lucide-react/dist/esm/createLucideIcon.mjs:
lucide-react/dist/esm/icons/check.mjs:
lucide-react/dist/esm/icons/chevron-down.mjs:
lucide-react/dist/esm/icons/pin.mjs:
lucide-react/dist/esm/icons/search.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.47.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
//# sourceMappingURL=app.js.map
