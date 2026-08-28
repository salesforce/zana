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
function PiIcon({ className }) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      fill: "currentColor",
      fillRule: "evenodd",
      viewBox: "100 100 600 600",
      xmlns: "http://www.w3.org/2000/svg",
      className,
      children: [
        /* @__PURE__ */ jsx("title", { children: "Pi" }),
        /* @__PURE__ */ jsx(
          "path",
          {
            d: "\n        M165.29 165.29\n        H517.36\n        V400\n        H400\n        V517.36\n        H282.65\n        V634.72\n        H165.29\n        Z\n        M282.65 282.65\n        V400\n        H400\n        V282.65\n        Z\n      "
          }
        ),
        /* @__PURE__ */ jsx("path", { d: "M517.36 400 H634.72 V634.72 H517.36 Z" })
      ]
    }
  );
}
var app_default = definePluginApp((app) => {
  app.slots.experimental_providerIcon({
    providerId: "pi",
    icon: PiIcon
  });
});
export {
  app_default as default
};
