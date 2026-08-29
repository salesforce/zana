// ../../packages/plugin-sdk/src/app.ts
function definePluginApp(setup) {
  return { __zccPluginApp: true, setup };
}

// zcc-host-react:react/jsx-runtime
var React = globalThis.__ZCC_HOST_REACT__;
var Fragment = React.Fragment;
function jsx(type, props, key) {
  return React.createElement(type, key === void 0 ? props : { ...props, key });
}
var jsxs = jsx;

// app.tsx
function CursorIcon({ className }) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      fill: "currentColor",
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      className,
      children: [
        /* @__PURE__ */ jsx("title", { children: "Cursor" }),
        /* @__PURE__ */ jsx("path", { d: "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" })
      ]
    }
  );
}
function OpencodeIcon({ className }) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      viewBox: "-72 -42 384 384",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      className,
      children: [
        /* @__PURE__ */ jsx("title", { children: "opencode" }),
        /* @__PURE__ */ jsx("path", { d: "M180 240H60V120H180V240Z", fill: "currentColor", fillOpacity: 0.45 }),
        /* @__PURE__ */ jsx("path", { d: "M180 60H60V240H180V60ZM240 300H0V0H240V300Z", fill: "currentColor" })
      ]
    }
  );
}
var app_default = definePluginApp((app) => {
  app.slots.experimental_providerIcon({
    providerId: "acp-cursor",
    icon: CursorIcon
  });
  app.slots.experimental_providerIcon({
    providerId: "acp-opencode",
    icon: OpencodeIcon
  });
});
export {
  app_default as default
};
