//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
//#region ../../packages/extension-sdk/src/renderer.ts
var moduleHost = null;
/**
* Prime the module-scoped host accessor. Call this ONCE from your
* `RendererEntry.activate({ host })`, before returning, so non-React code in the
* same bundle can reach the host via {@link getModuleHost}.
*
* ```ts
* activate({ React, host }) {
*   primeModuleHost(host);
*   return { panel: MyPanel };
* }
* ```
*/
function primeModuleHost(host) {
	moduleHost = host;
}
/**
* The live {@link ModuleHost} for THIS extension, or `null` if
* {@link primeModuleHost} hasn't run yet (before `activate`, or in a test that
* didn't prime). NEVER throws — callers must null-check:
*
* ```ts
* const host = getModuleHost();
* if (!host) return; // activate hasn't primed the bridge yet
* const rows = await host.call<Row[]>('listRows');
* ```
*
* Use this ONLY for same-extension, non-React reads (a store, a data seam, a
* loop). React panels already receive `host` as a prop — don't reach for this
* there. This supersedes the per-extension `host-holder.ts` hack.
*/
function getModuleHost() {
	return moduleHost;
}
//#endregion
//#region src/host-react.ts
var hostReact = null;
/** The global the host loader assigns before importing an extension bundle. */
var GLOBAL_KEY$1 = "__ZCC_HOST_REACT__";
function setHostReact(react) {
	hostReact = react;
}
function getHostReact() {
	if (hostReact) return hostReact;
	const fromGlobal = globalThis[GLOBAL_KEY$1];
	if (fromGlobal) {
		hostReact = fromGlobal;
		return hostReact;
	}
	throw new Error("zana extension: host React unavailable — the host must set globalThis.__ZCC_HOST_REACT__ before import, or call activate({ React }).");
}
//#endregion
//#region src/react-shim.ts
/**
* Stand-in for the `react` module inside the zana extension bundle.
*
* The build aliases bare `import … from 'react'` to this file. Every export
* delegates to the host's React (captured at activate time, see ./host-react),
* so the bundle ships NO React of its own yet every hook/createElement call
* resolves against the host's single React instance — the thing that keeps
* hooks working across the blob-import boundary.
*
* These are thin wrappers (not `export const useState = getHostReact().useState`)
* on purpose: the binding must be read at CALL time, not at module-eval time,
* because module eval happens during the blob import — before `activate` has set
* the host React. Calls happen at render, strictly after activate.
*
* Only the surface the zana renderer actually uses is re-exported. If the panel
* starts using another React API, add it here.
*/
var useState = (...a) => getHostReact().useState(...a);
var useEffect = (...a) => getHostReact().useEffect(...a);
var useCallback = (...a) => getHostReact().useCallback(...a);
var useMemo = (...a) => getHostReact().useMemo(...a);
var useRef = (...a) => getHostReact().useRef(...a);
var useContext = (...a) => getHostReact().useContext(...a);
var createElement = (...a) => getHostReact().createElement(...a);
var createContext = (...a) => getHostReact().createContext(...a);
/**
* forwardRef is used by lucide-react's Icon factory — and CRUCIALLY it's called
* at lucide's MODULE-EVAL time (when this bundle is imported), which is BEFORE
* the host loader calls `activate()` to set the host React. So this one cannot
* touch `getHostReact()` eagerly (that throws "host React not set").
*
* Instead we defer: capture the render fn now and return a thin function
* component that, at RENDER time (strictly after activate), builds the real
* `forwardRef` component against the host React and renders it. The wrapped
* component is memoised so React sees a stable type across renders. This keeps
* full ref-forwarding semantics while resolving React lazily.
*/
var forwardRef = (...a) => getHostReact().forwardRef(...a);
var reactDefault = new Proxy({}, {
	get(_t, prop) {
		return getHostReact()[prop];
	},
	has(_t, prop) {
		return prop in getHostReact();
	}
});
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
	return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var toCamelCase = (string) => string.replace(/^([A-Z])|[\s-_]+(\w)/g, (match, p1, p2) => p2 ? p2.toUpperCase() : p1.toLowerCase());
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var toPascalCase = (string) => {
	const camelCase = toCamelCase(string);
	return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
};
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/defaultAttributes.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
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
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var hasA11yProp = (props) => {
	for (const prop in props) if (prop.startsWith("aria-") || prop === "role" || prop === "title") return true;
	return false;
};
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/context.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var LucideContext = createContext({});
var useLucideContext = () => useContext(LucideContext);
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/Icon.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Icon = forwardRef(({ color, size, strokeWidth, absoluteStrokeWidth, className = "", children, iconNode, ...rest }, ref) => {
	const { size: contextSize = 24, strokeWidth: contextStrokeWidth = 2, absoluteStrokeWidth: contextAbsoluteStrokeWidth = false, color: contextColor = "currentColor", className: contextClass = "" } = useLucideContext() ?? {};
	const calculatedStrokeWidth = absoluteStrokeWidth ?? contextAbsoluteStrokeWidth ? Number(strokeWidth ?? contextStrokeWidth) * 24 / Number(size ?? contextSize) : strokeWidth ?? contextStrokeWidth;
	return createElement("svg", {
		ref,
		...defaultAttributes,
		width: size ?? contextSize ?? defaultAttributes.width,
		height: size ?? contextSize ?? defaultAttributes.height,
		stroke: color ?? contextColor,
		strokeWidth: calculatedStrokeWidth,
		className: mergeClasses("lucide", contextClass, className),
		...!children && !hasA11yProp(rest) && { "aria-hidden": "true" },
		...rest
	}, [...iconNode.map(([tag, attrs]) => createElement(tag, attrs)), ...Array.isArray(children) ? children : [children]]);
});
//#endregion
//#region ../../node_modules/lucide-react/dist/esm/createLucideIcon.mjs
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var createLucideIcon = (iconName, iconNode) => {
	const Component = forwardRef(({ className, ...props }, ref) => createElement(Icon, {
		ref,
		iconNode,
		className: mergeClasses(`lucide-${toKebabCase(toPascalCase(iconName))}`, `lucide-${iconName}`, className),
		...props
	}));
	Component.displayName = toPascalCase(iconName);
	return Component;
};
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Activity = createLucideIcon("activity", [["path", {
	d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
	key: "169zse"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var ArrowRight = createLucideIcon("arrow-right", [["path", {
	d: "M5 12h14",
	key: "1ays0h"
}], ["path", {
	d: "m12 5 7 7-7 7",
	key: "xquz4c"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Ban = createLucideIcon("ban", [["circle", {
	cx: "12",
	cy: "12",
	r: "10",
	key: "1mglay"
}], ["path", {
	d: "M4.929 4.929 19.07 19.071",
	key: "196cmz"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var BookOpen = createLucideIcon("book-open", [["path", {
	d: "M12 5v16",
	key: "1f6ucr"
}], ["path", {
	d: "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z",
	key: "1fyvmf"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var CalendarRange = createLucideIcon("calendar-range", [
	["rect", {
		x: "3",
		y: "3",
		width: "18",
		height: "18",
		rx: "2",
		key: "h1oib"
	}],
	["path", {
		d: "M16 2v3",
		key: "otl347"
	}],
	["path", {
		d: "M3 9h18",
		key: "1pudct"
	}],
	["path", {
		d: "M8 2v3",
		key: "1ioesn"
	}],
	["path", {
		d: "M17 13h-6",
		key: "1qbiup"
	}],
	["path", {
		d: "M13 17H7",
		key: "1x38vv"
	}],
	["path", {
		d: "M7 13h.01",
		key: "1vezk1"
	}],
	["path", {
		d: "M17 17h.01",
		key: "1sd3ek"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var ChevronDown = createLucideIcon("chevron-down", [["path", {
	d: "m6 9 6 6 6-6",
	key: "qrunsl"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var ChevronRight = createLucideIcon("chevron-right", [["path", {
	d: "m9 18 6-6-6-6",
	key: "mthhwq"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var CircleAlert = createLucideIcon("circle-alert", [
	["circle", {
		cx: "12",
		cy: "12",
		r: "10",
		key: "1mglay"
	}],
	["line", {
		x1: "12",
		x2: "12",
		y1: "8",
		y2: "12",
		key: "1pkeuh"
	}],
	["line", {
		x1: "12",
		x2: "12.01",
		y1: "16",
		y2: "16",
		key: "4dfq90"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var CircleArrowUp = createLucideIcon("circle-arrow-up", [
	["circle", {
		cx: "12",
		cy: "12",
		r: "10",
		key: "1mglay"
	}],
	["path", {
		d: "m16 12-4-4-4 4",
		key: "177agl"
	}],
	["path", {
		d: "M12 16V8",
		key: "1sbj14"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var CircleCheck = createLucideIcon("circle-check", [["circle", {
	cx: "12",
	cy: "12",
	r: "10",
	key: "1mglay"
}], ["path", {
	d: "m9 12 2 2 4-4",
	key: "dzmm74"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var CircleDot = createLucideIcon("circle-dot", [["circle", {
	cx: "12",
	cy: "12",
	r: "10",
	key: "1mglay"
}], ["circle", {
	cx: "12",
	cy: "12",
	r: "1",
	key: "41hilf"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var CircleX = createLucideIcon("circle-x", [
	["circle", {
		cx: "12",
		cy: "12",
		r: "10",
		key: "1mglay"
	}],
	["path", {
		d: "m15 9-6 6",
		key: "1uzhvr"
	}],
	["path", {
		d: "m9 9 6 6",
		key: "z0biqf"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Copy = createLucideIcon("copy", [["rect", {
	width: "14",
	height: "14",
	x: "8",
	y: "8",
	rx: "2",
	ry: "2",
	key: "17jyea"
}], ["path", {
	d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
	key: "zix9uf"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Cpu = createLucideIcon("cpu", [
	["path", {
		d: "M12 20v2",
		key: "1lh1kg"
	}],
	["path", {
		d: "M12 2v2",
		key: "tus03m"
	}],
	["path", {
		d: "M17 20v2",
		key: "1rnc9c"
	}],
	["path", {
		d: "M17 2v2",
		key: "11trls"
	}],
	["path", {
		d: "M2 12h2",
		key: "1t8f8n"
	}],
	["path", {
		d: "M2 17h2",
		key: "7oei6x"
	}],
	["path", {
		d: "M2 7h2",
		key: "asdhe0"
	}],
	["path", {
		d: "M20 12h2",
		key: "1q8mjw"
	}],
	["path", {
		d: "M20 17h2",
		key: "1fpfkl"
	}],
	["path", {
		d: "M20 7h2",
		key: "1o8tra"
	}],
	["path", {
		d: "M7 20v2",
		key: "4gnj0m"
	}],
	["path", {
		d: "M7 2v2",
		key: "1i4yhu"
	}],
	["rect", {
		x: "4",
		y: "4",
		width: "16",
		height: "16",
		rx: "2",
		key: "1vbyd7"
	}],
	["rect", {
		x: "8",
		y: "8",
		width: "8",
		height: "8",
		rx: "1",
		key: "z9xiuo"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var FileText = createLucideIcon("file-text", [
	["path", {
		d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
		key: "1oefj6"
	}],
	["path", {
		d: "M14 2v5a1 1 0 0 0 1 1h5",
		key: "wfsgrz"
	}],
	["path", {
		d: "M10 9H8",
		key: "b1mrlr"
	}],
	["path", {
		d: "M16 13H8",
		key: "t4e002"
	}],
	["path", {
		d: "M16 17H8",
		key: "z1uh3a"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var LayoutGrid = createLucideIcon("layout-grid", [
	["rect", {
		width: "7",
		height: "7",
		x: "3",
		y: "3",
		rx: "1",
		key: "1g98yp"
	}],
	["rect", {
		width: "7",
		height: "7",
		x: "14",
		y: "3",
		rx: "1",
		key: "6d4xhi"
	}],
	["rect", {
		width: "7",
		height: "7",
		x: "14",
		y: "14",
		rx: "1",
		key: "nxv5o0"
	}],
	["rect", {
		width: "7",
		height: "7",
		x: "3",
		y: "14",
		rx: "1",
		key: "1bb6yr"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Link2 = createLucideIcon("link-2", [
	["path", {
		d: "M9 17H7A5 5 0 0 1 7 7h2",
		key: "8i5ue5"
	}],
	["path", {
		d: "M15 7h2a5 5 0 1 1 0 10h-2",
		key: "1b9ql8"
	}],
	["line", {
		x1: "8",
		x2: "16",
		y1: "12",
		y2: "12",
		key: "1jonct"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var List = createLucideIcon("list", [
	["path", {
		d: "M3 5h.01",
		key: "18ugdj"
	}],
	["path", {
		d: "M3 12h.01",
		key: "nlz23k"
	}],
	["path", {
		d: "M3 19h.01",
		key: "noohij"
	}],
	["path", {
		d: "M8 5h13",
		key: "1pao27"
	}],
	["path", {
		d: "M8 12h13",
		key: "1za7za"
	}],
	["path", {
		d: "M8 19h13",
		key: "m83p4d"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var LoaderCircle = createLucideIcon("loader-circle", [["path", {
	d: "M21 12a9 9 0 1 1-6.219-8.56",
	key: "13zald"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var MessageSquare = createLucideIcon("message-square", [["path", {
	d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
	key: "18887p"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Play = createLucideIcon("play", [["path", {
	d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
	key: "10ikf1"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var RefreshCw = createLucideIcon("refresh-cw", [
	["path", {
		d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
		key: "v9h5vc"
	}],
	["path", {
		d: "M21 3v5h-5",
		key: "1q7to0"
	}],
	["path", {
		d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
		key: "3uifl3"
	}],
	["path", {
		d: "M8 16H3v5",
		key: "1cv678"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var RotateCcwClock = createLucideIcon("rotate-ccw-clock", [
	["path", {
		d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
		key: "1357e3"
	}],
	["path", {
		d: "M3 3v5h5",
		key: "1xhq8a"
	}],
	["path", {
		d: "M12 7v5l4 2",
		key: "1fdv2h"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Search = createLucideIcon("search", [["path", {
	d: "m21 21-4.34-4.34",
	key: "14j7rj"
}], ["circle", {
	cx: "11",
	cy: "11",
	r: "8",
	key: "4ej97u"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Tag = createLucideIcon("tag", [["path", {
	d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",
	key: "vktsd0"
}], ["circle", {
	cx: "7.5",
	cy: "7.5",
	r: ".5",
	fill: "currentColor",
	key: "kqv944"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Ticket = createLucideIcon("ticket", [
	["path", {
		d: "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",
		key: "qn84l0"
	}],
	["path", {
		d: "M13 5v2",
		key: "dyzc3o"
	}],
	["path", {
		d: "M13 17v2",
		key: "1ont0d"
	}],
	["path", {
		d: "M13 11v2",
		key: "1wjjxi"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var TriangleAlert = createLucideIcon("triangle-alert", [
	["path", {
		d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
		key: "wmoenq"
	}],
	["path", {
		d: "M12 9v4",
		key: "juzpu7"
	}],
	["path", {
		d: "M12 17h.01",
		key: "p32p05"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var UserPlus = createLucideIcon("user-plus", [
	["path", {
		d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
		key: "1yyitq"
	}],
	["circle", {
		cx: "9",
		cy: "7",
		r: "4",
		key: "nufk8"
	}],
	["line", {
		x1: "19",
		x2: "19",
		y1: "8",
		y2: "14",
		key: "1bvyxn"
	}],
	["line", {
		x1: "22",
		x2: "16",
		y1: "11",
		y2: "11",
		key: "1shjgl"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var UserX = createLucideIcon("user-x", [
	["path", {
		d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
		key: "1yyitq"
	}],
	["circle", {
		cx: "9",
		cy: "7",
		r: "4",
		key: "nufk8"
	}],
	["line", {
		x1: "17",
		x2: "22",
		y1: "8",
		y2: "13",
		key: "3nzzx3"
	}],
	["line", {
		x1: "22",
		x2: "17",
		y1: "8",
		y2: "13",
		key: "1swrse"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var User = createLucideIcon("user", [["path", {
	d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
	key: "975kel"
}], ["circle", {
	cx: "12",
	cy: "7",
	r: "4",
	key: "17ys0d"
}]]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var Users = createLucideIcon("users", [
	["path", {
		d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
		key: "1yyitq"
	}],
	["path", {
		d: "M16 3.128a4 4 0 0 1 0 7.744",
		key: "16gr8j"
	}],
	["path", {
		d: "M22 21v-2a4 4 0 0 0-3-3.87",
		key: "kshegd"
	}],
	["circle", {
		cx: "9",
		cy: "7",
		r: "4",
		key: "nufk8"
	}]
]);
/**
* @license lucide-react v1.31.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var X = createLucideIcon("x", [["path", {
	d: "M18 6 6 18",
	key: "1bl5f8"
}], ["path", {
	d: "m6 6 12 12",
	key: "d8bk6v"
}]]);
//#endregion
//#region ../../src/shared/zana-types.ts
/** Statuses we treat as terminal/closed when `closedAt` isn't set. */
var CLOSED_STATUSES = /* @__PURE__ */ new Set([
	"done",
	"closed",
	"completed",
	"cancelled",
	"canceled",
	"rejected"
]);
/**
* Whether a ticket is closed. A non-null `closedAt` always wins; otherwise the
* raw status is matched (case-insensitively) against a known closed-set.
*/
function isClosedZanaStatus(status, closedAt) {
	if (closedAt) return true;
	return CLOSED_STATUSES.has((status ?? "").trim().toLowerCase());
}
//#endregion
//#region ../../node_modules/zustand/esm/vanilla.mjs
var createStoreImpl = (createState) => {
	let state;
	const listeners = /* @__PURE__ */ new Set();
	const setState = (partial, replace) => {
		const nextState = typeof partial === "function" ? partial(state) : partial;
		if (!Object.is(nextState, state)) {
			const previousState = state;
			state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
			listeners.forEach((listener) => listener(state, previousState));
		}
	};
	const getState = () => state;
	const getInitialState = () => initialState;
	const subscribe = (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	const api = {
		setState,
		getState,
		getInitialState,
		subscribe
	};
	const initialState = state = createState(setState, getState, api);
	return api;
};
var createStore = ((createState) => createState ? createStoreImpl(createState) : createStoreImpl);
//#endregion
//#region ../../node_modules/zustand/esm/react.mjs
var identity = (arg) => arg;
function useStore(api, selector = identity) {
	const slice = reactDefault.useSyncExternalStore(api.subscribe, reactDefault.useCallback(() => selector(api.getState()), [api, selector]), reactDefault.useCallback(() => selector(api.getInitialState()), [api, selector]));
	reactDefault.useDebugValue(slice);
	return slice;
}
var createImpl = (createState) => {
	const api = createStore(createState);
	const useBoundStore = (selector) => useStore(api, selector);
	Object.assign(useBoundStore, api);
	return useBoundStore;
};
var create$1 = ((createState) => createState ? createImpl(createState) : createImpl);
//#endregion
//#region src/renderer/ticketsApi.ts
/**
* Resolve the live host bridge. `getModuleHost()` returns `null` until
* `activate({ host })` has primed it — reaching the data seam before that is a
* loader ordering bug (the store never fires a read before the panel mounts), so
* we throw with a diagnostic rather than silently no-op a capability call.
*/
function hostOrThrow() {
	const host = getModuleHost();
	if (!host) throw new Error("zana extension: host bridge unavailable — the host must call activate({ host }) before any capability call.");
	return host;
}
/** Call a capability on this extension's own main provider via the host bridge. */
function callZana(capability, arg) {
	return arg === void 0 ? hostOrThrow().call(capability) : hostOrThrow().call(capability, arg);
}
/**
* Shape a {@link TicketSource} into the `{ projectPath?, useGlobal? }` hint pair
* every source-scoped capability expects.
*/
function srcArgs(s) {
	return s.kind === "global" ? { useGlobal: true } : {
		projectPath: s.projectPath,
		useGlobal: false
	};
}
/** Read a full snapshot from one `.zana` root. */
function getSnapshot(src) {
	return callZana("getSnapshot", srcArgs(src));
}
/** Read one ticket's FULL detail (incl. audit). Null when not found. */
function getTicket(src, id) {
	return callZana("getTicket", {
		...srcArgs(src),
		id
	});
}
/** Read one artifact (large `content` fetched on demand). Null when not found. */
function getArtifact(src, id) {
	return callZana("getArtifact", {
		...srcArgs(src),
		id
	});
}
/** List all agent profiles (built-in + workspace). Global-only — no source. */
function listProfiles() {
	return callZana("listProfiles");
}
/** Read one profile's full detail (incl. system prompt). Payload is `{ id }`. */
function getProfile(id) {
	return callZana("getProfile", { id });
}
/** Set/clear a ticket's assignee; returns the re-read detail (throws on not-found). */
function assignTicket(src, id, patch) {
	return callZana("assignTicket", {
		...srcArgs(src),
		id,
		...patch
	});
}
/** Installed vs. latest `@zana-ai/mcp` version. No args. */
function getVersionInfo() {
	return callZana("getVersionInfo");
}
/**
* Explicit, user-initiated init: create `.zana/` for this source's root if it
* doesn't already exist (the "Init Zana" empty-state button). Idempotent —
* `{created:false}` when the workspace was already initialized. Throws on
* failure (unlike the read capabilities above).
*/
function initProject(src) {
	return callZana("initProject", srcArgs(src));
}
/**
* Aggregate namespace so consumers (the store, views, version check) import ONE
* symbol instead of reaching for the host bridge themselves.
*/
var ticketsApi = {
	getSnapshot,
	getTicket,
	getArtifact,
	listProfiles,
	getProfile,
	assignTicket,
	getVersionInfo,
	initProject
};
//#endregion
//#region src/renderer/zanaPrefs.ts
/** Active Tickets-view sub-tab (`tickets|sprints|docs|profiles`). */
var ACTIVE_TAB_KEY = "zcc.tickets.activeTab";
/** Global auto-refresh toggle, stored as `'true'`/`'false'`. */
var AUTO_REFRESH_KEY = "zcc.tickets.autoRefresh";
/** Per-project collapsed-column map prefix; the project id is appended. */
var COLLAPSED_PREFIX = "zcc.tickets.collapsedColumns.";
/** Board-wide render density (`'card'`/`'list'`) for the whole kanban. Global
*  (shared across projects), like the auto-refresh toggle. */
var BOARD_DENSITY_KEY = "zcc.tickets.boardDensity";
/** The valid sub-tab values; a stored value outside this set falls back. */
var SUB_TABS = [
	"tickets",
	"sprints",
	"docs",
	"profiles"
];
var DEFAULT_SUB_TAB = "tickets";
/** Project-scoped collapsed-columns key. A storage namespace, NOT a filesystem
*  path — so Rules 1/2 (path confinement) do not apply. */
function collapsedKey(projectId) {
	return `${COLLAPSED_PREFIX}${projectId}`;
}
/** Read a raw string from `localStorage`, degrading to `null` when storage is
*  absent (SSR/test) or throws. */
function safeGet(key) {
	if (typeof localStorage === "undefined") return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
/** Write a raw string to `localStorage`, swallowing a quota error or an absent
*  store (write is best-effort; a failure must never throw into the UI). */
function safeSet(key, value) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(key, value);
	} catch {}
}
/** The persisted sub-tab, validated against the enum; garbage/absent →
*  `'tickets'` so a stale value can never render a dead tab. */
function readActiveTab() {
	const raw = safeGet(ACTIVE_TAB_KEY);
	return SUB_TABS.includes(raw ?? "") ? raw : DEFAULT_SUB_TAB;
}
/** Persist the active sub-tab. */
function writeActiveTab(tab) {
	safeSet(ACTIVE_TAB_KEY, tab);
}
/** Auto-refresh preference. DEFAULT ON: only an explicit stored `'false'`
*  disables it (a naive `=== 'true'` would silently flip the default OFF for
*  every existing user). */
function readAutoRefresh() {
	return safeGet(AUTO_REFRESH_KEY) !== "false";
}
/** Persist the auto-refresh toggle. */
function writeAutoRefresh(on) {
	safeSet(AUTO_REFRESH_KEY, on ? "true" : "false");
}
/** The per-project collapsed-columns map (status → collapsed). Returns `{}` on
*  absent/malformed JSON AND on non-object JSON (`null`, numbers, arrays-as-…) —
*  the `typeof === 'object'` guard rejects what a bare `?? {}` would let slip. */
function readCollapsed(projectId) {
	const raw = safeGet(collapsedKey(projectId));
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
/** Persist one project's collapsed-columns map. */
function writeCollapsed(projectId, map) {
	safeSet(collapsedKey(projectId), JSON.stringify(map));
}
/** The board-wide density. DEFAULT `'card'`; only an explicit stored `'list'`
*  switches it (any other/garbage value falls back to the default). */
function readBoardDensity() {
	return safeGet(BOARD_DENSITY_KEY) === "list" ? "list" : "card";
}
/** Persist the board-wide density. */
function writeBoardDensity(density) {
	safeSet(BOARD_DENSITY_KEY, density);
}
//#endregion
//#region src/renderer/ticketsStore.ts
/**
* `useTickets` — the core zustand store that OWNS the per-project Zana snapshot
* (tickets / sprints / docs / profiles / KPIs), the optimistic-assign + undo
* machinery, and a store-level 30s auto-refresh tick.
*
* Why a store (and not per-view state): the Tickets view (C2–C4) fully unmounts
* on every WorkspaceMode tab switch (`Workspace.tsx` renders each mode as a
* separate conditional block, so toggling modes tears the view down). A
* mount-effect `getSnapshot`/`listProfiles` would re-hit IPC on every toggle —
* the per-mount storm. This store caches per source-key so a remount is a cache
* hit, collapsing N × {getSnapshot+listProfiles} to one fetch per key
* (Rule 5: bound growing reads). The view becomes a thin reader that calls
* `ensure`/`startAutoRefresh` on mount.
*
* Quarantine (Rule 6): this file imports the B2 `ticketsApi` seam ONLY. It
* NEVER names the `'zana'` module id, `getHost`, or `window.cc.modules`. Types
* resolve to `@shared/zana-types` (core), never `plugins/zana/*`.
*
* Trust (Rule 1/2): `projectPath` / `useGlobal` / `id` are passed UNMODIFIED to
* `ticketsApi`; main re-resolves and may throw. The store makes no trust
* decision and defaults nothing.
*
* Timer hygiene (Rule 3): the assign-commit timers, undo auto-dismiss timers,
* and the one-per-key 30s refresh interval are MODULE-LEVEL (not React refs) so
* they survive the view's remounts — a mid-undo-window tab switch must still
* commit. They are released only via `undoAssign` / `clearProject` / HMR
* dispose, never on a view unmount.
*/
/** How often the store fires a quiet background reload, per active key. */
var AUTO_REFRESH_MS = 3e4;
/** How long an optimistic assign can be undone before the write commits. */
var UNDO_WINDOW_MS = 6e3;
/** Map-key for the global `~/.zana` anchor. NEVER `''` — a falsy key collides
*  with `if (id)` guards in the view (e.g. ZanaPanel `switchSource`). */
var GLOBAL_KEY = "__global__";
/** Internal: derive the `byKey` map-key from a {@link TicketsKey}. */
function mapKeyOf(key) {
	return key.useGlobal ? GLOBAL_KEY : key.projectId;
}
/** Internal: shape a {@link TicketsKey} into the B2 {@link TicketSource}. */
function sourceOf(key) {
	return key.useGlobal ? { kind: "global" } : {
		kind: "project",
		projectPath: key.projectPath ?? ""
	};
}
/** A fresh, fully-defaulted entry. */
function emptyEntry() {
	return {
		snapshot: null,
		profiles: [],
		loading: false,
		refreshing: false,
		error: null,
		loadedAt: null,
		profilesLoadedAt: null,
		paused: false,
		collapsedColumns: {}
	};
}
/** Pending commit timers, keyed `${mapKey}::${ticketId}`. */
var assignTimers = /* @__PURE__ */ new Map();
/** Rollback baselines (pre-assign fields), keyed `${mapKey}::${ticketId}`. */
var assignPrev = /* @__PURE__ */ new Map();
/** Undo-banner auto-dismiss timers, keyed by map-key. */
var dismissTimers = /* @__PURE__ */ new Map();
/** Auto-refresh interval handles, keyed by map-key (one per key). */
var refreshIntervals = /* @__PURE__ */ new Map();
/** Auto-refresh subscriber refcounts, keyed by map-key. */
var refreshRefcounts = /* @__PURE__ */ new Map();
var globalProfiles = [];
var globalProfilesLoadedAt = null;
/** De-dupes concurrent first-load callers onto the single in-flight fetch. */
var globalProfilesInflight = null;
/** Compose the per-ticket timer/baseline key. */
function timerKey(mapKey, ticketId) {
	return `${mapKey}::${ticketId}`;
}
/**
* Mirror the GLOBAL profiles cache into one entry so the per-project view keeps
* a single `entry.profiles` read surface. Stamps the entry's `profilesLoadedAt`
* from the global gate so a per-entry "loaded once" check still reads truthy.
* No-ops (no re-render) when the entry already holds the same cached reference.
*/
function mirrorProfilesToEntry(set, mapKey) {
	set((s) => {
		const entry = s.byKey[mapKey] ?? emptyEntry();
		if (entry.profiles === globalProfiles && entry.profilesLoadedAt === globalProfilesLoadedAt) return {};
		return { byKey: {
			...s.byKey,
			[mapKey]: {
				...entry,
				profiles: globalProfiles,
				profilesLoadedAt: globalProfilesLoadedAt
			}
		} };
	});
}
/** Immutably patch one ticket's assignee fields inside a key's snapshot. */
function patchAssignee(set, mapKey, ticketId, patch) {
	set((s) => {
		const entry = s.byKey[mapKey];
		if (!entry?.snapshot) return {};
		const snap = entry.snapshot;
		return { byKey: {
			...s.byKey,
			[mapKey]: {
				...entry,
				snapshot: {
					...snap,
					tickets: snap.tickets.map((t) => t.id === ticketId ? {
						...t,
						...patch
					} : t)
				}
			}
		} };
	});
}
var useTickets = create$1((set, get) => ({
	byKey: {},
	assignUndo: {},
	subTab: readActiveTab(),
	setSubTab: (t) => {
		writeActiveTab(t);
		set({ subTab: t });
	},
	autoRefresh: readAutoRefresh(),
	setAutoRefresh: (on) => {
		writeAutoRefresh(on);
		set({ autoRefresh: on });
	},
	boardDensity: readBoardDensity(),
	setBoardDensity: (density) => {
		writeBoardDensity(density);
		set({ boardDensity: density });
	},
	sprintFilter: null,
	setSprintFilter: (id) => set({ sprintFilter: id }),
	openSprint: (sprintId) => {
		writeActiveTab("tickets");
		set({
			sprintFilter: sprintId,
			subTab: "tickets"
		});
	},
	ensure: (key) => {
		const k = mapKeyOf(key);
		const entry = get().byKey[k];
		if (entry?.loadedAt != null) {
			get().loadProfiles(key);
			return;
		}
		if (entry?.loading) return;
		const seededCollapsed = readCollapsed(k);
		set((s) => ({ byKey: {
			...s.byKey,
			[k]: {
				...s.byKey[k] ?? emptyEntry(),
				loading: true,
				collapsedColumns: seededCollapsed
			}
		} }));
		get().refresh(key, { background: false });
		get().loadProfiles(key);
	},
	initProject: async (key) => {
		const result = await ticketsApi.initProject(sourceOf(key));
		await get().refresh(key, { background: false });
		return result;
	},
	hydrateAll: async (projects) => {
		const list = projects ?? [];
		for (const p of list) {
			const k = mapKeyOf({ projectId: p.id });
			const entry = get().byKey[k];
			if (entry?.loadedAt != null || entry?.loading) continue;
			await get().refresh({
				projectId: p.id,
				projectPath: p.path
			}, { background: true });
		}
	},
	refresh: async (key, opts) => {
		const background = opts?.background ?? false;
		const k = mapKeyOf(key);
		set((s) => {
			const entry = s.byKey[k] ?? emptyEntry();
			return { byKey: {
				...s.byKey,
				[k]: {
					...entry,
					...background ? { refreshing: true } : {
						loading: true,
						error: null
					}
				}
			} };
		});
		try {
			const snap = await ticketsApi.getSnapshot(sourceOf(key));
			set((s) => {
				const entry = s.byKey[k] ?? emptyEntry();
				return { byKey: {
					...s.byKey,
					[k]: {
						...entry,
						snapshot: snap,
						loadedAt: Date.now(),
						loading: false,
						refreshing: false,
						error: null
					}
				} };
			});
		} catch (err) {
			set((s) => {
				const entry = s.byKey[k] ?? emptyEntry();
				if (background) return { byKey: {
					...s.byKey,
					[k]: {
						...entry,
						refreshing: false
					}
				} };
				return { byKey: {
					...s.byKey,
					[k]: {
						...entry,
						snapshot: null,
						loading: false,
						refreshing: false,
						error: err instanceof Error ? err.message : String(err)
					}
				} };
			});
		}
	},
	loadProfiles: async (key) => {
		const k = mapKeyOf(key);
		if (globalProfilesLoadedAt != null) {
			mirrorProfilesToEntry(set, k);
			return;
		}
		if (!globalProfilesInflight) globalProfilesInflight = (async () => {
			let list = [];
			try {
				const fetched = await ticketsApi.listProfiles();
				if (Array.isArray(fetched)) list = fetched;
			} catch {}
			globalProfiles = list;
			globalProfilesLoadedAt = Date.now();
			globalProfilesInflight = null;
			return list;
		})();
		await globalProfilesInflight;
		mirrorProfilesToEntry(set, k);
	},
	applyAssign: (key, ticket, choice) => {
		const k = mapKeyOf(key);
		const tk = timerKey(k, ticket.id);
		const pending = assignTimers.get(tk);
		if (pending) {
			clearTimeout(pending);
			assignTimers.delete(tk);
		}
		if (!assignPrev.has(tk)) assignPrev.set(tk, {
			assigneeName: ticket.assigneeName,
			assigneeId: ticket.assigneeId,
			assigneeProfileId: ticket.assigneeProfileId
		});
		let patch;
		let args;
		let label;
		if (choice.kind === "clear") {
			patch = {
				assigneeName: void 0,
				assigneeId: void 0,
				assigneeProfileId: void 0
			};
			args = { profileId: null };
			label = "Unassigned";
		} else if (choice.kind === "profile") {
			patch = {
				assigneeName: choice.displayName,
				assigneeProfileId: choice.profileId
			};
			args = { profileId: choice.profileId };
			label = choice.displayName;
		} else {
			patch = {
				assigneeName: choice.assigneeName,
				assigneeProfileId: void 0
			};
			args = { assigneeName: choice.assigneeName };
			label = choice.assigneeName;
		}
		patchAssignee(set, k, ticket.id, patch);
		const commit = setTimeout(() => {
			assignTimers.delete(tk);
			ticketsApi.assignTicket(sourceOf(key), ticket.id, args).then(() => {
				assignPrev.delete(tk);
				get().refresh(key, { background: true });
			}).catch((err) => {
				const prev = assignPrev.get(tk);
				if (prev) patchAssignee(set, k, ticket.id, prev);
				assignPrev.delete(tk);
				set((s) => {
					const entry = s.byKey[k];
					if (!entry) return {};
					return { byKey: {
						...s.byKey,
						[k]: {
							...entry,
							error: `Couldn't assign ${label} — ${err instanceof Error ? err.message : String(err)}`
						}
					} };
				});
			});
		}, UNDO_WINDOW_MS);
		assignTimers.set(tk, commit);
		const priorDismiss = dismissTimers.get(k);
		if (priorDismiss) clearTimeout(priorDismiss);
		const dismiss = setTimeout(() => {
			dismissTimers.delete(k);
			set((s) => ({ assignUndo: {
				...s.assignUndo,
				[k]: null
			} }));
		}, UNDO_WINDOW_MS);
		dismissTimers.set(k, dismiss);
		set((s) => ({ assignUndo: {
			...s.assignUndo,
			[k]: {
				id: ticket.id,
				label
			}
		} }));
	},
	undoAssign: (key, ticketId) => {
		const k = mapKeyOf(key);
		const tk = timerKey(k, ticketId);
		const timer = assignTimers.get(tk);
		if (timer) {
			clearTimeout(timer);
			assignTimers.delete(tk);
		}
		const prev = assignPrev.get(tk);
		if (prev) {
			patchAssignee(set, k, ticketId, prev);
			assignPrev.delete(tk);
		}
		const dismiss = dismissTimers.get(k);
		if (dismiss) {
			clearTimeout(dismiss);
			dismissTimers.delete(k);
		}
		set((s) => ({ assignUndo: {
			...s.assignUndo,
			[k]: null
		} }));
	},
	startAutoRefresh: (key) => {
		const k = mapKeyOf(key);
		const next = (refreshRefcounts.get(k) ?? 0) + 1;
		refreshRefcounts.set(k, next);
		if (next === 1 && !refreshIntervals.has(k)) {
			const handle = setInterval(() => {
				const s = get();
				if (s.autoRefresh && !s.byKey[k]?.paused) s.refresh(key, { background: true });
			}, AUTO_REFRESH_MS);
			refreshIntervals.set(k, handle);
		}
	},
	stopAutoRefresh: (key) => {
		const k = mapKeyOf(key);
		const cur = refreshRefcounts.get(k) ?? 0;
		if (cur <= 1) {
			refreshRefcounts.delete(k);
			const handle = refreshIntervals.get(k);
			if (handle) {
				clearInterval(handle);
				refreshIntervals.delete(k);
			}
		} else refreshRefcounts.set(k, cur - 1);
	},
	setPaused: (key, paused) => {
		const k = mapKeyOf(key);
		set((s) => {
			const entry = s.byKey[k];
			if (!entry || entry.paused === paused) return {};
			return { byKey: {
				...s.byKey,
				[k]: {
					...entry,
					paused
				}
			} };
		});
	},
	toggleColumnCollapsed: (key, status, defaultCollapsed) => {
		const k = mapKeyOf(key);
		const statusKey = status.trim().toLowerCase();
		set((s) => {
			const entry = s.byKey[k] ?? emptyEntry();
			const next = {
				...entry.collapsedColumns,
				[statusKey]: !(entry.collapsedColumns[statusKey] ?? defaultCollapsed)
			};
			writeCollapsed(k, next);
			return { byKey: {
				...s.byKey,
				[k]: {
					...entry,
					collapsedColumns: next
				}
			} };
		});
	},
	clearProject: (projectId) => {
		const prefix = `${projectId}::`;
		for (const [tk, timer] of assignTimers) if (tk.startsWith(prefix)) {
			clearTimeout(timer);
			assignTimers.delete(tk);
		}
		for (const tk of [...assignPrev.keys()]) if (tk.startsWith(prefix)) assignPrev.delete(tk);
		const dismiss = dismissTimers.get(projectId);
		if (dismiss) {
			clearTimeout(dismiss);
			dismissTimers.delete(projectId);
		}
		const interval = refreshIntervals.get(projectId);
		if (interval) {
			clearInterval(interval);
			refreshIntervals.delete(projectId);
		}
		refreshRefcounts.delete(projectId);
		set((s) => {
			if (!(projectId in s.byKey) && !(projectId in s.assignUndo)) return {};
			const byKey = { ...s.byKey };
			delete byKey[projectId];
			const assignUndo = { ...s.assignUndo };
			delete assignUndo[projectId];
			return {
				byKey,
				assignUndo
			};
		});
	}
}));
/** The whole cached entry for a key (or undefined before first ensure). */
function useTicketsEntry(key) {
	return useTickets((s) => s.byKey[mapKeyOf(key)]);
}
/** The KPIs for a key's snapshot (or null). */
function useTicketsKpis(key) {
	return useTickets((s) => s.byKey[mapKeyOf(key)]?.snapshot?.kpis ?? null);
}
//#endregion
//#region src/renderer/ticketColumns.ts
/** Canonical ordering for kanban columns; unknown statuses sort after these. */
var STATUS_ORDER = [
	"backlog",
	"todo",
	"to do",
	"in-progress",
	"in progress",
	"doing",
	"review",
	"in review",
	"blocked",
	"done",
	"closed",
	"completed",
	"cancelled",
	"canceled",
	"rejected"
];
/** Rank a raw status against {@link STATUS_ORDER}; unknown statuses trail. */
function statusRank(status) {
	const i = STATUS_ORDER.indexOf(status.trim().toLowerCase());
	return i === -1 ? STATUS_ORDER.length : i;
}
/**
* Statuses whose columns are terminal (done/cancelled/etc). These hold the
* least-actionable tickets — usually the bulk of the board — so their columns
* start collapsed and, when expanded, render as dense one-line rows rather than
* full cards.
*/
var TERMINAL_STATUSES = /* @__PURE__ */ new Set([
	"done",
	"closed",
	"completed",
	"cancelled",
	"canceled",
	"rejected"
]);
/** Whether a status's column is terminal (collapsed by default). */
function isTerminalStatus(status) {
	return TERMINAL_STATUSES.has(status.trim().toLowerCase());
}
/** Clip a long id to a readable short form for the card footer. */
function shortId$1(id) {
	return id.length > 8 ? id.slice(0, 8) : id;
}
/**
* Resolve a sprint id to a REAL display name, or undefined. The main module
* synthesises `Sprint <hash>` for unnamed sprints; we treat that as "no real
* name" so the card doesn't show a mystery hash chip.
*/
function resolveSprintName(sprintId, sprints) {
	if (!sprintId) return void 0;
	const name = sprints.find((s) => s.id === sprintId)?.name;
	if (!name) return void 0;
	if (name === `Sprint ${sprintId.slice(0, 8)}`) return void 0;
	return name;
}
/**
* Titles Zana's own integration tests leave behind (e.g. `test-1778…-claim`,
* `Test ticket`, bare `Updated`/`blocked`). These carry no real content, so we
* rank them below substantive tickets within a column rather than hide them.
*/
var TEST_TITLE_RE = /^(test-\d+|test ticket|updated|blocked|round-trip test)\b/i;
/**
* A rough "substance" score so meaningful tickets surface above bare test
* fixtures within each kanban column. Higher = more real content. Purely a
* display sort — nothing is filtered out or mutated.
*/
function substanceScore(t) {
	let score = 0;
	if ((t.description ?? "").trim().length > 0) score += 3;
	if (t.sprintId) score += 1;
	if (t.labels.length > 0) score += 1;
	if (t.assigneeName) score += 1;
	if (TEST_TITLE_RE.test(t.title.trim())) score -= 4;
	return score;
}
/**
* Client-side text filter over tickets (title + labels + assignee), plus an
* optional sprint filter and assignee filter. Mirrors the panel's
* `filteredTickets` memo body.
*/
function filterTickets(tickets, query, sprintFilter, assigneeFilter) {
	const q = query.trim().toLowerCase();
	return tickets.filter((t) => {
		if (sprintFilter && t.sprintId !== sprintFilter) return false;
		if (assigneeFilter !== void 0 && assigneeFilter !== null) {
			if (assigneeFilter === "__unassigned__") {
				if (t.assigneeName) return false;
			} else if ((t.assigneeName ?? "") !== assigneeFilter) return false;
		}
		if (!q) return true;
		return t.title.toLowerCase().includes(q) || t.labels.some((l) => l.toLowerCase().includes(q)) || (t.assigneeName ?? "").toLowerCase().includes(q);
	});
}
/**
* Extract unique assignee names from a tickets list, sorted alphabetically.
*/
function extractAssignees(tickets) {
	const names = /* @__PURE__ */ new Set();
	for (const t of tickets) if (t.assigneeName) names.add(t.assigneeName);
	return [...names].sort((a, b) => a.localeCompare(b));
}
/**
* Group filtered tickets into kanban columns keyed by raw status, ordered by
* the canonical sequence with unknown statuses trailing alphabetically. Within
* each column, rank substantive tickets above bare test fixtures, keeping the
* incoming `updatedAt`-desc order as the tiebreaker (a stable sort on score
* alone preserves it).
*/
function buildColumns(tickets) {
	const map = /* @__PURE__ */ new Map();
	for (const t of tickets) {
		const key = t.status || "unknown";
		(map.get(key) ?? map.set(key, []).get(key)).push(t);
	}
	for (const items of map.values()) items.sort((a, b) => substanceScore(b) - substanceScore(a));
	return [...map.entries()].sort(([a], [b]) => {
		const ra = statusRank(a);
		const rb = statusRank(b);
		return ra !== rb ? ra - rb : a.localeCompare(b);
	});
}
/**
* Whether a RESOLVED snapshot holds no data of any kind. Derived from the
* snapshot ARRAYS (not a `kpis` zero-check — kpis can read all-zero with stale
* arrays), per the C2 empty-state contract.
*/
function isSnapshotEmpty(snapshot) {
	if (!snapshot) return false;
	return snapshot.tickets.length === 0 && snapshot.sprints.length === 0 && snapshot.artifacts.length === 0;
}
//#endregion
//#region src/jsx-runtime-shim.ts
/**
* Stand-in for `react/jsx-runtime` inside the zana extension bundle.
*
* With `jsx: 'automatic'`, TSX compiles `<div/>` to `jsx('div', …)` and `<>…</>`
* to `jsx(Fragment, …)`, importing `jsx`/`jsxs`/`Fragment` from
* `react/jsx-runtime`. The build aliases that bare import here so nothing
* unresolved survives into the blob-imported bundle.
*
* `jsx`/`jsxs` delegate to the host React's `jsx-runtime` (React 18 ships it at
* `react/jsx-runtime`, but it's equivalent to `createElement`, so we route
* through the host React we already hold). We call `createElement` rather than
* the host's internal `jsx` to avoid depending on a non-public export: the
* difference (key handling) is immaterial for our statically-authored panel.
*
* `Fragment` is exported as a sentinel; `jsx`/`jsxs` swap it for the host's real
* `React.Fragment` at call time (we can't export the real one at module-eval
* time — the host React isn't set until activate runs).
*/
/** Unique marker the compiler passes for `<>…</>`; swapped for the real one. */
var Fragment = Symbol.for("zana.jsx.Fragment");
function build(type, props, key) {
	const React = getHostReact();
	const realType = type === Fragment ? React.Fragment : type;
	const { children, ...rest } = props ?? {};
	const restWithKey = key === void 0 ? rest : {
		...rest,
		key
	};
	if (Array.isArray(children)) return React.createElement(realType, restWithKey, ...children);
	if (children === void 0) return React.createElement(realType, restWithKey);
	return React.createElement(realType, restWithKey, children);
}
function jsx(type, props, key) {
	return build(type, props, key);
}
function jsxs(type, props, key) {
	return build(type, props, key);
}
//#endregion
//#region src/renderer/AssignMenu.tsx
/**
* Shared assignment UI + profile helpers for the core Tickets view. Used by both
* the board cards (a compact "assign" affordance) and the detail modal (a
* prominent "Assign" dropdown). The actual write + optimistic/undo bookkeeping
* lives in the B3 `useTickets` store; this file only renders the picker and
* resolves an `assigneeProfileId` → `{ icon, displayName }` for display.
*
* Decoupling (Rule 6): imports only `@shared/zana-types` + react/lucide. No host
* calls, no module-id literal, no `@zana-ai/zcc-extension-sdk` — the picker reports a
* chosen `AssignChoice` up to its owner, which performs the optimistic patch +
* deferred write.
*
* Ported verbatim from `plugins/zana/renderer/ZanaAssign.tsx` (C4). The type
* import already pointed at `@shared/zana-types`, so no re-pointing was needed.
*/
/** Build a `ProfileMap` from the fetched profiles list. */
function buildProfileMap(profiles) {
	const map = /* @__PURE__ */ new Map();
	for (const p of profiles) if (p && typeof p.id === "string") map.set(p.id, p);
	return map;
}
/** Resolve a profile id to a compact `{ icon, displayName }`, or undefined. */
function profileLabel(profileId, profiles) {
	if (!profileId) return void 0;
	const p = profiles.get(profileId);
	if (!p) return void 0;
	return {
		icon: p.icon ?? "🤖",
		displayName: p.displayName
	};
}
/** Two-initial avatar text from a display name. */
function initials$1(name) {
	return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}
/**
* A deterministic, readable avatar color for an owner. The same owner key
* always maps to the same hue, so `worker-a` and `worker-b` are visually
* distinct at a glance and stable across renders. Returns a CSS color.
*/
function avatarColor(key) {
	let hash = 0;
	for (let i = 0; i < key.length; i++) hash = hash * 31 + key.charCodeAt(i) | 0;
	return `hsl(${Math.abs(hash) % 360} 58% 52%)`;
}
/**
* The assignment popover menu. Renders a list of profiles (emoji + name), an
* "Unassigned" option to clear, and a free-text input at the bottom. Closes on
* outside-click / Escape. Calls `onPick` with the chosen `AssignChoice` then
* closes; `onClose` fires for dismissal without a pick.
*/
function AssignMenu({ profiles, onPick, onClose, align = "left" }) {
	const [name, setName] = useState("");
	const ref = useRef(null);
	useEffect(() => {
		const onDown = (e) => {
			if (ref.current && !ref.current.contains(e.target)) onClose();
		};
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
			}
		};
		const t = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
		document.addEventListener("keydown", onKey, true);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [onClose]);
	const submitName = () => {
		const trimmed = name.trim();
		if (trimmed) onPick({
			kind: "name",
			assigneeName: trimmed
		});
	};
	return /* @__PURE__ */ jsxs("div", {
		ref,
		className: `zana-assign-menu zana-assign-menu--${align}`,
		role: "menu",
		onClick: (e) => e.stopPropagation(),
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "zana-assign-menu-label",
				children: "Assign to"
			}),
			/* @__PURE__ */ jsxs("button", {
				type: "button",
				role: "menuitem",
				className: "zana-assign-item zana-assign-item--clear",
				onClick: () => onPick({ kind: "clear" }),
				children: [/* @__PURE__ */ jsx("span", {
					className: "zana-assign-item-icon",
					"aria-hidden": true,
					children: /* @__PURE__ */ jsx(UserX, { size: 13 })
				}), /* @__PURE__ */ jsx("span", {
					className: "zana-assign-item-name",
					children: "Unassigned"
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-assign-menu-list",
				children: [profiles.length === 0 && /* @__PURE__ */ jsx("div", {
					className: "zana-assign-menu-empty",
					children: "No workspace profiles."
				}), profiles.map((p) => /* @__PURE__ */ jsxs("button", {
					type: "button",
					role: "menuitem",
					className: "zana-assign-item",
					onClick: () => onPick({
						kind: "profile",
						profileId: p.id,
						displayName: p.displayName
					}),
					title: p.description ?? p.displayName,
					children: [
						/* @__PURE__ */ jsx("span", {
							className: "zana-assign-item-icon",
							"aria-hidden": true,
							children: p.icon ?? "🤖"
						}),
						/* @__PURE__ */ jsx("span", {
							className: "zana-assign-item-name",
							children: p.displayName
						}),
						p.category && /* @__PURE__ */ jsx("span", {
							className: "zana-assign-item-cat",
							children: p.category
						})
					]
				}, p.id))]
			}),
			/* @__PURE__ */ jsxs("form", {
				className: "zana-assign-freetext",
				onSubmit: (e) => {
					e.preventDefault();
					submitName();
				},
				children: [/* @__PURE__ */ jsx("input", {
					type: "text",
					placeholder: "Assign to name…",
					value: name,
					onChange: (e) => setName(e.target.value),
					"aria-label": "Assign to a name"
				}), /* @__PURE__ */ jsx("button", {
					type: "submit",
					disabled: !name.trim(),
					title: "Assign to this name",
					children: /* @__PURE__ */ jsx(UserPlus, { size: 13 })
				})]
			})
		]
	});
}
//#endregion
//#region ../../node_modules/comma-separated-tokens/index.js
/**
* Serialize an array of strings or numbers to comma-separated tokens.
*
* @param {Array<string|number>} values
*   List of tokens.
* @param {Options} [options]
*   Configuration for `stringify` (optional).
* @returns {string}
*   Comma-separated tokens.
*/
function stringify$1(values, options) {
	const settings = options || {};
	return (values[values.length - 1] === "" ? [...values, ""] : values).join((settings.padRight ? " " : "") + "," + (settings.padLeft === false ? "" : " ")).trim();
}
//#endregion
//#region ../../node_modules/estree-util-is-identifier-name/lib/index.js
var nameRe = /^[$_\p{ID_Start}][$_\u{200C}\u{200D}\p{ID_Continue}]*$/u;
var nameReJsx = /^[$_\p{ID_Start}][-$_\u{200C}\u{200D}\p{ID_Continue}]*$/u;
/** @type {Options} */
var emptyOptions$3 = {};
/**
* Checks if the given value is a valid identifier name.
*
* @param {string} name
*   Identifier to check.
* @param {Options | null | undefined} [options]
*   Configuration (optional).
* @returns {boolean}
*   Whether `name` can be an identifier.
*/
function name(name, options) {
	return ((options || emptyOptions$3).jsx ? nameReJsx : nameRe).test(name);
}
//#endregion
//#region ../../node_modules/hast-util-whitespace/lib/index.js
/**
* @typedef {import('hast').Nodes} Nodes
*/
var re = /[ \t\n\f\r]/g;
/**
* Check if the given value is *inter-element whitespace*.
*
* @param {Nodes | string} thing
*   Thing to check (`Node` or `string`).
* @returns {boolean}
*   Whether the `value` is inter-element whitespace (`boolean`): consisting of
*   zero or more of space, tab (`\t`), line feed (`\n`), carriage return
*   (`\r`), or form feed (`\f`); if a node is passed it must be a `Text` node,
*   whose `value` field is checked.
*/
function whitespace(thing) {
	return typeof thing === "object" ? thing.type === "text" ? empty$1(thing.value) : false : empty$1(thing);
}
/**
* @param {string} value
* @returns {boolean}
*/
function empty$1(value) {
	return value.replace(re, "") === "";
}
//#endregion
//#region ../../node_modules/property-information/lib/util/schema.js
/**
* @import {Schema as SchemaType, Space} from 'property-information'
*/
/** @type {SchemaType} */
var Schema = class {
	/**
	* @param {SchemaType['property']} property
	*   Property.
	* @param {SchemaType['normal']} normal
	*   Normal.
	* @param {Space | undefined} [space]
	*   Space.
	* @returns
	*   Schema.
	*/
	constructor(property, normal, space) {
		this.normal = normal;
		this.property = property;
		if (space) this.space = space;
	}
};
Schema.prototype.normal = {};
Schema.prototype.property = {};
Schema.prototype.space = void 0;
//#endregion
//#region ../../node_modules/property-information/lib/util/merge.js
/**
* @import {Info, Space} from 'property-information'
*/
/**
* @param {ReadonlyArray<Schema>} definitions
*   Definitions.
* @param {Space | undefined} [space]
*   Space.
* @returns {Schema}
*   Schema.
*/
function merge(definitions, space) {
	/** @type {Record<string, Info>} */
	const property = {};
	/** @type {Record<string, string>} */
	const normal = {};
	for (const definition of definitions) {
		Object.assign(property, definition.property);
		Object.assign(normal, definition.normal);
	}
	return new Schema(property, normal, space);
}
//#endregion
//#region ../../node_modules/property-information/lib/normalize.js
/**
* Get the cleaned case insensitive form of an attribute or property.
*
* @param {string} value
*   An attribute-like or property-like name.
* @returns {string}
*   Value that can be used to look up the properly cased property on a
*   `Schema`.
*/
function normalize$1(value) {
	return value.toLowerCase();
}
//#endregion
//#region ../../node_modules/property-information/lib/util/info.js
/**
* @import {Info as InfoType} from 'property-information'
*/
/** @type {InfoType} */
var Info = class {
	/**
	* @param {string} property
	*   Property.
	* @param {string} attribute
	*   Attribute.
	* @returns
	*   Info.
	*/
	constructor(property, attribute) {
		this.attribute = attribute;
		this.property = property;
	}
};
Info.prototype.attribute = "";
Info.prototype.booleanish = false;
Info.prototype.boolean = false;
Info.prototype.commaOrSpaceSeparated = false;
Info.prototype.commaSeparated = false;
Info.prototype.defined = false;
Info.prototype.mustUseProperty = false;
Info.prototype.number = false;
Info.prototype.overloadedBoolean = false;
Info.prototype.property = "";
Info.prototype.spaceSeparated = false;
Info.prototype.space = void 0;
//#endregion
//#region ../../node_modules/property-information/lib/util/types.js
var types_exports = /* @__PURE__ */ __exportAll({
	boolean: () => boolean,
	booleanish: () => booleanish,
	commaOrSpaceSeparated: () => commaOrSpaceSeparated,
	commaSeparated: () => commaSeparated,
	number: () => number,
	overloadedBoolean: () => overloadedBoolean,
	spaceSeparated: () => spaceSeparated
});
var powers = 0;
var boolean = increment();
var booleanish = increment();
var overloadedBoolean = increment();
var number = increment();
var spaceSeparated = increment();
var commaSeparated = increment();
var commaOrSpaceSeparated = increment();
function increment() {
	return 2 ** ++powers;
}
//#endregion
//#region ../../node_modules/property-information/lib/util/defined-info.js
/**
* @import {Space} from 'property-information'
*/
var checks = Object.keys(types_exports);
var DefinedInfo = class extends Info {
	/**
	* @constructor
	* @param {string} property
	*   Property.
	* @param {string} attribute
	*   Attribute.
	* @param {number | null | undefined} [mask]
	*   Mask.
	* @param {Space | undefined} [space]
	*   Space.
	* @returns
	*   Info.
	*/
	constructor(property, attribute, mask, space) {
		let index = -1;
		super(property, attribute);
		mark(this, "space", space);
		if (typeof mask === "number") while (++index < checks.length) {
			const check = checks[index];
			mark(this, checks[index], (mask & types_exports[check]) === types_exports[check]);
		}
	}
};
DefinedInfo.prototype.defined = true;
/**
* @template {keyof DefinedInfo} Key
*   Key type.
* @param {DefinedInfo} values
*   Info.
* @param {Key} key
*   Key.
* @param {DefinedInfo[Key]} value
*   Value.
* @returns {undefined}
*   Nothing.
*/
function mark(values, key, value) {
	if (value) values[key] = value;
}
//#endregion
//#region ../../node_modules/property-information/lib/util/create.js
/**
* @import {Info, Space} from 'property-information'
*/
/**
* @typedef Definition
*   Definition of a schema.
* @property {Record<string, string> | undefined} [attributes]
*   Normalzed names to special attribute case.
* @property {ReadonlyArray<string> | undefined} [mustUseProperty]
*   Normalized names that must be set as properties.
* @property {Record<string, number | null>} properties
*   Property names to their types.
* @property {Space | undefined} [space]
*   Space.
* @property {Transform} transform
*   Transform a property name.
*/
/**
* @callback Transform
*   Transform.
* @param {Record<string, string>} attributes
*   Attributes.
* @param {string} property
*   Property.
* @returns {string}
*   Attribute.
*/
/**
* @param {Definition} definition
*   Definition.
* @returns {Schema}
*   Schema.
*/
function create(definition) {
	/** @type {Record<string, Info>} */
	const properties = {};
	/** @type {Record<string, string>} */
	const normals = {};
	for (const [property, value] of Object.entries(definition.properties)) {
		const info = new DefinedInfo(property, definition.transform(definition.attributes || {}, property), value, definition.space);
		if (definition.mustUseProperty && definition.mustUseProperty.includes(property)) info.mustUseProperty = true;
		properties[property] = info;
		normals[normalize$1(property)] = property;
		normals[normalize$1(info.attribute)] = property;
	}
	return new Schema(properties, normals, definition.space);
}
//#endregion
//#region ../../node_modules/property-information/lib/aria.js
var aria = create({
	properties: {
		ariaActiveDescendant: null,
		ariaAtomic: booleanish,
		ariaAutoComplete: null,
		ariaBusy: booleanish,
		ariaChecked: booleanish,
		ariaColCount: number,
		ariaColIndex: number,
		ariaColSpan: number,
		ariaControls: spaceSeparated,
		ariaCurrent: null,
		ariaDescribedBy: spaceSeparated,
		ariaDetails: null,
		ariaDisabled: booleanish,
		ariaDropEffect: spaceSeparated,
		ariaErrorMessage: null,
		ariaExpanded: booleanish,
		ariaFlowTo: spaceSeparated,
		ariaGrabbed: booleanish,
		ariaHasPopup: null,
		ariaHidden: booleanish,
		ariaInvalid: null,
		ariaKeyShortcuts: null,
		ariaLabel: null,
		ariaLabelledBy: spaceSeparated,
		ariaLevel: number,
		ariaLive: null,
		ariaModal: booleanish,
		ariaMultiLine: booleanish,
		ariaMultiSelectable: booleanish,
		ariaOrientation: null,
		ariaOwns: spaceSeparated,
		ariaPlaceholder: null,
		ariaPosInSet: number,
		ariaPressed: booleanish,
		ariaReadOnly: booleanish,
		ariaRelevant: null,
		ariaRequired: booleanish,
		ariaRoleDescription: spaceSeparated,
		ariaRowCount: number,
		ariaRowIndex: number,
		ariaRowSpan: number,
		ariaSelected: booleanish,
		ariaSetSize: number,
		ariaSort: null,
		ariaValueMax: number,
		ariaValueMin: number,
		ariaValueNow: number,
		ariaValueText: null,
		role: null
	},
	transform(_, property) {
		return property === "role" ? property : "aria-" + property.slice(4).toLowerCase();
	}
});
//#endregion
//#region ../../node_modules/property-information/lib/util/case-sensitive-transform.js
/**
* @param {Record<string, string>} attributes
*   Attributes.
* @param {string} attribute
*   Attribute.
* @returns {string}
*   Transformed attribute.
*/
function caseSensitiveTransform(attributes, attribute) {
	return attribute in attributes ? attributes[attribute] : attribute;
}
//#endregion
//#region ../../node_modules/property-information/lib/util/case-insensitive-transform.js
/**
* @param {Record<string, string>} attributes
*   Attributes.
* @param {string} property
*   Property.
* @returns {string}
*   Transformed property.
*/
function caseInsensitiveTransform(attributes, property) {
	return caseSensitiveTransform(attributes, property.toLowerCase());
}
//#endregion
//#region ../../node_modules/property-information/lib/html.js
var html$3 = create({
	attributes: {
		acceptcharset: "accept-charset",
		classname: "class",
		htmlfor: "for",
		httpequiv: "http-equiv"
	},
	mustUseProperty: [
		"checked",
		"multiple",
		"muted",
		"selected"
	],
	properties: {
		abbr: null,
		accept: commaSeparated,
		acceptCharset: spaceSeparated,
		accessKey: spaceSeparated,
		action: null,
		allow: null,
		allowFullScreen: boolean,
		allowPaymentRequest: boolean,
		allowUserMedia: boolean,
		alpha: boolean,
		alt: null,
		as: null,
		async: boolean,
		autoCapitalize: null,
		autoComplete: spaceSeparated,
		autoFocus: boolean,
		autoPlay: boolean,
		blocking: spaceSeparated,
		capture: null,
		charSet: null,
		checked: boolean,
		cite: null,
		className: spaceSeparated,
		closedBy: null,
		colorSpace: null,
		cols: number,
		colSpan: number,
		command: null,
		commandFor: null,
		content: null,
		contentEditable: booleanish,
		controls: boolean,
		controlsList: spaceSeparated,
		coords: number | commaSeparated,
		crossOrigin: null,
		data: null,
		dateTime: null,
		decoding: null,
		default: boolean,
		defer: boolean,
		dir: null,
		dirName: null,
		disabled: boolean,
		download: overloadedBoolean,
		draggable: booleanish,
		encType: null,
		enterKeyHint: null,
		fetchPriority: null,
		form: null,
		formAction: null,
		formEncType: null,
		formMethod: null,
		formNoValidate: boolean,
		formTarget: null,
		headers: spaceSeparated,
		height: number,
		hidden: overloadedBoolean,
		high: number,
		href: null,
		hrefLang: null,
		htmlFor: spaceSeparated,
		httpEquiv: spaceSeparated,
		id: null,
		imageSizes: null,
		imageSrcSet: null,
		inert: boolean,
		inputMode: null,
		integrity: null,
		is: null,
		isMap: boolean,
		itemId: null,
		itemProp: spaceSeparated,
		itemRef: spaceSeparated,
		itemScope: boolean,
		itemType: spaceSeparated,
		kind: null,
		label: null,
		lang: null,
		language: null,
		list: null,
		loading: null,
		loop: boolean,
		low: number,
		manifest: null,
		max: null,
		maxLength: number,
		media: null,
		method: null,
		min: null,
		minLength: number,
		multiple: boolean,
		muted: boolean,
		name: null,
		nonce: null,
		noModule: boolean,
		noValidate: boolean,
		onAbort: null,
		onAfterPrint: null,
		onAuxClick: null,
		onBeforeMatch: null,
		onBeforePrint: null,
		onBeforeToggle: null,
		onBeforeUnload: null,
		onBlur: null,
		onCancel: null,
		onCanPlay: null,
		onCanPlayThrough: null,
		onChange: null,
		onClick: null,
		onClose: null,
		onContextLost: null,
		onContextMenu: null,
		onContextRestored: null,
		onCopy: null,
		onCueChange: null,
		onCut: null,
		onDblClick: null,
		onDrag: null,
		onDragEnd: null,
		onDragEnter: null,
		onDragExit: null,
		onDragLeave: null,
		onDragOver: null,
		onDragStart: null,
		onDrop: null,
		onDurationChange: null,
		onEmptied: null,
		onEnded: null,
		onError: null,
		onFocus: null,
		onFormData: null,
		onHashChange: null,
		onInput: null,
		onInvalid: null,
		onKeyDown: null,
		onKeyPress: null,
		onKeyUp: null,
		onLanguageChange: null,
		onLoad: null,
		onLoadedData: null,
		onLoadedMetadata: null,
		onLoadEnd: null,
		onLoadStart: null,
		onMessage: null,
		onMessageError: null,
		onMouseDown: null,
		onMouseEnter: null,
		onMouseLeave: null,
		onMouseMove: null,
		onMouseOut: null,
		onMouseOver: null,
		onMouseUp: null,
		onOffline: null,
		onOnline: null,
		onPageHide: null,
		onPageShow: null,
		onPaste: null,
		onPause: null,
		onPlay: null,
		onPlaying: null,
		onPopState: null,
		onProgress: null,
		onRateChange: null,
		onRejectionHandled: null,
		onReset: null,
		onResize: null,
		onScroll: null,
		onScrollEnd: null,
		onSecurityPolicyViolation: null,
		onSeeked: null,
		onSeeking: null,
		onSelect: null,
		onSlotChange: null,
		onStalled: null,
		onStorage: null,
		onSubmit: null,
		onSuspend: null,
		onTimeUpdate: null,
		onToggle: null,
		onUnhandledRejection: null,
		onUnload: null,
		onVolumeChange: null,
		onWaiting: null,
		onWheel: null,
		open: boolean,
		optimum: number,
		pattern: null,
		ping: spaceSeparated,
		placeholder: null,
		playsInline: boolean,
		popover: null,
		popoverTarget: null,
		popoverTargetAction: null,
		poster: null,
		preload: null,
		readOnly: boolean,
		referrerPolicy: null,
		rel: spaceSeparated,
		required: boolean,
		reversed: boolean,
		rows: number,
		rowSpan: number,
		sandbox: spaceSeparated,
		scope: null,
		scoped: boolean,
		seamless: boolean,
		selected: boolean,
		shadowRootClonable: boolean,
		shadowRootCustomElementRegistry: boolean,
		shadowRootDelegatesFocus: boolean,
		shadowRootMode: null,
		shadowRootSerializable: boolean,
		shape: null,
		size: number,
		sizes: null,
		slot: null,
		span: number,
		spellCheck: booleanish,
		src: null,
		srcDoc: null,
		srcLang: null,
		srcSet: null,
		start: number,
		step: null,
		style: null,
		tabIndex: number,
		target: null,
		title: null,
		translate: null,
		type: null,
		typeMustMatch: boolean,
		useMap: null,
		value: booleanish,
		width: number,
		wrap: null,
		writingSuggestions: null,
		align: null,
		aLink: null,
		archive: spaceSeparated,
		axis: null,
		background: null,
		bgColor: null,
		border: number,
		borderColor: null,
		bottomMargin: number,
		cellPadding: null,
		cellSpacing: null,
		char: null,
		charOff: null,
		classId: null,
		clear: null,
		code: null,
		codeBase: null,
		codeType: null,
		color: null,
		compact: boolean,
		declare: boolean,
		event: null,
		face: null,
		frame: null,
		frameBorder: null,
		hSpace: number,
		leftMargin: number,
		link: null,
		longDesc: null,
		lowSrc: null,
		marginHeight: number,
		marginWidth: number,
		noResize: boolean,
		noHref: boolean,
		noShade: boolean,
		noWrap: boolean,
		object: null,
		profile: null,
		prompt: null,
		rev: null,
		rightMargin: number,
		rules: null,
		scheme: null,
		scrolling: booleanish,
		standby: null,
		summary: null,
		text: null,
		topMargin: number,
		valueType: null,
		version: null,
		vAlign: null,
		vLink: null,
		vSpace: number,
		allowTransparency: null,
		autoCorrect: null,
		autoSave: null,
		credentialless: boolean,
		disablePictureInPicture: boolean,
		disableRemotePlayback: boolean,
		exportParts: commaSeparated,
		part: spaceSeparated,
		prefix: null,
		property: null,
		results: number,
		security: null,
		unselectable: null
	},
	space: "html",
	transform: caseInsensitiveTransform
});
//#endregion
//#region ../../node_modules/property-information/lib/svg.js
var svg$1 = create({
	attributes: {
		accentHeight: "accent-height",
		alignmentBaseline: "alignment-baseline",
		arabicForm: "arabic-form",
		baselineShift: "baseline-shift",
		capHeight: "cap-height",
		className: "class",
		clipPath: "clip-path",
		clipRule: "clip-rule",
		colorInterpolation: "color-interpolation",
		colorInterpolationFilters: "color-interpolation-filters",
		colorProfile: "color-profile",
		colorRendering: "color-rendering",
		crossOrigin: "crossorigin",
		dataType: "datatype",
		dominantBaseline: "dominant-baseline",
		enableBackground: "enable-background",
		fillOpacity: "fill-opacity",
		fillRule: "fill-rule",
		floodColor: "flood-color",
		floodOpacity: "flood-opacity",
		fontFamily: "font-family",
		fontSize: "font-size",
		fontSizeAdjust: "font-size-adjust",
		fontStretch: "font-stretch",
		fontStyle: "font-style",
		fontVariant: "font-variant",
		fontWeight: "font-weight",
		glyphName: "glyph-name",
		glyphOrientationHorizontal: "glyph-orientation-horizontal",
		glyphOrientationVertical: "glyph-orientation-vertical",
		hrefLang: "hreflang",
		horizAdvX: "horiz-adv-x",
		horizOriginX: "horiz-origin-x",
		horizOriginY: "horiz-origin-y",
		imageRendering: "image-rendering",
		letterSpacing: "letter-spacing",
		lightingColor: "lighting-color",
		markerEnd: "marker-end",
		markerMid: "marker-mid",
		markerStart: "marker-start",
		maskType: "mask-type",
		navDown: "nav-down",
		navDownLeft: "nav-down-left",
		navDownRight: "nav-down-right",
		navLeft: "nav-left",
		navNext: "nav-next",
		navPrev: "nav-prev",
		navRight: "nav-right",
		navUp: "nav-up",
		navUpLeft: "nav-up-left",
		navUpRight: "nav-up-right",
		onAbort: "onabort",
		onActivate: "onactivate",
		onAfterPrint: "onafterprint",
		onBeforePrint: "onbeforeprint",
		onBegin: "onbegin",
		onCancel: "oncancel",
		onCanPlay: "oncanplay",
		onCanPlayThrough: "oncanplaythrough",
		onChange: "onchange",
		onClick: "onclick",
		onClose: "onclose",
		onCopy: "oncopy",
		onCueChange: "oncuechange",
		onCut: "oncut",
		onDblClick: "ondblclick",
		onDrag: "ondrag",
		onDragEnd: "ondragend",
		onDragEnter: "ondragenter",
		onDragExit: "ondragexit",
		onDragLeave: "ondragleave",
		onDragOver: "ondragover",
		onDragStart: "ondragstart",
		onDrop: "ondrop",
		onDurationChange: "ondurationchange",
		onEmptied: "onemptied",
		onEnd: "onend",
		onEnded: "onended",
		onError: "onerror",
		onFocus: "onfocus",
		onFocusIn: "onfocusin",
		onFocusOut: "onfocusout",
		onHashChange: "onhashchange",
		onInput: "oninput",
		onInvalid: "oninvalid",
		onKeyDown: "onkeydown",
		onKeyPress: "onkeypress",
		onKeyUp: "onkeyup",
		onLoad: "onload",
		onLoadedData: "onloadeddata",
		onLoadedMetadata: "onloadedmetadata",
		onLoadStart: "onloadstart",
		onMessage: "onmessage",
		onMouseDown: "onmousedown",
		onMouseEnter: "onmouseenter",
		onMouseLeave: "onmouseleave",
		onMouseMove: "onmousemove",
		onMouseOut: "onmouseout",
		onMouseOver: "onmouseover",
		onMouseUp: "onmouseup",
		onMouseWheel: "onmousewheel",
		onOffline: "onoffline",
		onOnline: "ononline",
		onPageHide: "onpagehide",
		onPageShow: "onpageshow",
		onPaste: "onpaste",
		onPause: "onpause",
		onPlay: "onplay",
		onPlaying: "onplaying",
		onPopState: "onpopstate",
		onProgress: "onprogress",
		onRateChange: "onratechange",
		onRepeat: "onrepeat",
		onReset: "onreset",
		onResize: "onresize",
		onScroll: "onscroll",
		onSeeked: "onseeked",
		onSeeking: "onseeking",
		onSelect: "onselect",
		onShow: "onshow",
		onStalled: "onstalled",
		onStorage: "onstorage",
		onSubmit: "onsubmit",
		onSuspend: "onsuspend",
		onTimeUpdate: "ontimeupdate",
		onToggle: "ontoggle",
		onUnload: "onunload",
		onVolumeChange: "onvolumechange",
		onWaiting: "onwaiting",
		onZoom: "onzoom",
		overlinePosition: "overline-position",
		overlineThickness: "overline-thickness",
		paintOrder: "paint-order",
		panose1: "panose-1",
		pointerEvents: "pointer-events",
		referrerPolicy: "referrerpolicy",
		renderingIntent: "rendering-intent",
		shapeRendering: "shape-rendering",
		stopColor: "stop-color",
		stopOpacity: "stop-opacity",
		strikethroughPosition: "strikethrough-position",
		strikethroughThickness: "strikethrough-thickness",
		strokeDashArray: "stroke-dasharray",
		strokeDashOffset: "stroke-dashoffset",
		strokeLineCap: "stroke-linecap",
		strokeLineJoin: "stroke-linejoin",
		strokeMiterLimit: "stroke-miterlimit",
		strokeOpacity: "stroke-opacity",
		strokeWidth: "stroke-width",
		tabIndex: "tabindex",
		textAnchor: "text-anchor",
		textDecoration: "text-decoration",
		textRendering: "text-rendering",
		transformOrigin: "transform-origin",
		typeOf: "typeof",
		underlinePosition: "underline-position",
		underlineThickness: "underline-thickness",
		unicodeBidi: "unicode-bidi",
		unicodeRange: "unicode-range",
		unitsPerEm: "units-per-em",
		vAlphabetic: "v-alphabetic",
		vHanging: "v-hanging",
		vIdeographic: "v-ideographic",
		vMathematical: "v-mathematical",
		vectorEffect: "vector-effect",
		vertAdvY: "vert-adv-y",
		vertOriginX: "vert-origin-x",
		vertOriginY: "vert-origin-y",
		wordSpacing: "word-spacing",
		writingMode: "writing-mode",
		xHeight: "x-height",
		playbackOrder: "playbackorder",
		timelineBegin: "timelinebegin"
	},
	properties: {
		about: commaOrSpaceSeparated,
		accentHeight: number,
		accumulate: null,
		additive: null,
		alignmentBaseline: null,
		alphabetic: number,
		amplitude: number,
		arabicForm: null,
		ascent: number,
		attributeName: null,
		attributeType: null,
		azimuth: number,
		bandwidth: null,
		baselineShift: null,
		baseFrequency: null,
		baseProfile: null,
		bbox: null,
		begin: null,
		bias: number,
		by: null,
		calcMode: null,
		capHeight: number,
		className: spaceSeparated,
		clip: null,
		clipPath: null,
		clipPathUnits: null,
		clipRule: null,
		color: null,
		colorInterpolation: null,
		colorInterpolationFilters: null,
		colorProfile: null,
		colorRendering: null,
		content: null,
		contentScriptType: null,
		contentStyleType: null,
		crossOrigin: null,
		cursor: null,
		cx: null,
		cy: null,
		d: null,
		dataType: null,
		defaultAction: null,
		descent: number,
		diffuseConstant: number,
		direction: null,
		display: null,
		dur: null,
		divisor: number,
		dominantBaseline: null,
		download: boolean,
		dx: null,
		dy: null,
		edgeMode: null,
		editable: null,
		elevation: number,
		enableBackground: null,
		end: null,
		event: null,
		exponent: number,
		externalResourcesRequired: null,
		fill: null,
		fillOpacity: number,
		fillRule: null,
		filter: null,
		filterRes: null,
		filterUnits: null,
		floodColor: null,
		floodOpacity: null,
		focusable: null,
		focusHighlight: null,
		fontFamily: null,
		fontSize: null,
		fontSizeAdjust: null,
		fontStretch: null,
		fontStyle: null,
		fontVariant: null,
		fontWeight: null,
		format: null,
		fr: null,
		from: null,
		fx: null,
		fy: null,
		g1: commaSeparated,
		g2: commaSeparated,
		glyphName: commaSeparated,
		glyphOrientationHorizontal: null,
		glyphOrientationVertical: null,
		glyphRef: null,
		gradientTransform: null,
		gradientUnits: null,
		handler: null,
		hanging: number,
		hatchContentUnits: null,
		hatchUnits: null,
		height: null,
		href: null,
		hrefLang: null,
		horizAdvX: number,
		horizOriginX: number,
		horizOriginY: number,
		id: null,
		ideographic: number,
		imageRendering: null,
		initialVisibility: null,
		in: null,
		in2: null,
		intercept: number,
		k: number,
		k1: number,
		k2: number,
		k3: number,
		k4: number,
		kernelMatrix: commaOrSpaceSeparated,
		kernelUnitLength: null,
		keyPoints: null,
		keySplines: null,
		keyTimes: null,
		kerning: null,
		lang: null,
		lengthAdjust: null,
		letterSpacing: null,
		lightingColor: null,
		limitingConeAngle: number,
		local: null,
		markerEnd: null,
		markerMid: null,
		markerStart: null,
		markerHeight: null,
		markerUnits: null,
		markerWidth: null,
		mask: null,
		maskContentUnits: null,
		maskType: null,
		maskUnits: null,
		mathematical: null,
		max: null,
		media: null,
		mediaCharacterEncoding: null,
		mediaContentEncodings: null,
		mediaSize: number,
		mediaTime: null,
		method: null,
		min: null,
		mode: null,
		name: null,
		navDown: null,
		navDownLeft: null,
		navDownRight: null,
		navLeft: null,
		navNext: null,
		navPrev: null,
		navRight: null,
		navUp: null,
		navUpLeft: null,
		navUpRight: null,
		numOctaves: null,
		observer: null,
		offset: null,
		onAbort: null,
		onActivate: null,
		onAfterPrint: null,
		onBeforePrint: null,
		onBegin: null,
		onCancel: null,
		onCanPlay: null,
		onCanPlayThrough: null,
		onChange: null,
		onClick: null,
		onClose: null,
		onCopy: null,
		onCueChange: null,
		onCut: null,
		onDblClick: null,
		onDrag: null,
		onDragEnd: null,
		onDragEnter: null,
		onDragExit: null,
		onDragLeave: null,
		onDragOver: null,
		onDragStart: null,
		onDrop: null,
		onDurationChange: null,
		onEmptied: null,
		onEnd: null,
		onEnded: null,
		onError: null,
		onFocus: null,
		onFocusIn: null,
		onFocusOut: null,
		onHashChange: null,
		onInput: null,
		onInvalid: null,
		onKeyDown: null,
		onKeyPress: null,
		onKeyUp: null,
		onLoad: null,
		onLoadedData: null,
		onLoadedMetadata: null,
		onLoadStart: null,
		onMessage: null,
		onMouseDown: null,
		onMouseEnter: null,
		onMouseLeave: null,
		onMouseMove: null,
		onMouseOut: null,
		onMouseOver: null,
		onMouseUp: null,
		onMouseWheel: null,
		onOffline: null,
		onOnline: null,
		onPageHide: null,
		onPageShow: null,
		onPaste: null,
		onPause: null,
		onPlay: null,
		onPlaying: null,
		onPopState: null,
		onProgress: null,
		onRateChange: null,
		onRepeat: null,
		onReset: null,
		onResize: null,
		onScroll: null,
		onSeeked: null,
		onSeeking: null,
		onSelect: null,
		onShow: null,
		onStalled: null,
		onStorage: null,
		onSubmit: null,
		onSuspend: null,
		onTimeUpdate: null,
		onToggle: null,
		onUnload: null,
		onVolumeChange: null,
		onWaiting: null,
		onZoom: null,
		opacity: null,
		operator: null,
		order: null,
		orient: null,
		orientation: null,
		origin: null,
		overflow: null,
		overlay: null,
		overlinePosition: number,
		overlineThickness: number,
		paintOrder: null,
		panose1: null,
		path: null,
		pathLength: number,
		patternContentUnits: null,
		patternTransform: null,
		patternUnits: null,
		phase: null,
		ping: spaceSeparated,
		pitch: null,
		playbackOrder: null,
		pointerEvents: null,
		points: null,
		pointsAtX: number,
		pointsAtY: number,
		pointsAtZ: number,
		preserveAlpha: null,
		preserveAspectRatio: null,
		primitiveUnits: null,
		propagate: null,
		property: commaOrSpaceSeparated,
		r: null,
		radius: null,
		referrerPolicy: null,
		refX: null,
		refY: null,
		rel: commaOrSpaceSeparated,
		rev: commaOrSpaceSeparated,
		renderingIntent: null,
		repeatCount: null,
		repeatDur: null,
		requiredExtensions: commaOrSpaceSeparated,
		requiredFeatures: commaOrSpaceSeparated,
		requiredFonts: commaOrSpaceSeparated,
		requiredFormats: commaOrSpaceSeparated,
		resource: null,
		restart: null,
		result: null,
		rotate: null,
		rx: null,
		ry: null,
		scale: null,
		seed: null,
		shapeRendering: null,
		side: null,
		slope: null,
		snapshotTime: null,
		specularConstant: number,
		specularExponent: number,
		spreadMethod: null,
		spacing: null,
		startOffset: null,
		stdDeviation: null,
		stemh: null,
		stemv: null,
		stitchTiles: null,
		stopColor: null,
		stopOpacity: null,
		strikethroughPosition: number,
		strikethroughThickness: number,
		string: null,
		stroke: null,
		strokeDashArray: commaOrSpaceSeparated,
		strokeDashOffset: null,
		strokeLineCap: null,
		strokeLineJoin: null,
		strokeMiterLimit: number,
		strokeOpacity: number,
		strokeWidth: null,
		style: null,
		surfaceScale: number,
		syncBehavior: null,
		syncBehaviorDefault: null,
		syncMaster: null,
		syncTolerance: null,
		syncToleranceDefault: null,
		systemLanguage: commaOrSpaceSeparated,
		tabIndex: number,
		tableValues: null,
		target: null,
		targetX: number,
		targetY: number,
		textAnchor: null,
		textDecoration: null,
		textRendering: null,
		textLength: null,
		timelineBegin: null,
		title: null,
		transformBehavior: null,
		type: null,
		typeOf: commaOrSpaceSeparated,
		to: null,
		transform: null,
		transformOrigin: null,
		u1: null,
		u2: null,
		underlinePosition: number,
		underlineThickness: number,
		unicode: null,
		unicodeBidi: null,
		unicodeRange: null,
		unitsPerEm: number,
		values: null,
		vAlphabetic: number,
		vMathematical: number,
		vectorEffect: null,
		vHanging: number,
		vIdeographic: number,
		version: null,
		vertAdvY: number,
		vertOriginX: number,
		vertOriginY: number,
		viewBox: null,
		viewTarget: null,
		visibility: null,
		width: null,
		widths: null,
		wordSpacing: null,
		writingMode: null,
		x: null,
		x1: null,
		x2: null,
		xChannelSelector: null,
		xHeight: number,
		y: null,
		y1: null,
		y2: null,
		yChannelSelector: null,
		z: null,
		zoomAndPan: null
	},
	space: "svg",
	transform: caseSensitiveTransform
});
//#endregion
//#region ../../node_modules/property-information/lib/xlink.js
var xlink = create({
	properties: {
		xLinkActuate: null,
		xLinkArcRole: null,
		xLinkHref: null,
		xLinkRole: null,
		xLinkShow: null,
		xLinkTitle: null,
		xLinkType: null
	},
	space: "xlink",
	transform(_, property) {
		return "xlink:" + property.slice(5).toLowerCase();
	}
});
//#endregion
//#region ../../node_modules/property-information/lib/xmlns.js
var xmlns = create({
	attributes: { xmlnsxlink: "xmlns:xlink" },
	properties: {
		xmlnsXLink: null,
		xmlns: null
	},
	space: "xmlns",
	transform: caseInsensitiveTransform
});
//#endregion
//#region ../../node_modules/property-information/lib/xml.js
var xml = create({
	properties: {
		xmlBase: null,
		xmlLang: null,
		xmlSpace: null
	},
	space: "xml",
	transform(_, property) {
		return "xml:" + property.slice(3).toLowerCase();
	}
});
//#endregion
//#region ../../node_modules/property-information/lib/hast-to-react.js
/**
* Special cases for React (`Record<string, string>`).
*
* `hast` is close to `React` but differs in a couple of cases.
* To get a React property from a hast property,
* check if it is in `hastToReact`.
* If it is, use the corresponding value;
* otherwise, use the hast property.
*
* @type {Record<string, string>}
*/
var hastToReact = {
	classId: "classID",
	dataType: "datatype",
	itemId: "itemID",
	strokeDashArray: "strokeDasharray",
	strokeDashOffset: "strokeDashoffset",
	strokeLineCap: "strokeLinecap",
	strokeLineJoin: "strokeLinejoin",
	strokeMiterLimit: "strokeMiterlimit",
	typeOf: "typeof",
	xLinkActuate: "xlinkActuate",
	xLinkArcRole: "xlinkArcrole",
	xLinkHref: "xlinkHref",
	xLinkRole: "xlinkRole",
	xLinkShow: "xlinkShow",
	xLinkTitle: "xlinkTitle",
	xLinkType: "xlinkType",
	xmlnsXLink: "xmlnsXlink"
};
//#endregion
//#region ../../node_modules/property-information/lib/find.js
/**
* @import {Schema} from 'property-information'
*/
var cap$1 = /[A-Z]/g;
var dash = /-[a-z]/g;
var valid = /^data[-\w.:]+$/i;
/**
* Look up info on a property.
*
* In most cases the given `schema` contains info on the property.
* All standard,
* most legacy,
* and some non-standard properties are supported.
* For these cases,
* the returned `Info` has hints about the value of the property.
*
* `name` can also be a valid data attribute or property,
* in which case an `Info` object with the correctly cased `attribute` and
* `property` is returned.
*
* `name` can be an unknown attribute,
* in which case an `Info` object with `attribute` and `property` set to the
* given name is returned.
* It is not recommended to provide unsupported legacy or recently specced
* properties.
*
*
* @param {Schema} schema
*   Schema;
*   either the `html` or `svg` export.
* @param {string} value
*   An attribute-like or property-like name;
*   it will be passed through `normalize` to hopefully find the correct info.
* @returns {Info}
*   Info.
*/
function find(schema, value) {
	const normal = normalize$1(value);
	let property = value;
	let Type = Info;
	if (normal in schema.normal) return schema.property[schema.normal[normal]];
	if (normal.length > 4 && normal.slice(0, 4) === "data" && valid.test(value)) {
		if (value.charAt(4) === "-") {
			const rest = value.slice(5).replace(dash, camelcase);
			property = "data" + rest.charAt(0).toUpperCase() + rest.slice(1);
		} else {
			const rest = value.slice(4);
			if (!dash.test(rest)) {
				let dashes = rest.replace(cap$1, kebab);
				if (dashes.charAt(0) !== "-") dashes = "-" + dashes;
				value = "data" + dashes;
			}
		}
		Type = DefinedInfo;
	}
	return new Type(property, value);
}
/**
* @param {string} $0
*   Value.
* @returns {string}
*   Kebab.
*/
function kebab($0) {
	return "-" + $0.toLowerCase();
}
/**
* @param {string} $0
*   Value.
* @returns {string}
*   Camel.
*/
function camelcase($0) {
	return $0.charAt(1).toUpperCase();
}
//#endregion
//#region ../../node_modules/property-information/index.js
var html$2 = merge([
	aria,
	html$3,
	xlink,
	xmlns,
	xml
], "html");
var svg = merge([
	aria,
	svg$1,
	xlink,
	xmlns,
	xml
], "svg");
//#endregion
//#region ../../node_modules/space-separated-tokens/index.js
/**
* Serialize an array of strings as space separated-tokens.
*
* @param {Array<string|number>} values
*   List of tokens.
* @returns {string}
*   Space-separated tokens.
*/
function stringify(values) {
	return values.join(" ").trim();
}
//#endregion
//#region ../../node_modules/inline-style-parser/cjs/index.js
var require_cjs$2 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var COMMENT_REGEX = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g;
	var NEWLINE_REGEX = /\n/g;
	var WHITESPACE_REGEX = /^\s*/;
	var PROPERTY_REGEX = /^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/;
	var COLON_REGEX = /^:\s*/;
	var VALUE_REGEX = /^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/;
	var SEMICOLON_REGEX = /^[;\s]*/;
	var TRIM_REGEX = /^\s+|\s+$/g;
	var NEWLINE = "\n";
	var FORWARD_SLASH = "/";
	var ASTERISK = "*";
	var EMPTY_STRING = "";
	var TYPE_COMMENT = "comment";
	var TYPE_DECLARATION = "declaration";
	/**
	* @param {String} style
	* @param {Object} [options]
	* @return {Object[]}
	* @throws {TypeError}
	* @throws {Error}
	*/
	function index(style, options) {
		if (typeof style !== "string") throw new TypeError("First argument must be a string");
		if (!style) return [];
		options = options || {};
		/**
		* Positional.
		*/
		var lineno = 1;
		var column = 1;
		/**
		* Update lineno and column based on `str`.
		*
		* @param {String} str
		*/
		function updatePosition(str) {
			var lines = str.match(NEWLINE_REGEX);
			if (lines) lineno += lines.length;
			var i = str.lastIndexOf(NEWLINE);
			column = ~i ? str.length - i : column + str.length;
		}
		/**
		* Mark position and patch `node.position`.
		*
		* @return {Function}
		*/
		function position() {
			var start = {
				line: lineno,
				column
			};
			return function(node) {
				node.position = new Position(start);
				whitespace();
				return node;
			};
		}
		/**
		* Store position information for a node.
		*
		* @constructor
		* @property {Object} start
		* @property {Object} end
		* @property {undefined|String} source
		*/
		function Position(start) {
			this.start = start;
			this.end = {
				line: lineno,
				column
			};
			this.source = options.source;
		}
		/**
		* Non-enumerable source string.
		*/
		Position.prototype.content = style;
		/**
		* Error `msg`.
		*
		* @param {String} msg
		* @throws {Error}
		*/
		function error(msg) {
			var err = /* @__PURE__ */ new Error(options.source + ":" + lineno + ":" + column + ": " + msg);
			err.reason = msg;
			err.filename = options.source;
			err.line = lineno;
			err.column = column;
			err.source = style;
			if (options.silent);
			else throw err;
		}
		/**
		* Match `re` and return captures.
		*
		* @param {RegExp} re
		* @return {undefined|Array}
		*/
		function match(re) {
			var m = re.exec(style);
			if (!m) return;
			var str = m[0];
			updatePosition(str);
			style = style.slice(str.length);
			return m;
		}
		/**
		* Parse whitespace.
		*/
		function whitespace() {
			match(WHITESPACE_REGEX);
		}
		/**
		* Parse comments.
		*
		* @param {Object[]} [rules]
		* @return {Object[]}
		*/
		function comments(rules) {
			var c;
			rules = rules || [];
			while (c = comment()) if (c !== false) rules.push(c);
			return rules;
		}
		/**
		* Parse comment.
		*
		* @return {Object}
		* @throws {Error}
		*/
		function comment() {
			var pos = position();
			if (FORWARD_SLASH != style.charAt(0) || ASTERISK != style.charAt(1)) return;
			var i = 2;
			while (EMPTY_STRING != style.charAt(i) && (ASTERISK != style.charAt(i) || FORWARD_SLASH != style.charAt(i + 1))) ++i;
			i += 2;
			if (EMPTY_STRING === style.charAt(i - 1)) return error("End of comment missing");
			var str = style.slice(2, i - 2);
			column += 2;
			updatePosition(str);
			style = style.slice(i);
			column += 2;
			return pos({
				type: TYPE_COMMENT,
				comment: str
			});
		}
		/**
		* Parse declaration.
		*
		* @return {Object}
		* @throws {Error}
		*/
		function declaration() {
			var pos = position();
			var prop = match(PROPERTY_REGEX);
			if (!prop) return;
			comment();
			if (!match(COLON_REGEX)) return error("property missing ':'");
			var val = match(VALUE_REGEX);
			var ret = pos({
				type: TYPE_DECLARATION,
				property: trim(prop[0].replace(COMMENT_REGEX, EMPTY_STRING)),
				value: val ? trim(val[0].replace(COMMENT_REGEX, EMPTY_STRING)) : EMPTY_STRING
			});
			match(SEMICOLON_REGEX);
			return ret;
		}
		/**
		* Parse declarations.
		*
		* @return {Object[]}
		*/
		function declarations() {
			var decls = [];
			comments(decls);
			var decl;
			while (decl = declaration()) if (decl !== false) {
				decls.push(decl);
				comments(decls);
			}
			return decls;
		}
		whitespace();
		return declarations();
	}
	/**
	* Trim `str`.
	*
	* @param {String} str
	* @return {String}
	*/
	function trim(str) {
		return str ? str.replace(TRIM_REGEX, EMPTY_STRING) : EMPTY_STRING;
	}
	module.exports = index;
}));
//#endregion
//#region ../../node_modules/style-to-object/cjs/index.js
var require_cjs$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __importDefault = exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { "default": mod };
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.default = StyleToObject;
	var inline_style_parser_1 = __importDefault(require_cjs$2());
	/**
	* Parses inline style to object.
	*
	* @param style - Inline style.
	* @param iterator - Iterator.
	* @returns - Style object or null.
	*
	* @example Parsing inline style to object:
	*
	* ```js
	* import parse from 'style-to-object';
	* parse('line-height: 42;'); // { 'line-height': '42' }
	* ```
	*/
	function StyleToObject(style, iterator) {
		let styleObject = null;
		if (!style || typeof style !== "string") return styleObject;
		const declarations = (0, inline_style_parser_1.default)(style);
		const hasIterator = typeof iterator === "function";
		declarations.forEach((declaration) => {
			if (declaration.type !== "declaration") return;
			const { property, value } = declaration;
			if (hasIterator) iterator(property, value, declaration);
			else if (value) {
				styleObject = styleObject || {};
				styleObject[property] = value;
			}
		});
		return styleObject;
	}
}));
//#endregion
//#region ../../node_modules/style-to-js/cjs/utilities.js
var require_utilities = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.camelCase = void 0;
	var CUSTOM_PROPERTY_REGEX = /^--[a-zA-Z0-9_-]+$/;
	var HYPHEN_REGEX = /-([a-z])/g;
	var NO_HYPHEN_REGEX = /^[^-]+$/;
	var VENDOR_PREFIX_REGEX = /^-(webkit|moz|ms|o|khtml)-/;
	var MS_VENDOR_PREFIX_REGEX = /^-(ms)-/;
	/**
	* Checks whether to skip camelCase.
	*/
	var skipCamelCase = function(property) {
		return !property || NO_HYPHEN_REGEX.test(property) || CUSTOM_PROPERTY_REGEX.test(property);
	};
	/**
	* Replacer that capitalizes first character.
	*/
	var capitalize = function(match, character) {
		return character.toUpperCase();
	};
	/**
	* Replacer that removes beginning hyphen of vendor prefix property.
	*/
	var trimHyphen = function(match, prefix) {
		return "".concat(prefix, "-");
	};
	/**
	* CamelCases a CSS property.
	*/
	var camelCase = function(property, options) {
		if (options === void 0) options = {};
		if (skipCamelCase(property)) return property;
		property = property.toLowerCase();
		if (options.reactCompat) property = property.replace(MS_VENDOR_PREFIX_REGEX, trimHyphen);
		else property = property.replace(VENDOR_PREFIX_REGEX, trimHyphen);
		return property.replace(HYPHEN_REGEX, capitalize);
	};
	exports.camelCase = camelCase;
}));
//#endregion
//#region ../../node_modules/style-to-js/cjs/index.js
var require_cjs = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var style_to_object_1 = (exports && exports.__importDefault || function(mod) {
		return mod && mod.__esModule ? mod : { "default": mod };
	})(require_cjs$1());
	var utilities_1 = require_utilities();
	/**
	* Parses CSS inline style to JavaScript object (camelCased).
	*/
	function StyleToJS(style, options) {
		var output = {};
		if (!style || typeof style !== "string") return output;
		(0, style_to_object_1.default)(style, function(property, value) {
			if (property && value) output[(0, utilities_1.camelCase)(property, options)] = value;
		});
		return output;
	}
	StyleToJS.default = StyleToJS;
	module.exports = StyleToJS;
}));
//#endregion
//#region ../../node_modules/unist-util-position/lib/index.js
/**
* @typedef {import('unist').Node} Node
* @typedef {import('unist').Point} Point
* @typedef {import('unist').Position} Position
*/
/**
* @typedef NodeLike
* @property {string} type
* @property {PositionLike | null | undefined} [position]
*
* @typedef PositionLike
* @property {PointLike | null | undefined} [start]
* @property {PointLike | null | undefined} [end]
*
* @typedef PointLike
* @property {number | null | undefined} [line]
* @property {number | null | undefined} [column]
* @property {number | null | undefined} [offset]
*/
/**
* Get the ending point of `node`.
*
* @param node
*   Node.
* @returns
*   Point.
*/
var pointEnd = point$2("end");
/**
* Get the starting point of `node`.
*
* @param node
*   Node.
* @returns
*   Point.
*/
var pointStart = point$2("start");
/**
* Get the positional info of `node`.
*
* @param {'end' | 'start'} type
*   Side.
* @returns
*   Getter.
*/
function point$2(type) {
	return point;
	/**
	* Get the point info of `node` at a bound side.
	*
	* @param {Node | NodeLike | null | undefined} [node]
	* @returns {Point | undefined}
	*/
	function point(node) {
		const point = node && node.position && node.position[type] || {};
		if (typeof point.line === "number" && point.line > 0 && typeof point.column === "number" && point.column > 0) return {
			line: point.line,
			column: point.column,
			offset: typeof point.offset === "number" && point.offset > -1 ? point.offset : void 0
		};
	}
}
/**
* Get the positional info of `node`.
*
* @param {Node | NodeLike | null | undefined} [node]
*   Node.
* @returns {Position | undefined}
*   Position.
*/
function position$1(node) {
	const start = pointStart(node);
	const end = pointEnd(node);
	if (start && end) return {
		start,
		end
	};
}
//#endregion
//#region ../../node_modules/unist-util-stringify-position/lib/index.js
/**
* @typedef {import('unist').Node} Node
* @typedef {import('unist').Point} Point
* @typedef {import('unist').Position} Position
*/
/**
* @typedef NodeLike
* @property {string} type
* @property {PositionLike | null | undefined} [position]
*
* @typedef PointLike
* @property {number | null | undefined} [line]
* @property {number | null | undefined} [column]
* @property {number | null | undefined} [offset]
*
* @typedef PositionLike
* @property {PointLike | null | undefined} [start]
* @property {PointLike | null | undefined} [end]
*/
/**
* Serialize the positional info of a point, position (start and end points),
* or node.
*
* @param {Node | NodeLike | Point | PointLike | Position | PositionLike | null | undefined} [value]
*   Node, position, or point.
* @returns {string}
*   Pretty printed positional info of a node (`string`).
*
*   In the format of a range `ls:cs-le:ce` (when given `node` or `position`)
*   or a point `l:c` (when given `point`), where `l` stands for line, `c` for
*   column, `s` for `start`, and `e` for end.
*   An empty string (`''`) is returned if the given value is neither `node`,
*   `position`, nor `point`.
*/
function stringifyPosition(value) {
	if (!value || typeof value !== "object") return "";
	if ("position" in value || "type" in value) return position(value.position);
	if ("start" in value || "end" in value) return position(value);
	if ("line" in value || "column" in value) return point$1(value);
	return "";
}
/**
* @param {Point | PointLike | null | undefined} point
* @returns {string}
*/
function point$1(point) {
	return index(point && point.line) + ":" + index(point && point.column);
}
/**
* @param {Position | PositionLike | null | undefined} pos
* @returns {string}
*/
function position(pos) {
	return point$1(pos && pos.start) + "-" + point$1(pos && pos.end);
}
/**
* @param {number | null | undefined} value
* @returns {number}
*/
function index(value) {
	return value && typeof value === "number" ? value : 1;
}
//#endregion
//#region ../../node_modules/vfile-message/lib/index.js
/**
* @import {Node, Point, Position} from 'unist'
*/
/**
* @typedef {object & {type: string, position?: Position | undefined}} NodeLike
*
* @typedef Options
*   Configuration.
* @property {Array<Node> | null | undefined} [ancestors]
*   Stack of (inclusive) ancestor nodes surrounding the message (optional).
* @property {Error | null | undefined} [cause]
*   Original error cause of the message (optional).
* @property {Point | Position | null | undefined} [place]
*   Place of message (optional).
* @property {string | null | undefined} [ruleId]
*   Category of message (optional, example: `'my-rule'`).
* @property {string | null | undefined} [source]
*   Namespace of who sent the message (optional, example: `'my-package'`).
*/
/**
* Message.
*/
var VFileMessage = class extends Error {
	/**
	* Create a message for `reason`.
	*
	* > 🪦 **Note**: also has obsolete signatures.
	*
	* @overload
	* @param {string} reason
	* @param {Options | null | undefined} [options]
	* @returns
	*
	* @overload
	* @param {string} reason
	* @param {Node | NodeLike | null | undefined} parent
	* @param {string | null | undefined} [origin]
	* @returns
	*
	* @overload
	* @param {string} reason
	* @param {Point | Position | null | undefined} place
	* @param {string | null | undefined} [origin]
	* @returns
	*
	* @overload
	* @param {string} reason
	* @param {string | null | undefined} [origin]
	* @returns
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {Node | NodeLike | null | undefined} parent
	* @param {string | null | undefined} [origin]
	* @returns
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {Point | Position | null | undefined} place
	* @param {string | null | undefined} [origin]
	* @returns
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {string | null | undefined} [origin]
	* @returns
	*
	* @param {Error | VFileMessage | string} causeOrReason
	*   Reason for message, should use markdown.
	* @param {Node | NodeLike | Options | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
	*   Configuration (optional).
	* @param {string | null | undefined} [origin]
	*   Place in code where the message originates (example:
	*   `'my-package:my-rule'` or `'my-rule'`).
	* @returns
	*   Instance of `VFileMessage`.
	*/
	constructor(causeOrReason, optionsOrParentOrPlace, origin) {
		super();
		if (typeof optionsOrParentOrPlace === "string") {
			origin = optionsOrParentOrPlace;
			optionsOrParentOrPlace = void 0;
		}
		/** @type {string} */
		let reason = "";
		/** @type {Options} */
		let options = {};
		let legacyCause = false;
		if (optionsOrParentOrPlace) {
			if ("line" in optionsOrParentOrPlace && "column" in optionsOrParentOrPlace) options = { place: optionsOrParentOrPlace };
			else if ("start" in optionsOrParentOrPlace && "end" in optionsOrParentOrPlace) options = { place: optionsOrParentOrPlace };
			else if ("type" in optionsOrParentOrPlace) options = {
				ancestors: [optionsOrParentOrPlace],
				place: optionsOrParentOrPlace.position
			};
			else options = { ...optionsOrParentOrPlace };
		}
		if (typeof causeOrReason === "string") reason = causeOrReason;
		else if (!options.cause && causeOrReason) {
			legacyCause = true;
			reason = causeOrReason.message;
			options.cause = causeOrReason;
		}
		if (!options.ruleId && !options.source && typeof origin === "string") {
			const index = origin.indexOf(":");
			if (index === -1) options.ruleId = origin;
			else {
				options.source = origin.slice(0, index);
				options.ruleId = origin.slice(index + 1);
			}
		}
		if (!options.place && options.ancestors && options.ancestors) {
			const parent = options.ancestors[options.ancestors.length - 1];
			if (parent) options.place = parent.position;
		}
		const start = options.place && "start" in options.place ? options.place.start : options.place;
		/**
		* Stack of ancestor nodes surrounding the message.
		*
		* @type {Array<Node> | undefined}
		*/
		this.ancestors = options.ancestors || void 0;
		/**
		* Original error cause of the message.
		*
		* @type {Error | undefined}
		*/
		this.cause = options.cause || void 0;
		/**
		* Starting column of message.
		*
		* @type {number | undefined}
		*/
		this.column = start ? start.column : void 0;
		/**
		* State of problem.
		*
		* * `true` — error, file not usable
		* * `false` — warning, change may be needed
		* * `undefined` — change likely not needed
		*
		* @type {boolean | null | undefined}
		*/
		this.fatal = void 0;
		/**
		* Path of a file (used throughout the `VFile` ecosystem).
		*
		* @type {string | undefined}
		*/
		this.file = "";
		/**
		* Reason for message.
		*
		* @type {string}
		*/
		this.message = reason;
		/**
		* Starting line of error.
		*
		* @type {number | undefined}
		*/
		this.line = start ? start.line : void 0;
		/**
		* Serialized positional info of message.
		*
		* On normal errors, this would be something like `ParseError`, buit in
		* `VFile` messages we use this space to show where an error happened.
		*/
		this.name = stringifyPosition(options.place) || "1:1";
		/**
		* Place of message.
		*
		* @type {Point | Position | undefined}
		*/
		this.place = options.place || void 0;
		/**
		* Reason for message, should use markdown.
		*
		* @type {string}
		*/
		this.reason = this.message;
		/**
		* Category of message (example: `'my-rule'`).
		*
		* @type {string | undefined}
		*/
		this.ruleId = options.ruleId || void 0;
		/**
		* Namespace of message (example: `'my-package'`).
		*
		* @type {string | undefined}
		*/
		this.source = options.source || void 0;
		/**
		* Stack of message.
		*
		* This is used by normal errors to show where something happened in
		* programming code, irrelevant for `VFile` messages,
		*
		* @type {string}
		*/
		this.stack = legacyCause && options.cause && typeof options.cause.stack === "string" ? options.cause.stack : "";
		/**
		* Specify the source value that’s being reported, which is deemed
		* incorrect.
		*
		* @type {string | undefined}
		*/
		this.actual = void 0;
		/**
		* Suggest acceptable values that can be used instead of `actual`.
		*
		* @type {Array<string> | undefined}
		*/
		this.expected = void 0;
		/**
		* Long form description of the message (you should use markdown).
		*
		* @type {string | undefined}
		*/
		this.note = void 0;
		/**
		* Link to docs for the message.
		*
		* > 👉 **Note**: this must be an absolute URL that can be passed as `x`
		* > to `new URL(x)`.
		*
		* @type {string | undefined}
		*/
		this.url = void 0;
	}
};
VFileMessage.prototype.file = "";
VFileMessage.prototype.name = "";
VFileMessage.prototype.reason = "";
VFileMessage.prototype.message = "";
VFileMessage.prototype.stack = "";
VFileMessage.prototype.column = void 0;
VFileMessage.prototype.line = void 0;
VFileMessage.prototype.ancestors = void 0;
VFileMessage.prototype.cause = void 0;
VFileMessage.prototype.fatal = void 0;
VFileMessage.prototype.place = void 0;
VFileMessage.prototype.ruleId = void 0;
VFileMessage.prototype.source = void 0;
//#endregion
//#region ../../node_modules/hast-util-to-jsx-runtime/lib/index.js
/**
* @import {Identifier, Literal, MemberExpression} from 'estree'
* @import {Jsx, JsxDev, Options, Props} from 'hast-util-to-jsx-runtime'
* @import {Element, Nodes, Parents, Root, Text} from 'hast'
* @import {MdxFlowExpressionHast, MdxTextExpressionHast} from 'mdast-util-mdx-expression'
* @import {MdxJsxFlowElementHast, MdxJsxTextElementHast} from 'mdast-util-mdx-jsx'
* @import {MdxjsEsmHast} from 'mdast-util-mdxjs-esm'
* @import {Position} from 'unist'
* @import {Child, Create, Field, JsxElement, State, Style} from './types.js'
*/
var import_cjs = /* @__PURE__ */ __toESM(require_cjs(), 1);
var own$3 = {}.hasOwnProperty;
/** @type {Map<string, number>} */
var emptyMap = /* @__PURE__ */ new Map();
var cap = /[A-Z]/g;
var tableElements = /* @__PURE__ */ new Set([
	"table",
	"tbody",
	"thead",
	"tfoot",
	"tr"
]);
var tableCellElement = /* @__PURE__ */ new Set(["td", "th"]);
/**
* Transform a hast tree to preact, react, solid, svelte, vue, etc.,
* with an automatic JSX runtime.
*
* @param {Nodes} tree
*   Tree to transform.
* @param {Options} options
*   Configuration (required).
* @returns {JsxElement}
*   JSX element.
*/
function toJsxRuntime(tree, options) {
	if (!options || options.Fragment === void 0) throw new TypeError("Expected `Fragment` in options");
	const filePath = options.filePath || void 0;
	/** @type {Create} */
	let create;
	if (options.development) {
		if (typeof options.jsxDEV !== "function") throw new TypeError("Expected `jsxDEV` in options when `development: true`");
		create = developmentCreate(filePath, options.jsxDEV);
	} else {
		if (typeof options.jsx !== "function") throw new TypeError("Expected `jsx` in production options");
		if (typeof options.jsxs !== "function") throw new TypeError("Expected `jsxs` in production options");
		create = productionCreate(filePath, options.jsx, options.jsxs);
	}
	/** @type {State} */
	const state = {
		Fragment: options.Fragment,
		ancestors: [],
		components: options.components || {},
		create,
		elementAttributeNameCase: options.elementAttributeNameCase || "react",
		evaluater: options.createEvaluater ? options.createEvaluater() : void 0,
		filePath,
		ignoreInvalidStyle: options.ignoreInvalidStyle || false,
		passKeys: options.passKeys !== false,
		passNode: options.passNode || false,
		schema: options.space === "svg" ? svg : html$2,
		stylePropertyNameCase: options.stylePropertyNameCase || "dom",
		tableCellAlignToStyle: options.tableCellAlignToStyle !== false
	};
	const result = one$1(state, tree, void 0);
	if (result && typeof result !== "string") return result;
	return state.create(tree, state.Fragment, { children: result || void 0 }, void 0);
}
/**
* Transform a node.
*
* @param {State} state
*   Info passed around.
* @param {Nodes} node
*   Current node.
* @param {string | undefined} key
*   Key.
* @returns {Child | undefined}
*   Child, optional.
*/
function one$1(state, node, key) {
	if (node.type === "element") return element$1(state, node, key);
	if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") return mdxExpression(state, node);
	if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") return mdxJsxElement(state, node, key);
	if (node.type === "mdxjsEsm") return mdxEsm(state, node);
	if (node.type === "root") return root$2(state, node, key);
	if (node.type === "text") return text$5(state, node);
}
/**
* Handle element.
*
* @param {State} state
*   Info passed around.
* @param {Element} node
*   Current node.
* @param {string | undefined} key
*   Key.
* @returns {Child | undefined}
*   Child, optional.
*/
function element$1(state, node, key) {
	const parentSchema = state.schema;
	let schema = parentSchema;
	if (node.tagName.toLowerCase() === "svg" && parentSchema.space === "html") {
		schema = svg;
		state.schema = schema;
	}
	state.ancestors.push(node);
	const type = findComponentFromName(state, node.tagName, false);
	const props = createElementProps(state, node);
	let children = createChildren(state, node);
	if (tableElements.has(node.tagName)) children = children.filter(function(child) {
		return typeof child === "string" ? !whitespace(child) : true;
	});
	addNode(state, props, type, node);
	addChildren(props, children);
	state.ancestors.pop();
	state.schema = parentSchema;
	return state.create(node, type, props, key);
}
/**
* Handle MDX expression.
*
* @param {State} state
*   Info passed around.
* @param {MdxFlowExpressionHast | MdxTextExpressionHast} node
*   Current node.
* @returns {Child | undefined}
*   Child, optional.
*/
function mdxExpression(state, node) {
	if (node.data && node.data.estree && state.evaluater) {
		const expression = node.data.estree.body[0];
		expression.type;
		return state.evaluater.evaluateExpression(expression.expression);
	}
	crashEstree(state, node.position);
}
/**
* Handle MDX ESM.
*
* @param {State} state
*   Info passed around.
* @param {MdxjsEsmHast} node
*   Current node.
* @returns {Child | undefined}
*   Child, optional.
*/
function mdxEsm(state, node) {
	if (node.data && node.data.estree && state.evaluater) return state.evaluater.evaluateProgram(node.data.estree);
	crashEstree(state, node.position);
}
/**
* Handle MDX JSX.
*
* @param {State} state
*   Info passed around.
* @param {MdxJsxFlowElementHast | MdxJsxTextElementHast} node
*   Current node.
* @param {string | undefined} key
*   Key.
* @returns {Child | undefined}
*   Child, optional.
*/
function mdxJsxElement(state, node, key) {
	const parentSchema = state.schema;
	let schema = parentSchema;
	if (node.name === "svg" && parentSchema.space === "html") {
		schema = svg;
		state.schema = schema;
	}
	state.ancestors.push(node);
	const type = node.name === null ? state.Fragment : findComponentFromName(state, node.name, true);
	const props = createJsxElementProps(state, node);
	const children = createChildren(state, node);
	addNode(state, props, type, node);
	addChildren(props, children);
	state.ancestors.pop();
	state.schema = parentSchema;
	return state.create(node, type, props, key);
}
/**
* Handle root.
*
* @param {State} state
*   Info passed around.
* @param {Root} node
*   Current node.
* @param {string | undefined} key
*   Key.
* @returns {Child | undefined}
*   Child, optional.
*/
function root$2(state, node, key) {
	/** @type {Props} */
	const props = {};
	addChildren(props, createChildren(state, node));
	return state.create(node, state.Fragment, props, key);
}
/**
* Handle text.
*
* @param {State} _
*   Info passed around.
* @param {Text} node
*   Current node.
* @returns {Child | undefined}
*   Child, optional.
*/
function text$5(_, node) {
	return node.value;
}
/**
* Add `node` to props.
*
* @param {State} state
*   Info passed around.
* @param {Props} props
*   Props.
* @param {unknown} type
*   Type.
* @param {Element | MdxJsxFlowElementHast | MdxJsxTextElementHast} node
*   Node.
* @returns {undefined}
*   Nothing.
*/
function addNode(state, props, type, node) {
	if (typeof type !== "string" && type !== state.Fragment && state.passNode) props.node = node;
}
/**
* Add children to props.
*
* @param {Props} props
*   Props.
* @param {Array<Child>} children
*   Children.
* @returns {undefined}
*   Nothing.
*/
function addChildren(props, children) {
	if (children.length > 0) {
		const value = children.length > 1 ? children : children[0];
		if (value) props.children = value;
	}
}
/**
* @param {string | undefined} _
*   Path to file.
* @param {Jsx} jsx
*   Dynamic.
* @param {Jsx} jsxs
*   Static.
* @returns {Create}
*   Create a production element.
*/
function productionCreate(_, jsx, jsxs) {
	return create;
	/** @type {Create} */
	function create(_, type, props, key) {
		const fn = Array.isArray(props.children) ? jsxs : jsx;
		return key ? fn(type, props, key) : fn(type, props);
	}
}
/**
* @param {string | undefined} filePath
*   Path to file.
* @param {JsxDev} jsxDEV
*   Development.
* @returns {Create}
*   Create a development element.
*/
function developmentCreate(filePath, jsxDEV) {
	return create;
	/** @type {Create} */
	function create(node, type, props, key) {
		const isStaticChildren = Array.isArray(props.children);
		const point = pointStart(node);
		return jsxDEV(type, props, key, isStaticChildren, {
			columnNumber: point ? point.column - 1 : void 0,
			fileName: filePath,
			lineNumber: point ? point.line : void 0
		}, void 0);
	}
}
/**
* Create props from an element.
*
* @param {State} state
*   Info passed around.
* @param {Element} node
*   Current element.
* @returns {Props}
*   Props.
*/
function createElementProps(state, node) {
	/** @type {Props} */
	const props = {};
	/** @type {string | undefined} */
	let alignValue;
	/** @type {string} */
	let prop;
	for (prop in node.properties) if (prop !== "children" && own$3.call(node.properties, prop)) {
		const result = createProperty(state, prop, node.properties[prop]);
		if (result) {
			const [key, value] = result;
			if (state.tableCellAlignToStyle && key === "align" && typeof value === "string" && tableCellElement.has(node.tagName)) alignValue = value;
			else props[key] = value;
		}
	}
	if (alignValue) {
		const style = props.style || (props.style = {});
		style[state.stylePropertyNameCase === "css" ? "text-align" : "textAlign"] = alignValue;
	}
	return props;
}
/**
* Create props from a JSX element.
*
* @param {State} state
*   Info passed around.
* @param {MdxJsxFlowElementHast | MdxJsxTextElementHast} node
*   Current JSX element.
* @returns {Props}
*   Props.
*/
function createJsxElementProps(state, node) {
	/** @type {Props} */
	const props = {};
	for (const attribute of node.attributes) if (attribute.type === "mdxJsxExpressionAttribute") {
		if (attribute.data && attribute.data.estree && state.evaluater) {
			const expression = attribute.data.estree.body[0];
			expression.type;
			const objectExpression = expression.expression;
			objectExpression.type;
			const property = objectExpression.properties[0];
			property.type;
			Object.assign(props, state.evaluater.evaluateExpression(property.argument));
		} else crashEstree(state, node.position);
	} else {
		const name = attribute.name;
		/** @type {unknown} */
		let value;
		if (attribute.value && typeof attribute.value === "object") {
			if (attribute.value.data && attribute.value.data.estree && state.evaluater) {
				const expression = attribute.value.data.estree.body[0];
				expression.type;
				value = state.evaluater.evaluateExpression(expression.expression);
			} else crashEstree(state, node.position);
		} else value = attribute.value === null ? true : attribute.value;
		props[name] = value;
	}
	return props;
}
/**
* Create children.
*
* @param {State} state
*   Info passed around.
* @param {Parents} node
*   Current element.
* @returns {Array<Child>}
*   Children.
*/
function createChildren(state, node) {
	/** @type {Array<Child>} */
	const children = [];
	let index = -1;
	/** @type {Map<string, number>} */
	/* c8 ignore next */
	const countsByName = state.passKeys ? /* @__PURE__ */ new Map() : emptyMap;
	while (++index < node.children.length) {
		const child = node.children[index];
		/** @type {string | undefined} */
		let key;
		if (state.passKeys) {
			const name = child.type === "element" ? child.tagName : child.type === "mdxJsxFlowElement" || child.type === "mdxJsxTextElement" ? child.name : void 0;
			if (name) {
				const count = countsByName.get(name) || 0;
				key = name + "-" + count;
				countsByName.set(name, count + 1);
			}
		}
		const result = one$1(state, child, key);
		if (result !== void 0) children.push(result);
	}
	return children;
}
/**
* Handle a property.
*
* @param {State} state
*   Info passed around.
* @param {string} prop
*   Key.
* @param {Array<number | string> | boolean | number | string | null | undefined} value
*   hast property value.
* @returns {Field | undefined}
*   Field for runtime, optional.
*/
function createProperty(state, prop, value) {
	const info = find(state.schema, prop);
	if (value === null || value === void 0 || typeof value === "number" && Number.isNaN(value)) return;
	if (Array.isArray(value)) value = info.commaSeparated ? stringify$1(value) : stringify(value);
	if (info.property === "style") {
		let styleObject = typeof value === "object" ? value : parseStyle(state, String(value));
		if (state.stylePropertyNameCase === "css") styleObject = transformStylesToCssCasing(styleObject);
		return ["style", styleObject];
	}
	return [state.elementAttributeNameCase === "react" && info.space ? hastToReact[info.property] || info.property : info.attribute, value];
}
/**
* Parse a CSS declaration to an object.
*
* @param {State} state
*   Info passed around.
* @param {string} value
*   CSS declarations.
* @returns {Style}
*   Properties.
* @throws
*   Throws `VFileMessage` when CSS cannot be parsed.
*/
function parseStyle(state, value) {
	try {
		return (0, import_cjs.default)(value, { reactCompat: true });
	} catch (error) {
		if (state.ignoreInvalidStyle) return {};
		const cause = error;
		const message = new VFileMessage("Cannot parse `style` attribute", {
			ancestors: state.ancestors,
			cause,
			ruleId: "style",
			source: "hast-util-to-jsx-runtime"
		});
		message.file = state.filePath || void 0;
		message.url = "https://github.com/syntax-tree/hast-util-to-jsx-runtime#cannot-parse-style-attribute";
		throw message;
	}
}
/**
* Create a JSX name from a string.
*
* @param {State} state
*   To do.
* @param {string} name
*   Name.
* @param {boolean} allowExpression
*   Allow member expressions and identifiers.
* @returns {unknown}
*   To do.
*/
function findComponentFromName(state, name$1, allowExpression) {
	/** @type {Identifier | Literal | MemberExpression} */
	let result;
	if (!allowExpression) result = {
		type: "Literal",
		value: name$1
	};
	else if (name$1.includes(".")) {
		const identifiers = name$1.split(".");
		let index = -1;
		/** @type {Identifier | Literal | MemberExpression | undefined} */
		let node;
		while (++index < identifiers.length) {
			/** @type {Identifier | Literal} */
			const prop = name(identifiers[index]) ? {
				type: "Identifier",
				name: identifiers[index]
			} : {
				type: "Literal",
				value: identifiers[index]
			};
			node = node ? {
				type: "MemberExpression",
				object: node,
				property: prop,
				computed: Boolean(index && prop.type === "Literal"),
				optional: false
			} : prop;
		}
		result = node;
	} else result = name(name$1) && !/^[a-z]/.test(name$1) ? {
		type: "Identifier",
		name: name$1
	} : {
		type: "Literal",
		value: name$1
	};
	if (result.type === "Literal") {
		const name = result.value;
		return own$3.call(state.components, name) ? state.components[name] : name;
	}
	if (state.evaluater) return state.evaluater.evaluateExpression(result);
	crashEstree(state);
}
/**
* @param {State} state
* @param {Position | undefined} [place]
* @returns {never}
*/
function crashEstree(state, place) {
	const message = new VFileMessage("Cannot handle MDX estrees without `createEvaluater`", {
		ancestors: state.ancestors,
		place,
		ruleId: "mdx-estree",
		source: "hast-util-to-jsx-runtime"
	});
	message.file = state.filePath || void 0;
	message.url = "https://github.com/syntax-tree/hast-util-to-jsx-runtime#cannot-handle-mdx-estrees-without-createevaluater";
	throw message;
}
/**
* Transform a DOM casing style object to a CSS casing style object.
*
* @param {Style} domCasing
* @returns {Style}
*/
function transformStylesToCssCasing(domCasing) {
	/** @type {Style} */
	const cssCasing = {};
	/** @type {string} */
	let from;
	for (from in domCasing) if (own$3.call(domCasing, from)) cssCasing[transformStyleToCssCasing(from)] = domCasing[from];
	return cssCasing;
}
/**
* Transform a DOM casing style field to a CSS casing style field.
*
* @param {string} from
* @returns {string}
*/
function transformStyleToCssCasing(from) {
	let to = from.replace(cap, toDash);
	if (to.slice(0, 3) === "ms-") to = "-" + to;
	return to;
}
/**
* Make `$0` dash cased.
*
* @param {string} $0
*   Capitalized ASCII leter.
* @returns {string}
*   Dash and lower letter.
*/
function toDash($0) {
	return "-" + $0.toLowerCase();
}
//#endregion
//#region ../../node_modules/html-url-attributes/lib/index.js
/**
* HTML URL properties.
*
* Each key is a property name and each value is a list of tag names it applies
* to or `null` if it applies to all elements.
*
* @type {Record<string, Array<string> | null>}
*/
var urlAttributes = {
	action: ["form"],
	cite: [
		"blockquote",
		"del",
		"ins",
		"q"
	],
	data: ["object"],
	formAction: ["button", "input"],
	href: [
		"a",
		"area",
		"base",
		"link"
	],
	icon: ["menuitem"],
	itemId: null,
	manifest: ["html"],
	ping: ["a", "area"],
	poster: ["video"],
	src: [
		"audio",
		"embed",
		"iframe",
		"img",
		"input",
		"script",
		"source",
		"track",
		"video"
	]
};
//#endregion
//#region ../../node_modules/mdast-util-to-string/lib/index.js
/**
* @typedef {import('mdast').Nodes} Nodes
*
* @typedef Options
*   Configuration (optional).
* @property {boolean | null | undefined} [includeImageAlt=true]
*   Whether to use `alt` for `image`s (default: `true`).
* @property {boolean | null | undefined} [includeHtml=true]
*   Whether to use `value` of HTML (default: `true`).
*/
/** @type {Options} */
var emptyOptions$2 = {};
/**
* Get the text content of a node or list of nodes.
*
* Prefers the node’s plain-text fields, otherwise serializes its children,
* and if the given value is an array, serialize the nodes in it.
*
* @param {unknown} [value]
*   Thing to serialize, typically `Node`.
* @param {Options | null | undefined} [options]
*   Configuration (optional).
* @returns {string}
*   Serialized `value`.
*/
function toString$1(value, options) {
	const settings = options || emptyOptions$2;
	return one(value, typeof settings.includeImageAlt === "boolean" ? settings.includeImageAlt : true, typeof settings.includeHtml === "boolean" ? settings.includeHtml : true);
}
/**
* One node or several nodes.
*
* @param {unknown} value
*   Thing to serialize.
* @param {boolean} includeImageAlt
*   Include image `alt`s.
* @param {boolean} includeHtml
*   Include HTML.
* @returns {string}
*   Serialized node.
*/
function one(value, includeImageAlt, includeHtml) {
	if (node(value)) {
		if ("value" in value) return value.type === "html" && !includeHtml ? "" : value.value;
		if (includeImageAlt && "alt" in value && value.alt) return value.alt;
		if ("children" in value) return all(value.children, includeImageAlt, includeHtml);
	}
	if (Array.isArray(value)) return all(value, includeImageAlt, includeHtml);
	return "";
}
/**
* Serialize a list of nodes.
*
* @param {Array<unknown>} values
*   Thing to serialize.
* @param {boolean} includeImageAlt
*   Include image `alt`s.
* @param {boolean} includeHtml
*   Include HTML.
* @returns {string}
*   Serialized nodes.
*/
function all(values, includeImageAlt, includeHtml) {
	/** @type {Array<string>} */
	const result = [];
	let index = -1;
	while (++index < values.length) result[index] = one(values[index], includeImageAlt, includeHtml);
	return result.join("");
}
/**
* Check if `value` looks like a node.
*
* @param {unknown} value
*   Thing.
* @returns {value is Nodes}
*   Whether `value` is a node.
*/
function node(value) {
	return Boolean(value && typeof value === "object");
}
//#endregion
//#region ../../node_modules/decode-named-character-reference/index.dom.js
var element = document.createElement("i");
/**
* @param {string} value
* @returns {string | false}
*/
function decodeNamedCharacterReference(value) {
	const characterReference = "&" + value + ";";
	element.innerHTML = characterReference;
	const character = element.textContent;
	if (character.charCodeAt(character.length - 1) === 59 && value !== "semi") return false;
	return character === characterReference ? false : character;
}
//#endregion
//#region ../../node_modules/micromark-util-chunked/index.js
/**
* Like `Array#splice`, but smarter for giant arrays.
*
* `Array#splice` takes all items to be inserted as individual argument which
* causes a stack overflow in V8 when trying to insert 100k items for instance.
*
* Otherwise, this does not return the removed items, and takes `items` as an
* array instead of rest parameters.
*
* @template {unknown} T
*   Item type.
* @param {Array<T>} list
*   List to operate on.
* @param {number} start
*   Index to remove/insert at (can be negative).
* @param {number} remove
*   Number of items to remove.
* @param {Array<T>} items
*   Items to inject into `list`.
* @returns {undefined}
*   Nothing.
*/
function splice(list, start, remove, items) {
	const end = list.length;
	let chunkStart = 0;
	/** @type {Array<unknown>} */
	let parameters;
	if (start < 0) start = -start > end ? 0 : end + start;
	else start = start > end ? end : start;
	remove = remove > 0 ? remove : 0;
	if (items.length < 1e4) {
		parameters = Array.from(items);
		parameters.unshift(start, remove);
		list.splice(...parameters);
	} else {
		if (remove) list.splice(start, remove);
		while (chunkStart < items.length) {
			parameters = items.slice(chunkStart, chunkStart + 1e4);
			parameters.unshift(start, 0);
			list.splice(...parameters);
			chunkStart += 1e4;
			start += 1e4;
		}
	}
}
/**
* Append `items` (an array) at the end of `list` (another array).
* When `list` was empty, returns `items` instead.
*
* This prevents a potentially expensive operation when `list` is empty,
* and adds items in batches to prevent V8 from hanging.
*
* @template {unknown} T
*   Item type.
* @param {Array<T>} list
*   List to operate on.
* @param {Array<T>} items
*   Items to add to `list`.
* @returns {Array<T>}
*   Either `list` or `items`.
*/
function push(list, items) {
	if (list.length > 0) {
		splice(list, list.length, 0, items);
		return list;
	}
	return items;
}
//#endregion
//#region ../../node_modules/micromark-util-combine-extensions/index.js
/**
* @import {
*   Extension,
*   Handles,
*   HtmlExtension,
*   NormalizedExtension
* } from 'micromark-util-types'
*/
var hasOwnProperty = {}.hasOwnProperty;
/**
* Combine multiple syntax extensions into one.
*
* @param {ReadonlyArray<Extension>} extensions
*   List of syntax extensions.
* @returns {NormalizedExtension}
*   A single combined extension.
*/
function combineExtensions(extensions) {
	/** @type {NormalizedExtension} */
	const all = {};
	let index = -1;
	while (++index < extensions.length) syntaxExtension(all, extensions[index]);
	return all;
}
/**
* Merge `extension` into `all`.
*
* @param {NormalizedExtension} all
*   Extension to merge into.
* @param {Extension} extension
*   Extension to merge.
* @returns {undefined}
*   Nothing.
*/
function syntaxExtension(all, extension) {
	/** @type {keyof Extension} */
	let hook;
	for (hook in extension) {
		/** @type {Record<string, unknown>} */
		const left = (hasOwnProperty.call(all, hook) ? all[hook] : void 0) || (all[hook] = {});
		/** @type {Record<string, unknown> | undefined} */
		const right = extension[hook];
		/** @type {string} */
		let code;
		if (right) for (code in right) {
			if (!hasOwnProperty.call(left, code)) left[code] = [];
			const value = right[code];
			constructs(left[code], Array.isArray(value) ? value : value ? [value] : []);
		}
	}
}
/**
* Merge `list` into `existing` (both lists of constructs).
* Mutates `existing`.
*
* @param {Array<unknown>} existing
*   List of constructs to merge into.
* @param {Array<unknown>} list
*   List of constructs to merge.
* @returns {undefined}
*   Nothing.
*/
function constructs(existing, list) {
	let index = -1;
	/** @type {Array<unknown>} */
	const before = [];
	while (++index < list.length) (list[index].add === "after" ? existing : before).push(list[index]);
	splice(existing, 0, 0, before);
}
//#endregion
//#region ../../node_modules/micromark-util-decode-numeric-character-reference/index.js
/**
* Turn the number (in string form as either hexa- or plain decimal) coming from
* a numeric character reference into a character.
*
* Sort of like `String.fromCodePoint(Number.parseInt(value, base))`, but makes
* non-characters and control characters safe.
*
* @param {string} value
*   Value to decode.
* @param {number} base
*   Numeric base.
* @returns {string}
*   Character.
*/
function decodeNumericCharacterReference(value, base) {
	const code = Number.parseInt(value, base);
	if (code < 9 || code === 11 || code > 13 && code < 32 || code > 126 && code < 160 || code > 55295 && code < 57344 || code > 64975 && code < 65008 || (code & 65535) === 65535 || (code & 65535) === 65534 || code > 1114111) return "�";
	return String.fromCodePoint(code);
}
//#endregion
//#region ../../node_modules/micromark-util-normalize-identifier/index.js
/**
* Normalize an identifier (as found in references, definitions).
*
* Collapses markdown whitespace, trim, and then lower- and uppercase.
*
* Some characters are considered “uppercase”, such as U+03F4 (`ϴ`), but if their
* lowercase counterpart (U+03B8 (`θ`)) is uppercased will result in a different
* uppercase character (U+0398 (`Θ`)).
* So, to get a canonical form, we perform both lower- and uppercase.
*
* Using uppercase last makes sure keys will never interact with default
* prototypal values (such as `constructor`): nothing in the prototype of
* `Object` is uppercase.
*
* @param {string} value
*   Identifier to normalize.
* @returns {string}
*   Normalized identifier.
*/
function normalizeIdentifier(value) {
	return value.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
}
//#endregion
//#region ../../node_modules/micromark-util-character/index.js
/**
* @import {Code} from 'micromark-util-types'
*/
/**
* Check whether the character code represents an ASCII alpha (`a` through `z`,
* case insensitive).
*
* An **ASCII alpha** is an ASCII upper alpha or ASCII lower alpha.
*
* An **ASCII upper alpha** is a character in the inclusive range U+0041 (`A`)
* to U+005A (`Z`).
*
* An **ASCII lower alpha** is a character in the inclusive range U+0061 (`a`)
* to U+007A (`z`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
var asciiAlpha = regexCheck(/[A-Za-z]/);
/**
* Check whether the character code represents an ASCII alphanumeric (`a`
* through `z`, case insensitive, or `0` through `9`).
*
* An **ASCII alphanumeric** is an ASCII digit (see `asciiDigit`) or ASCII alpha
* (see `asciiAlpha`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
var asciiAlphanumeric = regexCheck(/[\dA-Za-z]/);
/**
* Check whether the character code represents an ASCII atext.
*
* atext is an ASCII alphanumeric (see `asciiAlphanumeric`), or a character in
* the inclusive ranges U+0023 NUMBER SIGN (`#`) to U+0027 APOSTROPHE (`'`),
* U+002A ASTERISK (`*`), U+002B PLUS SIGN (`+`), U+002D DASH (`-`), U+002F
* SLASH (`/`), U+003D EQUALS TO (`=`), U+003F QUESTION MARK (`?`), U+005E
* CARET (`^`) to U+0060 GRAVE ACCENT (`` ` ``), or U+007B LEFT CURLY BRACE
* (`{`) to U+007E TILDE (`~`).
*
* See:
* **\[RFC5322]**:
* [Internet Message Format](https://tools.ietf.org/html/rfc5322).
* P. Resnick.
* IETF.
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
var asciiAtext = regexCheck(/[#-'*+\--9=?A-Z^-~]/);
/**
* Check whether a character code is an ASCII control character.
*
* An **ASCII control** is a character in the inclusive range U+0000 NULL (NUL)
* to U+001F (US), or U+007F (DEL).
*
* @param {Code} code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
function asciiControl(code) {
	return code !== null && (code < 32 || code === 127);
}
/**
* Check whether the character code represents an ASCII digit (`0` through `9`).
*
* An **ASCII digit** is a character in the inclusive range U+0030 (`0`) to
* U+0039 (`9`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
var asciiDigit = regexCheck(/\d/);
/**
* Check whether the character code represents an ASCII hex digit (`a` through
* `f`, case insensitive, or `0` through `9`).
*
* An **ASCII hex digit** is an ASCII digit (see `asciiDigit`), ASCII upper hex
* digit, or an ASCII lower hex digit.
*
* An **ASCII upper hex digit** is a character in the inclusive range U+0041
* (`A`) to U+0046 (`F`).
*
* An **ASCII lower hex digit** is a character in the inclusive range U+0061
* (`a`) to U+0066 (`f`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
var asciiHexDigit = regexCheck(/[\dA-Fa-f]/);
/**
* Check whether the character code represents ASCII punctuation.
*
* An **ASCII punctuation** is a character in the inclusive ranges U+0021
* EXCLAMATION MARK (`!`) to U+002F SLASH (`/`), U+003A COLON (`:`) to U+0040 AT
* SIGN (`@`), U+005B LEFT SQUARE BRACKET (`[`) to U+0060 GRAVE ACCENT
* (`` ` ``), or U+007B LEFT CURLY BRACE (`{`) to U+007E TILDE (`~`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
var asciiPunctuation = regexCheck(/[!-/:-@[-`{-~]/);
/**
* Check whether a character code is a markdown line ending.
*
* A **markdown line ending** is the virtual characters M-0003 CARRIAGE RETURN
* LINE FEED (CRLF), M-0004 LINE FEED (LF) and M-0005 CARRIAGE RETURN (CR).
*
* In micromark, the actual character U+000A LINE FEED (LF) and U+000D CARRIAGE
* RETURN (CR) are replaced by these virtual characters depending on whether
* they occurred together.
*
* @param {Code} code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
function markdownLineEnding(code) {
	return code !== null && code < -2;
}
/**
* Check whether a character code is a markdown line ending (see
* `markdownLineEnding`) or markdown space (see `markdownSpace`).
*
* @param {Code} code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
function markdownLineEndingOrSpace(code) {
	return code !== null && (code < 0 || code === 32);
}
/**
* Check whether a character code is a markdown space.
*
* A **markdown space** is the concrete character U+0020 SPACE (SP) and the
* virtual characters M-0001 VIRTUAL SPACE (VS) and M-0002 HORIZONTAL TAB (HT).
*
* In micromark, the actual character U+0009 CHARACTER TABULATION (HT) is
* replaced by one M-0002 HORIZONTAL TAB (HT) and between 0 and 3 M-0001 VIRTUAL
* SPACE (VS) characters, depending on the column at which the tab occurred.
*
* @param {Code} code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
function markdownSpace(code) {
	return code === -2 || code === -1 || code === 32;
}
/**
* Check whether the character code represents Unicode punctuation.
*
* A **Unicode punctuation** is a character in the Unicode `Pc` (Punctuation,
* Connector), `Pd` (Punctuation, Dash), `Pe` (Punctuation, Close), `Pf`
* (Punctuation, Final quote), `Pi` (Punctuation, Initial quote), `Po`
* (Punctuation, Other), or `Ps` (Punctuation, Open) categories, or an ASCII
* punctuation (see `asciiPunctuation`).
*
* See:
* **\[UNICODE]**:
* [The Unicode Standard](https://www.unicode.org/versions/).
* Unicode Consortium.
*
* @param code
*   Code.
* @returns
*   Whether it matches.
*/
var unicodePunctuation = regexCheck(/\p{P}|\p{S}/u);
/**
* Check whether the character code represents Unicode whitespace.
*
* Note that this does handle micromark specific markdown whitespace characters.
* See `markdownLineEndingOrSpace` to check that.
*
* A **Unicode whitespace** is a character in the Unicode `Zs` (Separator,
* Space) category, or U+0009 CHARACTER TABULATION (HT), U+000A LINE FEED (LF),
* U+000C (FF), or U+000D CARRIAGE RETURN (CR) (**\[UNICODE]**).
*
* See:
* **\[UNICODE]**:
* [The Unicode Standard](https://www.unicode.org/versions/).
* Unicode Consortium.
*
* @param code
*   Code.
* @returns
*   Whether it matches.
*/
var unicodeWhitespace = regexCheck(/\s/);
/**
* Create a code check from a regex.
*
* @param {RegExp} regex
*   Expression.
* @returns {(code: Code) => boolean}
*   Check.
*/
function regexCheck(regex) {
	return check;
	/**
	* Check whether a code matches the bound regex.
	*
	* @param {Code} code
	*   Character code.
	* @returns {boolean}
	*   Whether the character code matches the bound regex.
	*/
	function check(code) {
		return code !== null && code > -1 && regex.test(String.fromCharCode(code));
	}
}
//#endregion
//#region ../../node_modules/micromark-util-sanitize-uri/index.js
/**
* Normalize a URL.
*
* Encode unsafe characters with percent-encoding, skipping already encoded
* sequences.
*
* @param {string} value
*   URI to normalize.
* @returns {string}
*   Normalized URI.
*/
function normalizeUri(value) {
	/** @type {Array<string>} */
	const result = [];
	let index = -1;
	let start = 0;
	let skip = 0;
	while (++index < value.length) {
		const code = value.charCodeAt(index);
		/** @type {string} */
		let replace = "";
		if (code === 37 && asciiAlphanumeric(value.charCodeAt(index + 1)) && asciiAlphanumeric(value.charCodeAt(index + 2))) skip = 2;
		else if (code < 128) {
			if (!/[!#$&-;=?-Z_a-z~]/.test(String.fromCharCode(code))) replace = String.fromCharCode(code);
		} else if (code > 55295 && code < 57344) {
			const next = value.charCodeAt(index + 1);
			if (code < 56320 && next > 56319 && next < 57344) {
				replace = String.fromCharCode(code, next);
				skip = 1;
			} else replace = "�";
		} else replace = String.fromCharCode(code);
		if (replace) {
			result.push(value.slice(start, index), encodeURIComponent(replace));
			start = index + skip + 1;
			replace = "";
		}
		if (skip) {
			index += skip;
			skip = 0;
		}
	}
	return result.join("") + value.slice(start);
}
//#endregion
//#region ../../node_modules/micromark-factory-space/index.js
/**
* @import {Effects, State, TokenType} from 'micromark-util-types'
*/
/**
* Parse spaces and tabs.
*
* There is no `nok` parameter:
*
* *   spaces in markdown are often optional, in which case this factory can be
*     used and `ok` will be switched to whether spaces were found or not
* *   one line ending or space can be detected with `markdownSpace(code)` right
*     before using `factorySpace`
*
* ###### Examples
*
* Where `␉` represents a tab (plus how much it expands) and `␠` represents a
* single space.
*
* ```markdown
* ␉
* ␠␠␠␠
* ␉␠
* ```
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {TokenType} type
*   Type (`' \t'`).
* @param {number | undefined} [max=Infinity]
*   Max (exclusive).
* @returns {State}
*   Start state.
*/
function factorySpace(effects, ok, type, max) {
	const limit = max ? max - 1 : Number.POSITIVE_INFINITY;
	let size = 0;
	return start;
	/** @type {State} */
	function start(code) {
		if (markdownSpace(code)) {
			effects.enter(type);
			return prefix(code);
		}
		return ok(code);
	}
	/** @type {State} */
	function prefix(code) {
		if (markdownSpace(code) && size++ < limit) {
			effects.consume(code);
			return prefix;
		}
		effects.exit(type);
		return ok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark/lib/initialize/content.js
/**
* @import {
*   InitialConstruct,
*   Initializer,
*   State,
*   TokenizeContext,
*   Token
* } from 'micromark-util-types'
*/
/** @type {InitialConstruct} */
var content$1 = { tokenize: initializeContent };
/**
* @this {TokenizeContext}
*   Context.
* @type {Initializer}
*   Content.
*/
function initializeContent(effects) {
	const contentStart = effects.attempt(this.parser.constructs.contentInitial, afterContentStartConstruct, paragraphInitial);
	/** @type {Token} */
	let previous;
	return contentStart;
	/** @type {State} */
	function afterContentStartConstruct(code) {
		if (code === null) {
			effects.consume(code);
			return;
		}
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return factorySpace(effects, contentStart, "linePrefix");
	}
	/** @type {State} */
	function paragraphInitial(code) {
		effects.enter("paragraph");
		return lineStart(code);
	}
	/** @type {State} */
	function lineStart(code) {
		const token = effects.enter("chunkText", {
			contentType: "text",
			previous
		});
		if (previous) previous.next = token;
		previous = token;
		return data(code);
	}
	/** @type {State} */
	function data(code) {
		if (code === null) {
			effects.exit("chunkText");
			effects.exit("paragraph");
			effects.consume(code);
			return;
		}
		if (markdownLineEnding(code)) {
			effects.consume(code);
			effects.exit("chunkText");
			return lineStart;
		}
		effects.consume(code);
		return data;
	}
}
//#endregion
//#region ../../node_modules/micromark/lib/initialize/document.js
/**
* @import {
*   Construct,
*   ContainerState,
*   InitialConstruct,
*   Initializer,
*   Point,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/**
* @typedef {[Construct, ContainerState]} StackItem
*   Construct and its state.
*/
/** @type {InitialConstruct} */
var document$2 = { tokenize: initializeDocument };
/** @type {Construct} */
var containerConstruct = { tokenize: tokenizeContainer };
/**
* @this {TokenizeContext}
*   Self.
* @type {Initializer}
*   Initializer.
*/
function initializeDocument(effects) {
	const self = this;
	/** @type {Array<StackItem>} */
	const stack = [];
	let continued = 0;
	/** @type {TokenizeContext | undefined} */
	let childFlow;
	/** @type {Token | undefined} */
	let childToken;
	/** @type {number} */
	let lineStartOffset;
	return start;
	/** @type {State} */
	function start(code) {
		if (continued < stack.length) {
			const item = stack[continued];
			self.containerState = item[1];
			return effects.attempt(item[0].continuation, documentContinue, checkNewContainers)(code);
		}
		return checkNewContainers(code);
	}
	/** @type {State} */
	function documentContinue(code) {
		continued++;
		if (self.containerState._closeFlow) {
			self.containerState._closeFlow = void 0;
			if (childFlow) closeFlow();
			const indexBeforeExits = self.events.length;
			let indexBeforeFlow = indexBeforeExits;
			/** @type {Point | undefined} */
			let point;
			while (indexBeforeFlow--) if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === "chunkFlow") {
				point = self.events[indexBeforeFlow][1].end;
				break;
			}
			exitContainers(continued);
			let index = indexBeforeExits;
			while (index < self.events.length) {
				self.events[index][1].end = { ...point };
				index++;
			}
			splice(self.events, indexBeforeFlow + 1, 0, self.events.slice(indexBeforeExits));
			self.events.length = index;
			return checkNewContainers(code);
		}
		return start(code);
	}
	/** @type {State} */
	function checkNewContainers(code) {
		if (continued === stack.length) {
			if (!childFlow) return documentContinued(code);
			if (childFlow.currentConstruct && childFlow.currentConstruct.concrete) return flowStart(code);
			self.interrupt = Boolean(childFlow.currentConstruct && !childFlow._gfmTableDynamicInterruptHack);
		}
		self.containerState = {};
		return effects.check(containerConstruct, thereIsANewContainer, thereIsNoNewContainer)(code);
	}
	/** @type {State} */
	function thereIsANewContainer(code) {
		if (childFlow) closeFlow();
		exitContainers(continued);
		return documentContinued(code);
	}
	/** @type {State} */
	function thereIsNoNewContainer(code) {
		self.parser.lazy[self.now().line] = continued !== stack.length;
		lineStartOffset = self.now().offset;
		return flowStart(code);
	}
	/** @type {State} */
	function documentContinued(code) {
		self.containerState = {};
		return effects.attempt(containerConstruct, containerContinue, flowStart)(code);
	}
	/** @type {State} */
	function containerContinue(code) {
		continued++;
		stack.push([self.currentConstruct, self.containerState]);
		return documentContinued(code);
	}
	/** @type {State} */
	function flowStart(code) {
		if (code === null) {
			if (childFlow) closeFlow();
			exitContainers(0);
			effects.consume(code);
			return;
		}
		childFlow = childFlow || self.parser.flow(self.now());
		effects.enter("chunkFlow", {
			_tokenizer: childFlow,
			contentType: "flow",
			previous: childToken
		});
		return flowContinue(code);
	}
	/** @type {State} */
	function flowContinue(code) {
		if (code === null) {
			writeToChild(effects.exit("chunkFlow"), true);
			exitContainers(0);
			effects.consume(code);
			return;
		}
		if (markdownLineEnding(code)) {
			effects.consume(code);
			writeToChild(effects.exit("chunkFlow"));
			continued = 0;
			self.interrupt = void 0;
			return start;
		}
		effects.consume(code);
		return flowContinue;
	}
	/**
	* @param {Token} token
	*   Token.
	* @param {boolean | undefined} [endOfFile]
	*   Whether the token is at the end of the file (default: `false`).
	* @returns {undefined}
	*   Nothing.
	*/
	function writeToChild(token, endOfFile) {
		const stream = self.sliceStream(token);
		if (endOfFile) stream.push(null);
		token.previous = childToken;
		if (childToken) childToken.next = token;
		childToken = token;
		childFlow.defineSkip(token.start);
		childFlow.write(stream);
		if (self.parser.lazy[token.start.line]) {
			let index = childFlow.events.length;
			while (index--) if (childFlow.events[index][1].start.offset < lineStartOffset && (!childFlow.events[index][1].end || childFlow.events[index][1].end.offset > lineStartOffset)) return;
			const indexBeforeExits = self.events.length;
			let indexBeforeFlow = indexBeforeExits;
			/** @type {boolean | undefined} */
			let seen;
			/** @type {Point | undefined} */
			let point;
			while (indexBeforeFlow--) if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === "chunkFlow") {
				if (seen) {
					point = self.events[indexBeforeFlow][1].end;
					break;
				}
				seen = true;
			}
			exitContainers(continued);
			index = indexBeforeExits;
			while (index < self.events.length) {
				self.events[index][1].end = { ...point };
				index++;
			}
			splice(self.events, indexBeforeFlow + 1, 0, self.events.slice(indexBeforeExits));
			self.events.length = index;
		}
	}
	/**
	* @param {number} size
	*   Size.
	* @returns {undefined}
	*   Nothing.
	*/
	function exitContainers(size) {
		let index = stack.length;
		while (index-- > size) {
			const entry = stack[index];
			self.containerState = entry[1];
			entry[0].exit.call(self, effects);
		}
		stack.length = size;
	}
	function closeFlow() {
		childFlow.write([null]);
		childToken = void 0;
		childFlow = void 0;
		self.containerState._closeFlow = void 0;
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*   Tokenizer.
*/
function tokenizeContainer(effects, ok, nok) {
	return factorySpace(effects, effects.attempt(this.parser.constructs.document, ok, nok), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
}
//#endregion
//#region ../../node_modules/micromark-util-classify-character/index.js
/**
* @import {Code} from 'micromark-util-types'
*/
/**
* Classify whether a code represents whitespace, punctuation, or something
* else.
*
* Used for attention (emphasis, strong), whose sequences can open or close
* based on the class of surrounding characters.
*
* > 👉 **Note**: eof (`null`) is seen as whitespace.
*
* @param {Code} code
*   Code.
* @returns {typeof constants.characterGroupWhitespace | typeof constants.characterGroupPunctuation | undefined}
*   Group.
*/
function classifyCharacter(code) {
	if (code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return 1;
	if (unicodePunctuation(code)) return 2;
}
//#endregion
//#region ../../node_modules/micromark-util-resolve-all/index.js
/**
* @import {Event, Resolver, TokenizeContext} from 'micromark-util-types'
*/
/**
* Call all `resolveAll`s.
*
* @param {ReadonlyArray<{resolveAll?: Resolver | undefined}>} constructs
*   List of constructs, optionally with `resolveAll`s.
* @param {Array<Event>} events
*   List of events.
* @param {TokenizeContext} context
*   Context used by `tokenize`.
* @returns {Array<Event>}
*   Changed events.
*/
function resolveAll(constructs, events, context) {
	/** @type {Array<Resolver>} */
	const called = [];
	let index = -1;
	while (++index < constructs.length) {
		const resolve = constructs[index].resolveAll;
		if (resolve && !called.includes(resolve)) {
			events = resolve(events, context);
			called.push(resolve);
		}
	}
	return events;
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/attention.js
/**
* @import {
*   Code,
*   Construct,
*   Event,
*   Point,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var attention = {
	name: "attention",
	resolveAll: resolveAllAttention,
	tokenize: tokenizeAttention
};
/**
* Take all events and resolve attention to emphasis or strong.
*
* @type {Resolver}
*/
function resolveAllAttention(events, context) {
	let index = -1;
	/** @type {number} */
	let open;
	/** @type {Token} */
	let group;
	/** @type {Token} */
	let text;
	/** @type {Token} */
	let openingSequence;
	/** @type {Token} */
	let closingSequence;
	/** @type {number} */
	let use;
	/** @type {Array<Event>} */
	let nextEvents;
	/** @type {number} */
	let offset;
	while (++index < events.length) if (events[index][0] === "enter" && events[index][1].type === "attentionSequence" && events[index][1]._close) {
		open = index;
		while (open--) if (events[open][0] === "exit" && events[open][1].type === "attentionSequence" && events[open][1]._open && context.sliceSerialize(events[open][1]).charCodeAt(0) === context.sliceSerialize(events[index][1]).charCodeAt(0)) {
			if ((events[open][1]._close || events[index][1]._open) && (events[index][1].end.offset - events[index][1].start.offset) % 3 && !((events[open][1].end.offset - events[open][1].start.offset + events[index][1].end.offset - events[index][1].start.offset) % 3)) continue;
			use = events[open][1].end.offset - events[open][1].start.offset > 1 && events[index][1].end.offset - events[index][1].start.offset > 1 ? 2 : 1;
			const start = { ...events[open][1].end };
			const end = { ...events[index][1].start };
			movePoint(start, -use);
			movePoint(end, use);
			openingSequence = {
				type: use > 1 ? "strongSequence" : "emphasisSequence",
				start,
				end: { ...events[open][1].end }
			};
			closingSequence = {
				type: use > 1 ? "strongSequence" : "emphasisSequence",
				start: { ...events[index][1].start },
				end
			};
			text = {
				type: use > 1 ? "strongText" : "emphasisText",
				start: { ...events[open][1].end },
				end: { ...events[index][1].start }
			};
			group = {
				type: use > 1 ? "strong" : "emphasis",
				start: { ...openingSequence.start },
				end: { ...closingSequence.end }
			};
			events[open][1].end = { ...openingSequence.start };
			events[index][1].start = { ...closingSequence.end };
			nextEvents = [];
			if (events[open][1].end.offset - events[open][1].start.offset) nextEvents = push(nextEvents, [[
				"enter",
				events[open][1],
				context
			], [
				"exit",
				events[open][1],
				context
			]]);
			nextEvents = push(nextEvents, [
				[
					"enter",
					group,
					context
				],
				[
					"enter",
					openingSequence,
					context
				],
				[
					"exit",
					openingSequence,
					context
				],
				[
					"enter",
					text,
					context
				]
			]);
			nextEvents = push(nextEvents, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + 1, index), context));
			nextEvents = push(nextEvents, [
				[
					"exit",
					text,
					context
				],
				[
					"enter",
					closingSequence,
					context
				],
				[
					"exit",
					closingSequence,
					context
				],
				[
					"exit",
					group,
					context
				]
			]);
			if (events[index][1].end.offset - events[index][1].start.offset) {
				offset = 2;
				nextEvents = push(nextEvents, [[
					"enter",
					events[index][1],
					context
				], [
					"exit",
					events[index][1],
					context
				]]);
			} else offset = 0;
			splice(events, open - 1, index - open + 3, nextEvents);
			index = open + nextEvents.length - offset - 2;
			break;
		}
	}
	index = -1;
	while (++index < events.length) if (events[index][1].type === "attentionSequence") events[index][1].type = "data";
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeAttention(effects, ok) {
	const attentionMarkers = this.parser.constructs.attentionMarkers.null;
	const previous = this.previous;
	const before = classifyCharacter(previous);
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Before a sequence.
	*
	* ```markdown
	* > | **
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		marker = code;
		effects.enter("attentionSequence");
		return inside(code);
	}
	/**
	* In a sequence.
	*
	* ```markdown
	* > | **
	*     ^^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === marker) {
			effects.consume(code);
			return inside;
		}
		const token = effects.exit("attentionSequence");
		const after = classifyCharacter(code);
		const open = !after || after === 2 && before || attentionMarkers.includes(code);
		const close = !before || before === 2 && after || attentionMarkers.includes(previous);
		token._open = Boolean(marker === 42 ? open : open && (before || !close));
		token._close = Boolean(marker === 42 ? close : close && (after || !open));
		return ok(code);
	}
}
/**
* Move a point a bit.
*
* Note: `move` only works inside lines! It’s not possible to move past other
* chunks (replacement characters, tabs, or line endings).
*
* @param {Point} point
*   Point.
* @param {number} offset
*   Amount to move.
* @returns {undefined}
*   Nothing.
*/
function movePoint(point, offset) {
	point.column += offset;
	point.offset += offset;
	point._bufferIndex += offset;
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/autolink.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var autolink = {
	name: "autolink",
	tokenize: tokenizeAutolink
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeAutolink(effects, ok, nok) {
	let size = 0;
	return start;
	/**
	* Start of an autolink.
	*
	* ```markdown
	* > | a<https://example.com>b
	*      ^
	* > | a<user@example.com>b
	*      ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("autolink");
		effects.enter("autolinkMarker");
		effects.consume(code);
		effects.exit("autolinkMarker");
		effects.enter("autolinkProtocol");
		return open;
	}
	/**
	* After `<`, at protocol or atext.
	*
	* ```markdown
	* > | a<https://example.com>b
	*       ^
	* > | a<user@example.com>b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (asciiAlpha(code)) {
			effects.consume(code);
			return schemeOrEmailAtext;
		}
		if (code === 64) return nok(code);
		return emailAtext(code);
	}
	/**
	* At second byte of protocol or atext.
	*
	* ```markdown
	* > | a<https://example.com>b
	*        ^
	* > | a<user@example.com>b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function schemeOrEmailAtext(code) {
		if (code === 43 || code === 45 || code === 46 || asciiAlphanumeric(code)) {
			size = 1;
			return schemeInsideOrEmailAtext(code);
		}
		return emailAtext(code);
	}
	/**
	* In ambiguous protocol or atext.
	*
	* ```markdown
	* > | a<https://example.com>b
	*        ^
	* > | a<user@example.com>b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function schemeInsideOrEmailAtext(code) {
		if (code === 58) {
			effects.consume(code);
			size = 0;
			return urlInside;
		}
		if ((code === 43 || code === 45 || code === 46 || asciiAlphanumeric(code)) && size++ < 32) {
			effects.consume(code);
			return schemeInsideOrEmailAtext;
		}
		size = 0;
		return emailAtext(code);
	}
	/**
	* After protocol, in URL.
	*
	* ```markdown
	* > | a<https://example.com>b
	*             ^
	* ```
	*
	* @type {State}
	*/
	function urlInside(code) {
		if (code === 62) {
			effects.exit("autolinkProtocol");
			effects.enter("autolinkMarker");
			effects.consume(code);
			effects.exit("autolinkMarker");
			effects.exit("autolink");
			return ok;
		}
		if (code === null || code === 32 || code === 60 || asciiControl(code)) return nok(code);
		effects.consume(code);
		return urlInside;
	}
	/**
	* In email atext.
	*
	* ```markdown
	* > | a<user.name@example.com>b
	*              ^
	* ```
	*
	* @type {State}
	*/
	function emailAtext(code) {
		if (code === 64) {
			effects.consume(code);
			return emailAtSignOrDot;
		}
		if (asciiAtext(code)) {
			effects.consume(code);
			return emailAtext;
		}
		return nok(code);
	}
	/**
	* In label, after at-sign or dot.
	*
	* ```markdown
	* > | a<user.name@example.com>b
	*                 ^       ^
	* ```
	*
	* @type {State}
	*/
	function emailAtSignOrDot(code) {
		return asciiAlphanumeric(code) ? emailLabel(code) : nok(code);
	}
	/**
	* In label, where `.` and `>` are allowed.
	*
	* ```markdown
	* > | a<user.name@example.com>b
	*                   ^
	* ```
	*
	* @type {State}
	*/
	function emailLabel(code) {
		if (code === 46) {
			effects.consume(code);
			size = 0;
			return emailAtSignOrDot;
		}
		if (code === 62) {
			effects.exit("autolinkProtocol").type = "autolinkEmail";
			effects.enter("autolinkMarker");
			effects.consume(code);
			effects.exit("autolinkMarker");
			effects.exit("autolink");
			return ok;
		}
		return emailValue(code);
	}
	/**
	* In label, where `.` and `>` are *not* allowed.
	*
	* Though, this is also used in `emailLabel` to parse other values.
	*
	* ```markdown
	* > | a<user.name@ex-ample.com>b
	*                    ^
	* ```
	*
	* @type {State}
	*/
	function emailValue(code) {
		if ((code === 45 || asciiAlphanumeric(code)) && size++ < 63) {
			const next = code === 45 ? emailValue : emailLabel;
			effects.consume(code);
			return next;
		}
		return nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/blank-line.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var blankLine = {
	partial: true,
	tokenize: tokenizeBlankLine
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeBlankLine(effects, ok, nok) {
	return start;
	/**
	* Start of blank line.
	*
	* > 👉 **Note**: `␠` represents a space character.
	*
	* ```markdown
	* > | ␠␠␊
	*     ^
	* > | ␊
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		return markdownSpace(code) ? factorySpace(effects, after, "linePrefix")(code) : after(code);
	}
	/**
	* At eof/eol, after optional whitespace.
	*
	* > 👉 **Note**: `␠` represents a space character.
	*
	* ```markdown
	* > | ␠␠␊
	*       ^
	* > | ␊
	*     ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return code === null || markdownLineEnding(code) ? ok(code) : nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/block-quote.js
/**
* @import {
*   Construct,
*   Exiter,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var blockQuote = {
	continuation: { tokenize: tokenizeBlockQuoteContinuation },
	exit: exit$1,
	name: "blockQuote",
	tokenize: tokenizeBlockQuoteStart
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeBlockQuoteStart(effects, ok, nok) {
	const self = this;
	return start;
	/**
	* Start of block quote.
	*
	* ```markdown
	* > | > a
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (code === 62) {
			const state = self.containerState;
			if (!state.open) {
				effects.enter("blockQuote", { _container: true });
				state.open = true;
			}
			effects.enter("blockQuotePrefix");
			effects.enter("blockQuoteMarker");
			effects.consume(code);
			effects.exit("blockQuoteMarker");
			return after;
		}
		return nok(code);
	}
	/**
	* After `>`, before optional whitespace.
	*
	* ```markdown
	* > | > a
	*      ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		if (markdownSpace(code)) {
			effects.enter("blockQuotePrefixWhitespace");
			effects.consume(code);
			effects.exit("blockQuotePrefixWhitespace");
			effects.exit("blockQuotePrefix");
			return ok;
		}
		effects.exit("blockQuotePrefix");
		return ok(code);
	}
}
/**
* Start of block quote continuation.
*
* ```markdown
*   | > a
* > | > b
*     ^
* ```
*
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeBlockQuoteContinuation(effects, ok, nok) {
	const self = this;
	return contStart;
	/**
	* Start of block quote continuation.
	*
	* Also used to parse the first block quote opening.
	*
	* ```markdown
	*   | > a
	* > | > b
	*     ^
	* ```
	*
	* @type {State}
	*/
	function contStart(code) {
		if (markdownSpace(code)) return factorySpace(effects, contBefore, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code);
		return contBefore(code);
	}
	/**
	* At `>`, after optional whitespace.
	*
	* Also used to parse the first block quote opening.
	*
	* ```markdown
	*   | > a
	* > | > b
	*     ^
	* ```
	*
	* @type {State}
	*/
	function contBefore(code) {
		return effects.attempt(blockQuote, ok, nok)(code);
	}
}
/** @type {Exiter} */
function exit$1(effects) {
	effects.exit("blockQuote");
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/character-escape.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var characterEscape = {
	name: "characterEscape",
	tokenize: tokenizeCharacterEscape
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCharacterEscape(effects, ok, nok) {
	return start;
	/**
	* Start of character escape.
	*
	* ```markdown
	* > | a\*b
	*      ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("characterEscape");
		effects.enter("escapeMarker");
		effects.consume(code);
		effects.exit("escapeMarker");
		return inside;
	}
	/**
	* After `\`, at punctuation.
	*
	* ```markdown
	* > | a\*b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (asciiPunctuation(code)) {
			effects.enter("characterEscapeValue");
			effects.consume(code);
			effects.exit("characterEscapeValue");
			effects.exit("characterEscape");
			return ok;
		}
		return nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/character-reference.js
/**
* @import {
*   Code,
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var characterReference = {
	name: "characterReference",
	tokenize: tokenizeCharacterReference
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCharacterReference(effects, ok, nok) {
	const self = this;
	let size = 0;
	/** @type {number} */
	let max;
	/** @type {(code: Code) => boolean} */
	let test;
	return start;
	/**
	* Start of character reference.
	*
	* ```markdown
	* > | a&amp;b
	*      ^
	* > | a&#123;b
	*      ^
	* > | a&#x9;b
	*      ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("characterReference");
		effects.enter("characterReferenceMarker");
		effects.consume(code);
		effects.exit("characterReferenceMarker");
		return open;
	}
	/**
	* After `&`, at `#` for numeric references or alphanumeric for named
	* references.
	*
	* ```markdown
	* > | a&amp;b
	*       ^
	* > | a&#123;b
	*       ^
	* > | a&#x9;b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (code === 35) {
			effects.enter("characterReferenceMarkerNumeric");
			effects.consume(code);
			effects.exit("characterReferenceMarkerNumeric");
			return numeric;
		}
		effects.enter("characterReferenceValue");
		max = 31;
		test = asciiAlphanumeric;
		return value(code);
	}
	/**
	* After `#`, at `x` for hexadecimals or digit for decimals.
	*
	* ```markdown
	* > | a&#123;b
	*        ^
	* > | a&#x9;b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function numeric(code) {
		if (code === 88 || code === 120) {
			effects.enter("characterReferenceMarkerHexadecimal");
			effects.consume(code);
			effects.exit("characterReferenceMarkerHexadecimal");
			effects.enter("characterReferenceValue");
			max = 6;
			test = asciiHexDigit;
			return value;
		}
		effects.enter("characterReferenceValue");
		max = 7;
		test = asciiDigit;
		return value(code);
	}
	/**
	* After markers (`&#x`, `&#`, or `&`), in value, before `;`.
	*
	* The character reference kind defines what and how many characters are
	* allowed.
	*
	* ```markdown
	* > | a&amp;b
	*       ^^^
	* > | a&#123;b
	*        ^^^
	* > | a&#x9;b
	*         ^
	* ```
	*
	* @type {State}
	*/
	function value(code) {
		if (code === 59 && size) {
			const token = effects.exit("characterReferenceValue");
			if (test === asciiAlphanumeric && !decodeNamedCharacterReference(self.sliceSerialize(token))) return nok(code);
			effects.enter("characterReferenceMarker");
			effects.consume(code);
			effects.exit("characterReferenceMarker");
			effects.exit("characterReference");
			return ok;
		}
		if (test(code) && size++ < max) {
			effects.consume(code);
			return value;
		}
		return nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/code-fenced.js
/**
* @import {
*   Code,
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var nonLazyContinuation = {
	partial: true,
	tokenize: tokenizeNonLazyContinuation
};
/** @type {Construct} */
var codeFenced = {
	concrete: true,
	name: "codeFenced",
	tokenize: tokenizeCodeFenced
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCodeFenced(effects, ok, nok) {
	const self = this;
	/** @type {Construct} */
	const closeStart = {
		partial: true,
		tokenize: tokenizeCloseStart
	};
	let initialPrefix = 0;
	let sizeOpen = 0;
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Start of code.
	*
	* ```markdown
	* > | ~~~js
	*     ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		return beforeSequenceOpen(code);
	}
	/**
	* In opening fence, after prefix, at sequence.
	*
	* ```markdown
	* > | ~~~js
	*     ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function beforeSequenceOpen(code) {
		const tail = self.events[self.events.length - 1];
		initialPrefix = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
		marker = code;
		effects.enter("codeFenced");
		effects.enter("codeFencedFence");
		effects.enter("codeFencedFenceSequence");
		return sequenceOpen(code);
	}
	/**
	* In opening fence sequence.
	*
	* ```markdown
	* > | ~~~js
	*      ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function sequenceOpen(code) {
		if (code === marker) {
			sizeOpen++;
			effects.consume(code);
			return sequenceOpen;
		}
		if (sizeOpen < 3) return nok(code);
		effects.exit("codeFencedFenceSequence");
		return markdownSpace(code) ? factorySpace(effects, infoBefore, "whitespace")(code) : infoBefore(code);
	}
	/**
	* In opening fence, after the sequence (and optional whitespace), before info.
	*
	* ```markdown
	* > | ~~~js
	*        ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function infoBefore(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("codeFencedFence");
			return self.interrupt ? ok(code) : effects.check(nonLazyContinuation, atNonLazyBreak, after)(code);
		}
		effects.enter("codeFencedFenceInfo");
		effects.enter("chunkString", { contentType: "string" });
		return info(code);
	}
	/**
	* In info.
	*
	* ```markdown
	* > | ~~~js
	*        ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function info(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("chunkString");
			effects.exit("codeFencedFenceInfo");
			return infoBefore(code);
		}
		if (markdownSpace(code)) {
			effects.exit("chunkString");
			effects.exit("codeFencedFenceInfo");
			return factorySpace(effects, metaBefore, "whitespace")(code);
		}
		if (code === 96 && code === marker) return nok(code);
		effects.consume(code);
		return info;
	}
	/**
	* In opening fence, after info and whitespace, before meta.
	*
	* ```markdown
	* > | ~~~js eval
	*           ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function metaBefore(code) {
		if (code === null || markdownLineEnding(code)) return infoBefore(code);
		effects.enter("codeFencedFenceMeta");
		effects.enter("chunkString", { contentType: "string" });
		return meta(code);
	}
	/**
	* In meta.
	*
	* ```markdown
	* > | ~~~js eval
	*           ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function meta(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("chunkString");
			effects.exit("codeFencedFenceMeta");
			return infoBefore(code);
		}
		if (code === 96 && code === marker) return nok(code);
		effects.consume(code);
		return meta;
	}
	/**
	* At eol/eof in code, before a non-lazy closing fence or content.
	*
	* ```markdown
	* > | ~~~js
	*          ^
	* > | alert(1)
	*             ^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function atNonLazyBreak(code) {
		return effects.attempt(closeStart, after, contentBefore)(code);
	}
	/**
	* Before code content, not a closing fence, at eol.
	*
	* ```markdown
	*   | ~~~js
	* > | alert(1)
	*             ^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function contentBefore(code) {
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return contentStart;
	}
	/**
	* Before code content, not a closing fence.
	*
	* ```markdown
	*   | ~~~js
	* > | alert(1)
	*     ^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function contentStart(code) {
		return initialPrefix > 0 && markdownSpace(code) ? factorySpace(effects, beforeContentChunk, "linePrefix", initialPrefix + 1)(code) : beforeContentChunk(code);
	}
	/**
	* Before code content, after optional prefix.
	*
	* ```markdown
	*   | ~~~js
	* > | alert(1)
	*     ^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function beforeContentChunk(code) {
		if (code === null || markdownLineEnding(code)) return effects.check(nonLazyContinuation, atNonLazyBreak, after)(code);
		effects.enter("codeFlowValue");
		return contentChunk(code);
	}
	/**
	* In code content.
	*
	* ```markdown
	*   | ~~~js
	* > | alert(1)
	*     ^^^^^^^^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function contentChunk(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("codeFlowValue");
			return beforeContentChunk(code);
		}
		effects.consume(code);
		return contentChunk;
	}
	/**
	* After code.
	*
	* ```markdown
	*   | ~~~js
	*   | alert(1)
	* > | ~~~
	*        ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		effects.exit("codeFenced");
		return ok(code);
	}
	/**
	* @this {TokenizeContext}
	*   Context.
	* @type {Tokenizer}
	*/
	function tokenizeCloseStart(effects, ok, nok) {
		let size = 0;
		return startBefore;
		/**
		*
		*
		* @type {State}
		*/
		function startBefore(code) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return start;
		}
		/**
		* Before closing fence, at optional whitespace.
		*
		* ```markdown
		*   | ~~~js
		*   | alert(1)
		* > | ~~~
		*     ^
		* ```
		*
		* @type {State}
		*/
		function start(code) {
			effects.enter("codeFencedFence");
			return markdownSpace(code) ? factorySpace(effects, beforeSequenceClose, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code) : beforeSequenceClose(code);
		}
		/**
		* In closing fence, after optional whitespace, at sequence.
		*
		* ```markdown
		*   | ~~~js
		*   | alert(1)
		* > | ~~~
		*     ^
		* ```
		*
		* @type {State}
		*/
		function beforeSequenceClose(code) {
			if (code === marker) {
				effects.enter("codeFencedFenceSequence");
				return sequenceClose(code);
			}
			return nok(code);
		}
		/**
		* In closing fence sequence.
		*
		* ```markdown
		*   | ~~~js
		*   | alert(1)
		* > | ~~~
		*     ^
		* ```
		*
		* @type {State}
		*/
		function sequenceClose(code) {
			if (code === marker) {
				size++;
				effects.consume(code);
				return sequenceClose;
			}
			if (size >= sizeOpen) {
				effects.exit("codeFencedFenceSequence");
				return markdownSpace(code) ? factorySpace(effects, sequenceCloseAfter, "whitespace")(code) : sequenceCloseAfter(code);
			}
			return nok(code);
		}
		/**
		* After closing fence sequence, after optional whitespace.
		*
		* ```markdown
		*   | ~~~js
		*   | alert(1)
		* > | ~~~
		*        ^
		* ```
		*
		* @type {State}
		*/
		function sequenceCloseAfter(code) {
			if (code === null || markdownLineEnding(code)) {
				effects.exit("codeFencedFence");
				return ok(code);
			}
			return nok(code);
		}
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeNonLazyContinuation(effects, ok, nok) {
	const self = this;
	return start;
	/**
	*
	*
	* @type {State}
	*/
	function start(code) {
		if (code === null) return nok(code);
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return lineStart;
	}
	/**
	*
	*
	* @type {State}
	*/
	function lineStart(code) {
		return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/code-indented.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var codeIndented = {
	name: "codeIndented",
	tokenize: tokenizeCodeIndented
};
/** @type {Construct} */
var furtherStart = {
	partial: true,
	tokenize: tokenizeFurtherStart
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCodeIndented(effects, ok, nok) {
	const self = this;
	return start;
	/**
	* Start of code (indented).
	*
	* > **Parsing note**: it is not needed to check if this first line is a
	* > filled line (that it has a non-whitespace character), because blank lines
	* > are parsed already, so we never run into that.
	*
	* ```markdown
	* > |     aaa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("codeIndented");
		return factorySpace(effects, afterPrefix, "linePrefix", 5)(code);
	}
	/**
	* At start, after 1 or 4 spaces.
	*
	* ```markdown
	* > |     aaa
	*         ^
	* ```
	*
	* @type {State}
	*/
	function afterPrefix(code) {
		const tail = self.events[self.events.length - 1];
		return tail && tail[1].type === "linePrefix" && tail[2].sliceSerialize(tail[1], true).length >= 4 ? atBreak(code) : nok(code);
	}
	/**
	* At a break.
	*
	* ```markdown
	* > |     aaa
	*         ^  ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (code === null) return after(code);
		if (markdownLineEnding(code)) return effects.attempt(furtherStart, atBreak, after)(code);
		effects.enter("codeFlowValue");
		return inside(code);
	}
	/**
	* In code content.
	*
	* ```markdown
	* > |     aaa
	*         ^^^^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("codeFlowValue");
			return atBreak(code);
		}
		effects.consume(code);
		return inside;
	}
	/** @type {State} */
	function after(code) {
		effects.exit("codeIndented");
		return ok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeFurtherStart(effects, ok, nok) {
	const self = this;
	return furtherStart;
	/**
	* At eol, trying to parse another indent.
	*
	* ```markdown
	* > |     aaa
	*            ^
	*   |     bbb
	* ```
	*
	* @type {State}
	*/
	function furtherStart(code) {
		if (self.parser.lazy[self.now().line]) return nok(code);
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return furtherStart;
		}
		return factorySpace(effects, afterPrefix, "linePrefix", 5)(code);
	}
	/**
	* At start, after 1 or 4 spaces.
	*
	* ```markdown
	* > |     aaa
	*         ^
	* ```
	*
	* @type {State}
	*/
	function afterPrefix(code) {
		const tail = self.events[self.events.length - 1];
		return tail && tail[1].type === "linePrefix" && tail[2].sliceSerialize(tail[1], true).length >= 4 ? ok(code) : markdownLineEnding(code) ? furtherStart(code) : nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/code-text.js
/**
* @import {
*   Construct,
*   Previous,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var codeText = {
	name: "codeText",
	previous: previous$1,
	resolve: resolveCodeText,
	tokenize: tokenizeCodeText
};
/** @type {Resolver} */
function resolveCodeText(events) {
	let tailExitIndex = events.length - 4;
	let headEnterIndex = 3;
	/** @type {number} */
	let index;
	/** @type {number | undefined} */
	let enter;
	if ((events[headEnterIndex][1].type === "lineEnding" || events[headEnterIndex][1].type === "space") && (events[tailExitIndex][1].type === "lineEnding" || events[tailExitIndex][1].type === "space")) {
		index = headEnterIndex;
		while (++index < tailExitIndex) if (events[index][1].type === "codeTextData") {
			events[headEnterIndex][1].type = "codeTextPadding";
			events[tailExitIndex][1].type = "codeTextPadding";
			headEnterIndex += 2;
			tailExitIndex -= 2;
			break;
		}
	}
	index = headEnterIndex - 1;
	tailExitIndex++;
	while (++index <= tailExitIndex) if (enter === void 0) {
		if (index !== tailExitIndex && events[index][1].type !== "lineEnding") enter = index;
	} else if (index === tailExitIndex || events[index][1].type === "lineEnding") {
		events[enter][1].type = "codeTextData";
		if (index !== enter + 2) {
			events[enter][1].end = events[index - 1][1].end;
			events.splice(enter + 2, index - enter - 2);
			tailExitIndex -= index - enter - 2;
			index = enter + 2;
		}
		enter = void 0;
	}
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Previous}
*/
function previous$1(code) {
	return code !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCodeText(effects, ok, nok) {
	let sizeOpen = 0;
	/** @type {number} */
	let size;
	/** @type {Token} */
	let token;
	return start;
	/**
	* Start of code (text).
	*
	* ```markdown
	* > | `a`
	*     ^
	* > | \`a`
	*      ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("codeText");
		effects.enter("codeTextSequence");
		return sequenceOpen(code);
	}
	/**
	* In opening sequence.
	*
	* ```markdown
	* > | `a`
	*     ^
	* ```
	*
	* @type {State}
	*/
	function sequenceOpen(code) {
		if (code === 96) {
			effects.consume(code);
			sizeOpen++;
			return sequenceOpen;
		}
		effects.exit("codeTextSequence");
		return between(code);
	}
	/**
	* Between something and something else.
	*
	* ```markdown
	* > | `a`
	*      ^^
	* ```
	*
	* @type {State}
	*/
	function between(code) {
		if (code === null) return nok(code);
		if (code === 32) {
			effects.enter("space");
			effects.consume(code);
			effects.exit("space");
			return between;
		}
		if (code === 96) {
			token = effects.enter("codeTextSequence");
			size = 0;
			return sequenceClose(code);
		}
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return between;
		}
		effects.enter("codeTextData");
		return data(code);
	}
	/**
	* In data.
	*
	* ```markdown
	* > | `a`
	*      ^
	* ```
	*
	* @type {State}
	*/
	function data(code) {
		if (code === null || code === 32 || code === 96 || markdownLineEnding(code)) {
			effects.exit("codeTextData");
			return between(code);
		}
		effects.consume(code);
		return data;
	}
	/**
	* In closing sequence.
	*
	* ```markdown
	* > | `a`
	*       ^
	* ```
	*
	* @type {State}
	*/
	function sequenceClose(code) {
		if (code === 96) {
			effects.consume(code);
			size++;
			return sequenceClose;
		}
		if (size === sizeOpen) {
			effects.exit("codeTextSequence");
			effects.exit("codeText");
			return ok(code);
		}
		token.type = "codeTextData";
		return data(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-util-subtokenize/lib/splice-buffer.js
/**
* Some of the internal operations of micromark do lots of editing
* operations on very large arrays. This runs into problems with two
* properties of most circa-2020 JavaScript interpreters:
*
*  - Array-length modifications at the high end of an array (push/pop) are
*    expected to be common and are implemented in (amortized) time
*    proportional to the number of elements added or removed, whereas
*    other operations (shift/unshift and splice) are much less efficient.
*  - Function arguments are passed on the stack, so adding tens of thousands
*    of elements to an array with `arr.push(...newElements)` will frequently
*    cause stack overflows. (see <https://stackoverflow.com/questions/22123769/rangeerror-maximum-call-stack-size-exceeded-why>)
*
* SpliceBuffers are an implementation of gap buffers, which are a
* generalization of the "queue made of two stacks" idea. The splice buffer
* maintains a cursor, and moving the cursor has cost proportional to the
* distance the cursor moves, but inserting, deleting, or splicing in
* new information at the cursor is as efficient as the push/pop operation.
* This allows for an efficient sequence of splices (or pushes, pops, shifts,
* or unshifts) as long such edits happen at the same part of the array or
* generally sweep through the array from the beginning to the end.
*
* The interface for splice buffers also supports large numbers of inputs by
* passing a single array argument rather passing multiple arguments on the
* function call stack.
*
* @template T
*   Item type.
*/
var SpliceBuffer = class {
	/**
	* @param {ReadonlyArray<T> | null | undefined} [initial]
	*   Initial items (optional).
	* @returns
	*   Splice buffer.
	*/
	constructor(initial) {
		/** @type {Array<T>} */
		this.left = initial ? [...initial] : [];
		/** @type {Array<T>} */
		this.right = [];
	}
	/**
	* Array access;
	* does not move the cursor.
	*
	* @param {number} index
	*   Index.
	* @return {T}
	*   Item.
	*/
	get(index) {
		if (index < 0 || index >= this.left.length + this.right.length) throw new RangeError("Cannot access index `" + index + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
		if (index < this.left.length) return this.left[index];
		return this.right[this.right.length - index + this.left.length - 1];
	}
	/**
	* The length of the splice buffer, one greater than the largest index in the
	* array.
	*/
	get length() {
		return this.left.length + this.right.length;
	}
	/**
	* Remove and return `list[0]`;
	* moves the cursor to `0`.
	*
	* @returns {T | undefined}
	*   Item, optional.
	*/
	shift() {
		this.setCursor(0);
		return this.right.pop();
	}
	/**
	* Slice the buffer to get an array;
	* does not move the cursor.
	*
	* @param {number} start
	*   Start.
	* @param {number | null | undefined} [end]
	*   End (optional).
	* @returns {Array<T>}
	*   Array of items.
	*/
	slice(start, end) {
		/** @type {number} */
		const stop = end === null || end === void 0 ? Number.POSITIVE_INFINITY : end;
		if (stop < this.left.length) return this.left.slice(start, stop);
		if (start > this.left.length) return this.right.slice(this.right.length - stop + this.left.length, this.right.length - start + this.left.length).reverse();
		return this.left.slice(start).concat(this.right.slice(this.right.length - stop + this.left.length).reverse());
	}
	/**
	* Mimics the behavior of Array.prototype.splice() except for the change of
	* interface necessary to avoid segfaults when patching in very large arrays.
	*
	* This operation moves cursor is moved to `start` and results in the cursor
	* placed after any inserted items.
	*
	* @param {number} start
	*   Start;
	*   zero-based index at which to start changing the array;
	*   negative numbers count backwards from the end of the array and values
	*   that are out-of bounds are clamped to the appropriate end of the array.
	* @param {number | null | undefined} [deleteCount=0]
	*   Delete count (default: `0`);
	*   maximum number of elements to delete, starting from start.
	* @param {Array<T> | null | undefined} [items=[]]
	*   Items to include in place of the deleted items (default: `[]`).
	* @return {Array<T>}
	*   Any removed items.
	*/
	splice(start, deleteCount, items) {
		/** @type {number} */
		const count = deleteCount || 0;
		this.setCursor(Math.trunc(start));
		const removed = this.right.splice(this.right.length - count, Number.POSITIVE_INFINITY);
		if (items) chunkedPush(this.left, items);
		return removed.reverse();
	}
	/**
	* Remove and return the highest-numbered item in the array, so
	* `list[list.length - 1]`;
	* Moves the cursor to `length`.
	*
	* @returns {T | undefined}
	*   Item, optional.
	*/
	pop() {
		this.setCursor(Number.POSITIVE_INFINITY);
		return this.left.pop();
	}
	/**
	* Inserts a single item to the high-numbered side of the array;
	* moves the cursor to `length`.
	*
	* @param {T} item
	*   Item.
	* @returns {undefined}
	*   Nothing.
	*/
	push(item) {
		this.setCursor(Number.POSITIVE_INFINITY);
		this.left.push(item);
	}
	/**
	* Inserts many items to the high-numbered side of the array.
	* Moves the cursor to `length`.
	*
	* @param {Array<T>} items
	*   Items.
	* @returns {undefined}
	*   Nothing.
	*/
	pushMany(items) {
		this.setCursor(Number.POSITIVE_INFINITY);
		chunkedPush(this.left, items);
	}
	/**
	* Inserts a single item to the low-numbered side of the array;
	* Moves the cursor to `0`.
	*
	* @param {T} item
	*   Item.
	* @returns {undefined}
	*   Nothing.
	*/
	unshift(item) {
		this.setCursor(0);
		this.right.push(item);
	}
	/**
	* Inserts many items to the low-numbered side of the array;
	* moves the cursor to `0`.
	*
	* @param {Array<T>} items
	*   Items.
	* @returns {undefined}
	*   Nothing.
	*/
	unshiftMany(items) {
		this.setCursor(0);
		chunkedPush(this.right, items.reverse());
	}
	/**
	* Move the cursor to a specific position in the array. Requires
	* time proportional to the distance moved.
	*
	* If `n < 0`, the cursor will end up at the beginning.
	* If `n > length`, the cursor will end up at the end.
	*
	* @param {number} n
	*   Position.
	* @return {undefined}
	*   Nothing.
	*/
	setCursor(n) {
		if (n === this.left.length || n > this.left.length && this.right.length === 0 || n < 0 && this.left.length === 0) return;
		if (n < this.left.length) {
			const removed = this.left.splice(n, Number.POSITIVE_INFINITY);
			chunkedPush(this.right, removed.reverse());
		} else {
			const removed = this.right.splice(this.left.length + this.right.length - n, Number.POSITIVE_INFINITY);
			chunkedPush(this.left, removed.reverse());
		}
	}
};
/**
* Avoid stack overflow by pushing items onto the stack in segments
*
* @template T
*   Item type.
* @param {Array<T>} list
*   List to inject into.
* @param {ReadonlyArray<T>} right
*   Items to inject.
* @return {undefined}
*   Nothing.
*/
function chunkedPush(list, right) {
	/** @type {number} */
	let chunkStart = 0;
	if (right.length < 1e4) list.push(...right);
	else while (chunkStart < right.length) {
		list.push(...right.slice(chunkStart, chunkStart + 1e4));
		chunkStart += 1e4;
	}
}
//#endregion
//#region ../../node_modules/micromark-util-subtokenize/index.js
/**
* @import {Chunk, Event, Token} from 'micromark-util-types'
*/
/**
* Tokenize subcontent.
*
* @param {Array<Event>} eventsArray
*   List of events.
* @returns {boolean}
*   Whether subtokens were found.
*/
function subtokenize(eventsArray) {
	/** @type {Record<string, number>} */
	const jumps = {};
	let index = -1;
	/** @type {Event} */
	let event;
	/** @type {number | undefined} */
	let lineIndex;
	/** @type {number} */
	let otherIndex;
	/** @type {Event} */
	let otherEvent;
	/** @type {Array<Event>} */
	let parameters;
	/** @type {Array<Event>} */
	let subevents;
	/** @type {boolean | undefined} */
	let more;
	const events = new SpliceBuffer(eventsArray);
	while (++index < events.length) {
		while (index in jumps) index = jumps[index];
		event = events.get(index);
		if (index && event[1].type === "chunkFlow" && events.get(index - 1)[1].type === "listItemPrefix") {
			subevents = event[1]._tokenizer.events;
			otherIndex = 0;
			if (otherIndex < subevents.length && subevents[otherIndex][1].type === "lineEndingBlank") otherIndex += 2;
			if (otherIndex < subevents.length && subevents[otherIndex][1].type === "content") while (++otherIndex < subevents.length) {
				if (subevents[otherIndex][1].type === "content") break;
				if (subevents[otherIndex][1].type === "chunkText") {
					subevents[otherIndex][1]._isInFirstContentOfListItem = true;
					otherIndex++;
				}
			}
		}
		if (event[0] === "enter") {
			if (event[1].contentType) {
				Object.assign(jumps, subcontent(events, index));
				index = jumps[index];
				more = true;
			}
		} else if (event[1]._container) {
			otherIndex = index;
			lineIndex = void 0;
			while (otherIndex--) {
				otherEvent = events.get(otherIndex);
				if (otherEvent[1].type === "lineEnding" || otherEvent[1].type === "lineEndingBlank") {
					if (otherEvent[0] === "enter") {
						if (lineIndex) events.get(lineIndex)[1].type = "lineEndingBlank";
						otherEvent[1].type = "lineEnding";
						lineIndex = otherIndex;
					}
				} else if (otherEvent[1].type === "linePrefix" || otherEvent[1].type === "listItemIndent") {} else break;
			}
			if (lineIndex) {
				event[1].end = { ...events.get(lineIndex)[1].start };
				parameters = events.slice(lineIndex, index);
				parameters.unshift(event);
				events.splice(lineIndex, index - lineIndex + 1, parameters);
			}
		}
	}
	splice(eventsArray, 0, Number.POSITIVE_INFINITY, events.slice(0));
	return !more;
}
/**
* Tokenize embedded tokens.
*
* @param {SpliceBuffer<Event>} events
*   Events.
* @param {number} eventIndex
*   Index.
* @returns {Record<string, number>}
*   Gaps.
*/
function subcontent(events, eventIndex) {
	const token = events.get(eventIndex)[1];
	const context = events.get(eventIndex)[2];
	let startPosition = eventIndex - 1;
	/** @type {Array<number>} */
	const startPositions = [];
	let tokenizer = token._tokenizer;
	if (!tokenizer) {
		tokenizer = context.parser[token.contentType](token.start);
		if (token._contentTypeTextTrailing) tokenizer._contentTypeTextTrailing = true;
	}
	const childEvents = tokenizer.events;
	/** @type {Array<[number, number]>} */
	const jumps = [];
	/** @type {Record<string, number>} */
	const gaps = {};
	/** @type {Array<Chunk>} */
	let stream;
	/** @type {Token | undefined} */
	let previous;
	let index = -1;
	/** @type {Token | undefined} */
	let current = token;
	let adjust = 0;
	let start = 0;
	const breaks = [start];
	while (current) {
		while (events.get(++startPosition)[1] !== current);
		startPositions.push(startPosition);
		if (!current._tokenizer) {
			stream = context.sliceStream(current);
			if (!current.next) stream.push(null);
			if (previous) tokenizer.defineSkip(current.start);
			if (current._isInFirstContentOfListItem) tokenizer._gfmTasklistFirstContentOfListItem = true;
			tokenizer.write(stream);
			if (current._isInFirstContentOfListItem) tokenizer._gfmTasklistFirstContentOfListItem = void 0;
		}
		previous = current;
		current = current.next;
	}
	current = token;
	while (++index < childEvents.length) if (childEvents[index][0] === "exit" && childEvents[index - 1][0] === "enter" && childEvents[index][1].type === childEvents[index - 1][1].type && childEvents[index][1].start.line !== childEvents[index][1].end.line) {
		start = index + 1;
		breaks.push(start);
		current._tokenizer = void 0;
		current.previous = void 0;
		current = current.next;
	}
	tokenizer.events = [];
	if (current) {
		current._tokenizer = void 0;
		current.previous = void 0;
	} else breaks.pop();
	index = breaks.length;
	while (index--) {
		const slice = childEvents.slice(breaks[index], breaks[index + 1]);
		const start = startPositions.pop();
		jumps.push([start, start + slice.length - 1]);
		events.splice(start, 2, slice);
	}
	jumps.reverse();
	index = -1;
	while (++index < jumps.length) {
		gaps[adjust + jumps[index][0]] = adjust + jumps[index][1];
		adjust += jumps[index][1] - jumps[index][0] - 1;
	}
	return gaps;
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/content.js
/**
* @import {
*   Construct,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/**
* No name because it must not be turned off.
* @type {Construct}
*/
var content = {
	resolve: resolveContent,
	tokenize: tokenizeContent
};
/** @type {Construct} */
var continuationConstruct = {
	partial: true,
	tokenize: tokenizeContinuation
};
/**
* Content is transparent: it’s parsed right now. That way, definitions are also
* parsed right now: before text in paragraphs (specifically, media) are parsed.
*
* @type {Resolver}
*/
function resolveContent(events) {
	subtokenize(events);
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeContent(effects, ok) {
	/** @type {Token | undefined} */
	let previous;
	return chunkStart;
	/**
	* Before a content chunk.
	*
	* ```markdown
	* > | abc
	*     ^
	* ```
	*
	* @type {State}
	*/
	function chunkStart(code) {
		effects.enter("content");
		previous = effects.enter("chunkContent", { contentType: "content" });
		return chunkInside(code);
	}
	/**
	* In a content chunk.
	*
	* ```markdown
	* > | abc
	*     ^^^
	* ```
	*
	* @type {State}
	*/
	function chunkInside(code) {
		if (code === null) return contentEnd(code);
		if (markdownLineEnding(code)) return effects.check(continuationConstruct, contentContinue, contentEnd)(code);
		effects.consume(code);
		return chunkInside;
	}
	/**
	*
	*
	* @type {State}
	*/
	function contentEnd(code) {
		effects.exit("chunkContent");
		effects.exit("content");
		return ok(code);
	}
	/**
	*
	*
	* @type {State}
	*/
	function contentContinue(code) {
		effects.consume(code);
		effects.exit("chunkContent");
		previous.next = effects.enter("chunkContent", {
			contentType: "content",
			previous
		});
		previous = previous.next;
		return chunkInside;
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeContinuation(effects, ok, nok) {
	const self = this;
	return startLookahead;
	/**
	*
	*
	* @type {State}
	*/
	function startLookahead(code) {
		effects.exit("chunkContent");
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return factorySpace(effects, prefixed, "linePrefix");
	}
	/**
	*
	*
	* @type {State}
	*/
	function prefixed(code) {
		if (code === null || markdownLineEnding(code)) return nok(code);
		const tail = self.events[self.events.length - 1];
		if (!self.parser.constructs.disable.null.includes("codeIndented") && tail && tail[1].type === "linePrefix" && tail[2].sliceSerialize(tail[1], true).length >= 4) return ok(code);
		return effects.interrupt(self.parser.constructs.flow, nok, ok)(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-factory-destination/index.js
/**
* @import {Effects, State, TokenType} from 'micromark-util-types'
*/
/**
* Parse destinations.
*
* ###### Examples
*
* ```markdown
* <a>
* <a\>b>
* <a b>
* <a)>
* a
* a\)b
* a(b)c
* a(b)
* ```
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {State} nok
*   State switched to when unsuccessful.
* @param {TokenType} type
*   Type for whole (`<a>` or `b`).
* @param {TokenType} literalType
*   Type when enclosed (`<a>`).
* @param {TokenType} literalMarkerType
*   Type for enclosing (`<` and `>`).
* @param {TokenType} rawType
*   Type when not enclosed (`b`).
* @param {TokenType} stringType
*   Type for the value (`a` or `b`).
* @param {number | undefined} [max=Infinity]
*   Depth of nested parens (inclusive).
* @returns {State}
*   Start state.
*/
function factoryDestination(effects, ok, nok, type, literalType, literalMarkerType, rawType, stringType, max) {
	const limit = max || Number.POSITIVE_INFINITY;
	let balance = 0;
	return start;
	/**
	* Start of destination.
	*
	* ```markdown
	* > | <aa>
	*     ^
	* > | aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (code === 60) {
			effects.enter(type);
			effects.enter(literalType);
			effects.enter(literalMarkerType);
			effects.consume(code);
			effects.exit(literalMarkerType);
			return enclosedBefore;
		}
		if (code === null || code === 32 || code === 41 || asciiControl(code)) return nok(code);
		effects.enter(type);
		effects.enter(rawType);
		effects.enter(stringType);
		effects.enter("chunkString", { contentType: "string" });
		return raw(code);
	}
	/**
	* After `<`, at an enclosed destination.
	*
	* ```markdown
	* > | <aa>
	*      ^
	* ```
	*
	* @type {State}
	*/
	function enclosedBefore(code) {
		if (code === 62) {
			effects.enter(literalMarkerType);
			effects.consume(code);
			effects.exit(literalMarkerType);
			effects.exit(literalType);
			effects.exit(type);
			return ok;
		}
		effects.enter(stringType);
		effects.enter("chunkString", { contentType: "string" });
		return enclosed(code);
	}
	/**
	* In enclosed destination.
	*
	* ```markdown
	* > | <aa>
	*      ^
	* ```
	*
	* @type {State}
	*/
	function enclosed(code) {
		if (code === 62) {
			effects.exit("chunkString");
			effects.exit(stringType);
			return enclosedBefore(code);
		}
		if (code === null || code === 60 || markdownLineEnding(code)) return nok(code);
		effects.consume(code);
		return code === 92 ? enclosedEscape : enclosed;
	}
	/**
	* After `\`, at a special character.
	*
	* ```markdown
	* > | <a\*a>
	*        ^
	* ```
	*
	* @type {State}
	*/
	function enclosedEscape(code) {
		if (code === 60 || code === 62 || code === 92) {
			effects.consume(code);
			return enclosed;
		}
		return enclosed(code);
	}
	/**
	* In raw destination.
	*
	* ```markdown
	* > | aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function raw(code) {
		if (!balance && (code === null || code === 41 || markdownLineEndingOrSpace(code))) {
			effects.exit("chunkString");
			effects.exit(stringType);
			effects.exit(rawType);
			effects.exit(type);
			return ok(code);
		}
		if (balance < limit && code === 40) {
			effects.consume(code);
			balance++;
			return raw;
		}
		if (code === 41) {
			effects.consume(code);
			balance--;
			return raw;
		}
		if (code === null || code === 32 || code === 40 || asciiControl(code)) return nok(code);
		effects.consume(code);
		return code === 92 ? rawEscape : raw;
	}
	/**
	* After `\`, at special character.
	*
	* ```markdown
	* > | a\*a
	*       ^
	* ```
	*
	* @type {State}
	*/
	function rawEscape(code) {
		if (code === 40 || code === 41 || code === 92) {
			effects.consume(code);
			return raw;
		}
		return raw(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-factory-label/index.js
/**
* @import {
*   Effects,
*   State,
*   TokenizeContext,
*   TokenType
* } from 'micromark-util-types'
*/
/**
* Parse labels.
*
* > 👉 **Note**: labels in markdown are capped at 999 characters in the string.
*
* ###### Examples
*
* ```markdown
* [a]
* [a
* b]
* [a\]b]
* ```
*
* @this {TokenizeContext}
*   Tokenize context.
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {State} nok
*   State switched to when unsuccessful.
* @param {TokenType} type
*   Type of the whole label (`[a]`).
* @param {TokenType} markerType
*   Type for the markers (`[` and `]`).
* @param {TokenType} stringType
*   Type for the identifier (`a`).
* @returns {State}
*   Start state.
*/
function factoryLabel(effects, ok, nok, type, markerType, stringType) {
	const self = this;
	let size = 0;
	/** @type {boolean} */
	let seen;
	return start;
	/**
	* Start of label.
	*
	* ```markdown
	* > | [a]
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter(type);
		effects.enter(markerType);
		effects.consume(code);
		effects.exit(markerType);
		effects.enter(stringType);
		return atBreak;
	}
	/**
	* In label, at something, before something else.
	*
	* ```markdown
	* > | [a]
	*      ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (size > 999 || code === null || code === 91 || code === 93 && !seen ||
		/* c8 ignore next 3 */
		code === 94 && !size && "_hiddenFootnoteSupport" in self.parser.constructs) return nok(code);
		if (code === 93) {
			effects.exit(stringType);
			effects.enter(markerType);
			effects.consume(code);
			effects.exit(markerType);
			effects.exit(type);
			return ok;
		}
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return atBreak;
		}
		effects.enter("chunkString", { contentType: "string" });
		return labelInside(code);
	}
	/**
	* In label, in text.
	*
	* ```markdown
	* > | [a]
	*      ^
	* ```
	*
	* @type {State}
	*/
	function labelInside(code) {
		if (code === null || code === 91 || code === 93 || markdownLineEnding(code) || size++ > 999) {
			effects.exit("chunkString");
			return atBreak(code);
		}
		effects.consume(code);
		if (!seen) seen = !markdownSpace(code);
		return code === 92 ? labelEscape : labelInside;
	}
	/**
	* After `\`, at a special character.
	*
	* ```markdown
	* > | [a\*a]
	*        ^
	* ```
	*
	* @type {State}
	*/
	function labelEscape(code) {
		if (code === 91 || code === 92 || code === 93) {
			effects.consume(code);
			size++;
			return labelInside;
		}
		return labelInside(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-factory-title/index.js
/**
* @import {
*   Code,
*   Effects,
*   State,
*   TokenType
* } from 'micromark-util-types'
*/
/**
* Parse titles.
*
* ###### Examples
*
* ```markdown
* "a"
* 'b'
* (c)
* "a
* b"
* 'a
*     b'
* (a\)b)
* ```
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {State} nok
*   State switched to when unsuccessful.
* @param {TokenType} type
*   Type of the whole title (`"a"`, `'b'`, `(c)`).
* @param {TokenType} markerType
*   Type for the markers (`"`, `'`, `(`, and `)`).
* @param {TokenType} stringType
*   Type for the value (`a`).
* @returns {State}
*   Start state.
*/
function factoryTitle(effects, ok, nok, type, markerType, stringType) {
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Start of title.
	*
	* ```markdown
	* > | "a"
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (code === 34 || code === 39 || code === 40) {
			effects.enter(type);
			effects.enter(markerType);
			effects.consume(code);
			effects.exit(markerType);
			marker = code === 40 ? 41 : code;
			return begin;
		}
		return nok(code);
	}
	/**
	* After opening marker.
	*
	* This is also used at the closing marker.
	*
	* ```markdown
	* > | "a"
	*      ^
	* ```
	*
	* @type {State}
	*/
	function begin(code) {
		if (code === marker) {
			effects.enter(markerType);
			effects.consume(code);
			effects.exit(markerType);
			effects.exit(type);
			return ok;
		}
		effects.enter(stringType);
		return atBreak(code);
	}
	/**
	* At something, before something else.
	*
	* ```markdown
	* > | "a"
	*      ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (code === marker) {
			effects.exit(stringType);
			return begin(marker);
		}
		if (code === null) return nok(code);
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return factorySpace(effects, atBreak, "linePrefix");
		}
		effects.enter("chunkString", { contentType: "string" });
		return inside(code);
	}
	/**
	*
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === marker || code === null || markdownLineEnding(code)) {
			effects.exit("chunkString");
			return atBreak(code);
		}
		effects.consume(code);
		return code === 92 ? escape : inside;
	}
	/**
	* After `\`, at a special character.
	*
	* ```markdown
	* > | "a\*b"
	*      ^
	* ```
	*
	* @type {State}
	*/
	function escape(code) {
		if (code === marker || code === 92) {
			effects.consume(code);
			return inside;
		}
		return inside(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-factory-whitespace/index.js
/**
* @import {Effects, State} from 'micromark-util-types'
*/
/**
* Parse spaces and tabs.
*
* There is no `nok` parameter:
*
* *   line endings or spaces in markdown are often optional, in which case this
*     factory can be used and `ok` will be switched to whether spaces were found
*     or not
* *   one line ending or space can be detected with
*     `markdownLineEndingOrSpace(code)` right before using `factoryWhitespace`
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @returns {State}
*   Start state.
*/
function factoryWhitespace(effects, ok) {
	/** @type {boolean} */
	let seen;
	return start;
	/** @type {State} */
	function start(code) {
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			seen = true;
			return start;
		}
		if (markdownSpace(code)) return factorySpace(effects, start, seen ? "linePrefix" : "lineSuffix")(code);
		return ok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/definition.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var definition$1 = {
	name: "definition",
	tokenize: tokenizeDefinition
};
/** @type {Construct} */
var titleBefore = {
	partial: true,
	tokenize: tokenizeTitleBefore
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeDefinition(effects, ok, nok) {
	const self = this;
	/** @type {string} */
	let identifier;
	return start;
	/**
	* At start of a definition.
	*
	* ```markdown
	* > | [a]: b "c"
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("definition");
		return before(code);
	}
	/**
	* After optional whitespace, at `[`.
	*
	* ```markdown
	* > | [a]: b "c"
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		return factoryLabel.call(self, effects, labelAfter, nok, "definitionLabel", "definitionLabelMarker", "definitionLabelString")(code);
	}
	/**
	* After label.
	*
	* ```markdown
	* > | [a]: b "c"
	*        ^
	* ```
	*
	* @type {State}
	*/
	function labelAfter(code) {
		identifier = normalizeIdentifier(self.sliceSerialize(self.events[self.events.length - 1][1]).slice(1, -1));
		if (code === 58) {
			effects.enter("definitionMarker");
			effects.consume(code);
			effects.exit("definitionMarker");
			return markerAfter;
		}
		return nok(code);
	}
	/**
	* After marker.
	*
	* ```markdown
	* > | [a]: b "c"
	*         ^
	* ```
	*
	* @type {State}
	*/
	function markerAfter(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, destinationBefore)(code) : destinationBefore(code);
	}
	/**
	* Before destination.
	*
	* ```markdown
	* > | [a]: b "c"
	*          ^
	* ```
	*
	* @type {State}
	*/
	function destinationBefore(code) {
		return factoryDestination(effects, destinationAfter, nok, "definitionDestination", "definitionDestinationLiteral", "definitionDestinationLiteralMarker", "definitionDestinationRaw", "definitionDestinationString")(code);
	}
	/**
	* After destination.
	*
	* ```markdown
	* > | [a]: b "c"
	*           ^
	* ```
	*
	* @type {State}
	*/
	function destinationAfter(code) {
		return effects.attempt(titleBefore, after, after)(code);
	}
	/**
	* After definition.
	*
	* ```markdown
	* > | [a]: b
	*           ^
	* > | [a]: b "c"
	*               ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return markdownSpace(code) ? factorySpace(effects, afterWhitespace, "whitespace")(code) : afterWhitespace(code);
	}
	/**
	* After definition, after optional whitespace.
	*
	* ```markdown
	* > | [a]: b
	*           ^
	* > | [a]: b "c"
	*               ^
	* ```
	*
	* @type {State}
	*/
	function afterWhitespace(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("definition");
			self.parser.defined.push(identifier);
			return ok(code);
		}
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeTitleBefore(effects, ok, nok) {
	return titleBefore;
	/**
	* After destination, at whitespace.
	*
	* ```markdown
	* > | [a]: b
	*           ^
	* > | [a]: b "c"
	*           ^
	* ```
	*
	* @type {State}
	*/
	function titleBefore(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, beforeMarker)(code) : nok(code);
	}
	/**
	* At title.
	*
	* ```markdown
	*   | [a]: b
	* > | "c"
	*     ^
	* ```
	*
	* @type {State}
	*/
	function beforeMarker(code) {
		return factoryTitle(effects, titleAfter, nok, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(code);
	}
	/**
	* After title.
	*
	* ```markdown
	* > | [a]: b "c"
	*               ^
	* ```
	*
	* @type {State}
	*/
	function titleAfter(code) {
		return markdownSpace(code) ? factorySpace(effects, titleAfterOptionalWhitespace, "whitespace")(code) : titleAfterOptionalWhitespace(code);
	}
	/**
	* After title, after optional whitespace.
	*
	* ```markdown
	* > | [a]: b "c"
	*               ^
	* ```
	*
	* @type {State}
	*/
	function titleAfterOptionalWhitespace(code) {
		return code === null || markdownLineEnding(code) ? ok(code) : nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/hard-break-escape.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var hardBreakEscape = {
	name: "hardBreakEscape",
	tokenize: tokenizeHardBreakEscape
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeHardBreakEscape(effects, ok, nok) {
	return start;
	/**
	* Start of a hard break (escape).
	*
	* ```markdown
	* > | a\
	*      ^
	*   | b
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("hardBreakEscape");
		effects.consume(code);
		return after;
	}
	/**
	* After `\`, at eol.
	*
	* ```markdown
	* > | a\
	*       ^
	*   | b
	* ```
	*
	*  @type {State}
	*/
	function after(code) {
		if (markdownLineEnding(code)) {
			effects.exit("hardBreakEscape");
			return ok(code);
		}
		return nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/heading-atx.js
/**
* @import {
*   Construct,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var headingAtx = {
	name: "headingAtx",
	resolve: resolveHeadingAtx,
	tokenize: tokenizeHeadingAtx
};
/** @type {Resolver} */
function resolveHeadingAtx(events, context) {
	let contentEnd = events.length - 2;
	let contentStart = 3;
	/** @type {Token} */
	let content;
	/** @type {Token} */
	let text;
	if (events[contentStart][1].type === "whitespace") contentStart += 2;
	if (contentEnd - 2 > contentStart && events[contentEnd][1].type === "whitespace") contentEnd -= 2;
	if (events[contentEnd][1].type === "atxHeadingSequence" && (contentStart === contentEnd - 1 || contentEnd - 4 > contentStart && events[contentEnd - 2][1].type === "whitespace")) contentEnd -= contentStart + 1 === contentEnd ? 2 : 4;
	if (contentEnd > contentStart) {
		content = {
			type: "atxHeadingText",
			start: events[contentStart][1].start,
			end: events[contentEnd][1].end
		};
		text = {
			type: "chunkText",
			start: events[contentStart][1].start,
			end: events[contentEnd][1].end,
			contentType: "text"
		};
		splice(events, contentStart, contentEnd - contentStart + 1, [
			[
				"enter",
				content,
				context
			],
			[
				"enter",
				text,
				context
			],
			[
				"exit",
				text,
				context
			],
			[
				"exit",
				content,
				context
			]
		]);
	}
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeHeadingAtx(effects, ok, nok) {
	let size = 0;
	return start;
	/**
	* Start of a heading (atx).
	*
	* ```markdown
	* > | ## aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("atxHeading");
		return before(code);
	}
	/**
	* After optional whitespace, at `#`.
	*
	* ```markdown
	* > | ## aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		effects.enter("atxHeadingSequence");
		return sequenceOpen(code);
	}
	/**
	* In opening sequence.
	*
	* ```markdown
	* > | ## aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function sequenceOpen(code) {
		if (code === 35 && size++ < 6) {
			effects.consume(code);
			return sequenceOpen;
		}
		if (code === null || markdownLineEndingOrSpace(code)) {
			effects.exit("atxHeadingSequence");
			return atBreak(code);
		}
		return nok(code);
	}
	/**
	* After something, before something else.
	*
	* ```markdown
	* > | ## aa
	*       ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (code === 35) {
			effects.enter("atxHeadingSequence");
			return sequenceFurther(code);
		}
		if (code === null || markdownLineEnding(code)) {
			effects.exit("atxHeading");
			return ok(code);
		}
		if (markdownSpace(code)) return factorySpace(effects, atBreak, "whitespace")(code);
		effects.enter("atxHeadingText");
		return data(code);
	}
	/**
	* In further sequence (after whitespace).
	*
	* Could be normal “visible” hashes in the heading or a final sequence.
	*
	* ```markdown
	* > | ## aa ##
	*           ^
	* ```
	*
	* @type {State}
	*/
	function sequenceFurther(code) {
		if (code === 35) {
			effects.consume(code);
			return sequenceFurther;
		}
		effects.exit("atxHeadingSequence");
		return atBreak(code);
	}
	/**
	* In text.
	*
	* ```markdown
	* > | ## aa
	*        ^
	* ```
	*
	* @type {State}
	*/
	function data(code) {
		if (code === null || code === 35 || markdownLineEndingOrSpace(code)) {
			effects.exit("atxHeadingText");
			return atBreak(code);
		}
		effects.consume(code);
		return data;
	}
}
//#endregion
//#region ../../node_modules/micromark-util-html-tag-name/index.js
/**
* List of lowercase HTML “block” tag names.
*
* The list, when parsing HTML (flow), results in more relaxed rules (condition
* 6).
* Because they are known blocks, the HTML-like syntax doesn’t have to be
* strictly parsed.
* For tag names not in this list, a more strict algorithm (condition 7) is used
* to detect whether the HTML-like syntax is seen as HTML (flow) or not.
*
* This is copied from:
* <https://spec.commonmark.org/0.30/#html-blocks>.
*
* > 👉 **Note**: `search` was added in `CommonMark@0.31`.
*/
var htmlBlockNames = [
	"address",
	"article",
	"aside",
	"base",
	"basefont",
	"blockquote",
	"body",
	"caption",
	"center",
	"col",
	"colgroup",
	"dd",
	"details",
	"dialog",
	"dir",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"frame",
	"frameset",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"head",
	"header",
	"hr",
	"html",
	"iframe",
	"legend",
	"li",
	"link",
	"main",
	"menu",
	"menuitem",
	"nav",
	"noframes",
	"ol",
	"optgroup",
	"option",
	"p",
	"param",
	"search",
	"section",
	"summary",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"title",
	"tr",
	"track",
	"ul"
];
/**
* List of lowercase HTML “raw” tag names.
*
* The list, when parsing HTML (flow), results in HTML that can include lines
* without exiting, until a closing tag also in this list is found (condition
* 1).
*
* This module is copied from:
* <https://spec.commonmark.org/0.30/#html-blocks>.
*
* > 👉 **Note**: `textarea` was added in `CommonMark@0.30`.
*/
var htmlRawNames = [
	"pre",
	"script",
	"style",
	"textarea"
];
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/html-flow.js
/**
* @import {
*   Code,
*   Construct,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var htmlFlow = {
	concrete: true,
	name: "htmlFlow",
	resolveTo: resolveToHtmlFlow,
	tokenize: tokenizeHtmlFlow
};
/** @type {Construct} */
var blankLineBefore = {
	partial: true,
	tokenize: tokenizeBlankLineBefore
};
var nonLazyContinuationStart = {
	partial: true,
	tokenize: tokenizeNonLazyContinuationStart
};
/** @type {Resolver} */
function resolveToHtmlFlow(events) {
	let index = events.length;
	while (index--) if (events[index][0] === "enter" && events[index][1].type === "htmlFlow") break;
	if (index > 1 && events[index - 2][1].type === "linePrefix") {
		events[index][1].start = events[index - 2][1].start;
		events[index + 1][1].start = events[index - 2][1].start;
		events.splice(index - 2, 2);
	}
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeHtmlFlow(effects, ok, nok) {
	const self = this;
	/** @type {number} */
	let marker;
	/** @type {boolean} */
	let closingTag;
	/** @type {string} */
	let buffer;
	/** @type {number} */
	let index;
	/** @type {Code} */
	let markerB;
	return start;
	/**
	* Start of HTML (flow).
	*
	* ```markdown
	* > | <x />
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		return before(code);
	}
	/**
	* At `<`, after optional whitespace.
	*
	* ```markdown
	* > | <x />
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		effects.enter("htmlFlow");
		effects.enter("htmlFlowData");
		effects.consume(code);
		return open;
	}
	/**
	* After `<`, at tag name or other stuff.
	*
	* ```markdown
	* > | <x />
	*      ^
	* > | <!doctype>
	*      ^
	* > | <!--xxx-->
	*      ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (code === 33) {
			effects.consume(code);
			return declarationOpen;
		}
		if (code === 47) {
			effects.consume(code);
			closingTag = true;
			return tagCloseStart;
		}
		if (code === 63) {
			effects.consume(code);
			marker = 3;
			return self.interrupt ? ok : continuationDeclarationInside;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			buffer = String.fromCharCode(code);
			return tagName;
		}
		return nok(code);
	}
	/**
	* After `<!`, at declaration, comment, or CDATA.
	*
	* ```markdown
	* > | <!doctype>
	*       ^
	* > | <!--xxx-->
	*       ^
	* > | <![CDATA[>&<]]>
	*       ^
	* ```
	*
	* @type {State}
	*/
	function declarationOpen(code) {
		if (code === 45) {
			effects.consume(code);
			marker = 2;
			return commentOpenInside;
		}
		if (code === 91) {
			effects.consume(code);
			marker = 5;
			index = 0;
			return cdataOpenInside;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			marker = 4;
			return self.interrupt ? ok : continuationDeclarationInside;
		}
		return nok(code);
	}
	/**
	* After `<!-`, inside a comment, at another `-`.
	*
	* ```markdown
	* > | <!--xxx-->
	*        ^
	* ```
	*
	* @type {State}
	*/
	function commentOpenInside(code) {
		if (code === 45) {
			effects.consume(code);
			return self.interrupt ? ok : continuationDeclarationInside;
		}
		return nok(code);
	}
	/**
	* After `<![`, inside CDATA, expecting `CDATA[`.
	*
	* ```markdown
	* > | <![CDATA[>&<]]>
	*        ^^^^^^
	* ```
	*
	* @type {State}
	*/
	function cdataOpenInside(code) {
		if (code === "CDATA[".charCodeAt(index++)) {
			effects.consume(code);
			if (index === 6) return self.interrupt ? ok : continuation;
			return cdataOpenInside;
		}
		return nok(code);
	}
	/**
	* After `</`, in closing tag, at tag name.
	*
	* ```markdown
	* > | </x>
	*       ^
	* ```
	*
	* @type {State}
	*/
	function tagCloseStart(code) {
		if (asciiAlpha(code)) {
			effects.consume(code);
			buffer = String.fromCharCode(code);
			return tagName;
		}
		return nok(code);
	}
	/**
	* In tag name.
	*
	* ```markdown
	* > | <ab>
	*      ^^
	* > | </ab>
	*       ^^
	* ```
	*
	* @type {State}
	*/
	function tagName(code) {
		if (code === null || code === 47 || code === 62 || markdownLineEndingOrSpace(code)) {
			const slash = code === 47;
			const name = buffer.toLowerCase();
			if (!slash && !closingTag && htmlRawNames.includes(name)) {
				marker = 1;
				return self.interrupt ? ok(code) : continuation(code);
			}
			if (htmlBlockNames.includes(buffer.toLowerCase())) {
				marker = 6;
				if (slash) {
					effects.consume(code);
					return basicSelfClosing;
				}
				return self.interrupt ? ok(code) : continuation(code);
			}
			marker = 7;
			return self.interrupt && !self.parser.lazy[self.now().line] ? nok(code) : closingTag ? completeClosingTagAfter(code) : completeAttributeNameBefore(code);
		}
		if (code === 45 || asciiAlphanumeric(code)) {
			effects.consume(code);
			buffer += String.fromCharCode(code);
			return tagName;
		}
		return nok(code);
	}
	/**
	* After closing slash of a basic tag name.
	*
	* ```markdown
	* > | <div/>
	*          ^
	* ```
	*
	* @type {State}
	*/
	function basicSelfClosing(code) {
		if (code === 62) {
			effects.consume(code);
			return self.interrupt ? ok : continuation;
		}
		return nok(code);
	}
	/**
	* After closing slash of a complete tag name.
	*
	* ```markdown
	* > | <x/>
	*        ^
	* ```
	*
	* @type {State}
	*/
	function completeClosingTagAfter(code) {
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeClosingTagAfter;
		}
		return completeEnd(code);
	}
	/**
	* At an attribute name.
	*
	* At first, this state is used after a complete tag name, after whitespace,
	* where it expects optional attributes or the end of the tag.
	* It is also reused after attributes, when expecting more optional
	* attributes.
	*
	* ```markdown
	* > | <a />
	*        ^
	* > | <a :b>
	*        ^
	* > | <a _b>
	*        ^
	* > | <a b>
	*        ^
	* > | <a >
	*        ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeNameBefore(code) {
		if (code === 47) {
			effects.consume(code);
			return completeEnd;
		}
		if (code === 58 || code === 95 || asciiAlpha(code)) {
			effects.consume(code);
			return completeAttributeName;
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeAttributeNameBefore;
		}
		return completeEnd(code);
	}
	/**
	* In attribute name.
	*
	* ```markdown
	* > | <a :b>
	*         ^
	* > | <a _b>
	*         ^
	* > | <a b>
	*         ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeName(code) {
		if (code === 45 || code === 46 || code === 58 || code === 95 || asciiAlphanumeric(code)) {
			effects.consume(code);
			return completeAttributeName;
		}
		return completeAttributeNameAfter(code);
	}
	/**
	* After attribute name, at an optional initializer, the end of the tag, or
	* whitespace.
	*
	* ```markdown
	* > | <a b>
	*         ^
	* > | <a b=c>
	*         ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeNameAfter(code) {
		if (code === 61) {
			effects.consume(code);
			return completeAttributeValueBefore;
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeAttributeNameAfter;
		}
		return completeAttributeNameBefore(code);
	}
	/**
	* Before unquoted, double quoted, or single quoted attribute value, allowing
	* whitespace.
	*
	* ```markdown
	* > | <a b=c>
	*          ^
	* > | <a b="c">
	*          ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeValueBefore(code) {
		if (code === null || code === 60 || code === 61 || code === 62 || code === 96) return nok(code);
		if (code === 34 || code === 39) {
			effects.consume(code);
			markerB = code;
			return completeAttributeValueQuoted;
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeAttributeValueBefore;
		}
		return completeAttributeValueUnquoted(code);
	}
	/**
	* In double or single quoted attribute value.
	*
	* ```markdown
	* > | <a b="c">
	*           ^
	* > | <a b='c'>
	*           ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeValueQuoted(code) {
		if (code === markerB) {
			effects.consume(code);
			markerB = null;
			return completeAttributeValueQuotedAfter;
		}
		if (code === null || markdownLineEnding(code)) return nok(code);
		effects.consume(code);
		return completeAttributeValueQuoted;
	}
	/**
	* In unquoted attribute value.
	*
	* ```markdown
	* > | <a b=c>
	*          ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeValueUnquoted(code) {
		if (code === null || code === 34 || code === 39 || code === 47 || code === 60 || code === 61 || code === 62 || code === 96 || markdownLineEndingOrSpace(code)) return completeAttributeNameAfter(code);
		effects.consume(code);
		return completeAttributeValueUnquoted;
	}
	/**
	* After double or single quoted attribute value, before whitespace or the
	* end of the tag.
	*
	* ```markdown
	* > | <a b="c">
	*            ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeValueQuotedAfter(code) {
		if (code === 47 || code === 62 || markdownSpace(code)) return completeAttributeNameBefore(code);
		return nok(code);
	}
	/**
	* In certain circumstances of a complete tag where only an `>` is allowed.
	*
	* ```markdown
	* > | <a b="c">
	*             ^
	* ```
	*
	* @type {State}
	*/
	function completeEnd(code) {
		if (code === 62) {
			effects.consume(code);
			return completeAfter;
		}
		return nok(code);
	}
	/**
	* After `>` in a complete tag.
	*
	* ```markdown
	* > | <x>
	*        ^
	* ```
	*
	* @type {State}
	*/
	function completeAfter(code) {
		if (code === null || markdownLineEnding(code)) return continuation(code);
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeAfter;
		}
		return nok(code);
	}
	/**
	* In continuation of any HTML kind.
	*
	* ```markdown
	* > | <!--xxx-->
	*          ^
	* ```
	*
	* @type {State}
	*/
	function continuation(code) {
		if (code === 45 && marker === 2) {
			effects.consume(code);
			return continuationCommentInside;
		}
		if (code === 60 && marker === 1) {
			effects.consume(code);
			return continuationRawTagOpen;
		}
		if (code === 62 && marker === 4) {
			effects.consume(code);
			return continuationClose;
		}
		if (code === 63 && marker === 3) {
			effects.consume(code);
			return continuationDeclarationInside;
		}
		if (code === 93 && marker === 5) {
			effects.consume(code);
			return continuationCdataInside;
		}
		if (markdownLineEnding(code) && (marker === 6 || marker === 7)) {
			effects.exit("htmlFlowData");
			return effects.check(blankLineBefore, continuationAfter, continuationStart)(code);
		}
		if (code === null || markdownLineEnding(code)) {
			effects.exit("htmlFlowData");
			return continuationStart(code);
		}
		effects.consume(code);
		return continuation;
	}
	/**
	* In continuation, at eol.
	*
	* ```markdown
	* > | <x>
	*        ^
	*   | asd
	* ```
	*
	* @type {State}
	*/
	function continuationStart(code) {
		return effects.check(nonLazyContinuationStart, continuationStartNonLazy, continuationAfter)(code);
	}
	/**
	* In continuation, at eol, before non-lazy content.
	*
	* ```markdown
	* > | <x>
	*        ^
	*   | asd
	* ```
	*
	* @type {State}
	*/
	function continuationStartNonLazy(code) {
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return continuationBefore;
	}
	/**
	* In continuation, before non-lazy content.
	*
	* ```markdown
	*   | <x>
	* > | asd
	*     ^
	* ```
	*
	* @type {State}
	*/
	function continuationBefore(code) {
		if (code === null || markdownLineEnding(code)) return continuationStart(code);
		effects.enter("htmlFlowData");
		return continuation(code);
	}
	/**
	* In comment continuation, after one `-`, expecting another.
	*
	* ```markdown
	* > | <!--xxx-->
	*             ^
	* ```
	*
	* @type {State}
	*/
	function continuationCommentInside(code) {
		if (code === 45) {
			effects.consume(code);
			return continuationDeclarationInside;
		}
		return continuation(code);
	}
	/**
	* In raw continuation, after `<`, at `/`.
	*
	* ```markdown
	* > | <script>console.log(1)<\/script>
	*                            ^
	* ```
	*
	* @type {State}
	*/
	function continuationRawTagOpen(code) {
		if (code === 47) {
			effects.consume(code);
			buffer = "";
			return continuationRawEndTag;
		}
		return continuation(code);
	}
	/**
	* In raw continuation, after `</`, in a raw tag name.
	*
	* ```markdown
	* > | <script>console.log(1)<\/script>
	*                             ^^^^^^
	* ```
	*
	* @type {State}
	*/
	function continuationRawEndTag(code) {
		if (code === 62) {
			const name = buffer.toLowerCase();
			if (htmlRawNames.includes(name)) {
				effects.consume(code);
				return continuationClose;
			}
			return continuation(code);
		}
		if (asciiAlpha(code) && buffer.length < 8) {
			effects.consume(code);
			buffer += String.fromCharCode(code);
			return continuationRawEndTag;
		}
		return continuation(code);
	}
	/**
	* In cdata continuation, after `]`, expecting `]>`.
	*
	* ```markdown
	* > | <![CDATA[>&<]]>
	*                  ^
	* ```
	*
	* @type {State}
	*/
	function continuationCdataInside(code) {
		if (code === 93) {
			effects.consume(code);
			return continuationDeclarationInside;
		}
		return continuation(code);
	}
	/**
	* In declaration or instruction continuation, at `>`.
	*
	* ```markdown
	* > | <!-->
	*         ^
	* > | <?>
	*       ^
	* > | <!q>
	*        ^
	* > | <!--ab-->
	*             ^
	* > | <![CDATA[>&<]]>
	*                   ^
	* ```
	*
	* @type {State}
	*/
	function continuationDeclarationInside(code) {
		if (code === 62) {
			effects.consume(code);
			return continuationClose;
		}
		if (code === 45 && marker === 2) {
			effects.consume(code);
			return continuationDeclarationInside;
		}
		return continuation(code);
	}
	/**
	* In closed continuation: everything we get until the eol/eof is part of it.
	*
	* ```markdown
	* > | <!doctype>
	*               ^
	* ```
	*
	* @type {State}
	*/
	function continuationClose(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("htmlFlowData");
			return continuationAfter(code);
		}
		effects.consume(code);
		return continuationClose;
	}
	/**
	* Done.
	*
	* ```markdown
	* > | <!doctype>
	*               ^
	* ```
	*
	* @type {State}
	*/
	function continuationAfter(code) {
		effects.exit("htmlFlow");
		return ok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeNonLazyContinuationStart(effects, ok, nok) {
	const self = this;
	return start;
	/**
	* At eol, before continuation.
	*
	* ```markdown
	* > | * ```js
	*            ^
	*   | b
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return after;
		}
		return nok(code);
	}
	/**
	* A continuation.
	*
	* ```markdown
	*   | * ```js
	* > | b
	*     ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeBlankLineBefore(effects, ok, nok) {
	return start;
	/**
	* Before eol, expecting blank line.
	*
	* ```markdown
	* > | <div>
	*          ^
	*   |
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return effects.attempt(blankLine, ok, nok);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/html-text.js
/**
* @import {
*   Code,
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var htmlText = {
	name: "htmlText",
	tokenize: tokenizeHtmlText
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeHtmlText(effects, ok, nok) {
	const self = this;
	/** @type {NonNullable<Code> | undefined} */
	let marker;
	/** @type {number} */
	let index;
	/** @type {State} */
	let returnState;
	return start;
	/**
	* Start of HTML (text).
	*
	* ```markdown
	* > | a <b> c
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("htmlText");
		effects.enter("htmlTextData");
		effects.consume(code);
		return open;
	}
	/**
	* After `<`, at tag name or other stuff.
	*
	* ```markdown
	* > | a <b> c
	*        ^
	* > | a <!doctype> c
	*        ^
	* > | a <!--b--> c
	*        ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (code === 33) {
			effects.consume(code);
			return declarationOpen;
		}
		if (code === 47) {
			effects.consume(code);
			return tagCloseStart;
		}
		if (code === 63) {
			effects.consume(code);
			return instruction;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			return tagOpen;
		}
		return nok(code);
	}
	/**
	* After `<!`, at declaration, comment, or CDATA.
	*
	* ```markdown
	* > | a <!doctype> c
	*         ^
	* > | a <!--b--> c
	*         ^
	* > | a <![CDATA[>&<]]> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function declarationOpen(code) {
		if (code === 45) {
			effects.consume(code);
			return commentOpenInside;
		}
		if (code === 91) {
			effects.consume(code);
			index = 0;
			return cdataOpenInside;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			return declaration;
		}
		return nok(code);
	}
	/**
	* In a comment, after `<!-`, at another `-`.
	*
	* ```markdown
	* > | a <!--b--> c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function commentOpenInside(code) {
		if (code === 45) {
			effects.consume(code);
			return commentEnd;
		}
		return nok(code);
	}
	/**
	* In comment.
	*
	* ```markdown
	* > | a <!--b--> c
	*           ^
	* ```
	*
	* @type {State}
	*/
	function comment(code) {
		if (code === null) return nok(code);
		if (code === 45) {
			effects.consume(code);
			return commentClose;
		}
		if (markdownLineEnding(code)) {
			returnState = comment;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return comment;
	}
	/**
	* In comment, after `-`.
	*
	* ```markdown
	* > | a <!--b--> c
	*             ^
	* ```
	*
	* @type {State}
	*/
	function commentClose(code) {
		if (code === 45) {
			effects.consume(code);
			return commentEnd;
		}
		return comment(code);
	}
	/**
	* In comment, after `--`.
	*
	* ```markdown
	* > | a <!--b--> c
	*              ^
	* ```
	*
	* @type {State}
	*/
	function commentEnd(code) {
		return code === 62 ? end(code) : code === 45 ? commentClose(code) : comment(code);
	}
	/**
	* After `<![`, in CDATA, expecting `CDATA[`.
	*
	* ```markdown
	* > | a <![CDATA[>&<]]> b
	*          ^^^^^^
	* ```
	*
	* @type {State}
	*/
	function cdataOpenInside(code) {
		if (code === "CDATA[".charCodeAt(index++)) {
			effects.consume(code);
			return index === 6 ? cdata : cdataOpenInside;
		}
		return nok(code);
	}
	/**
	* In CDATA.
	*
	* ```markdown
	* > | a <![CDATA[>&<]]> b
	*                ^^^
	* ```
	*
	* @type {State}
	*/
	function cdata(code) {
		if (code === null) return nok(code);
		if (code === 93) {
			effects.consume(code);
			return cdataClose;
		}
		if (markdownLineEnding(code)) {
			returnState = cdata;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return cdata;
	}
	/**
	* In CDATA, after `]`, at another `]`.
	*
	* ```markdown
	* > | a <![CDATA[>&<]]> b
	*                    ^
	* ```
	*
	* @type {State}
	*/
	function cdataClose(code) {
		if (code === 93) {
			effects.consume(code);
			return cdataEnd;
		}
		return cdata(code);
	}
	/**
	* In CDATA, after `]]`, at `>`.
	*
	* ```markdown
	* > | a <![CDATA[>&<]]> b
	*                     ^
	* ```
	*
	* @type {State}
	*/
	function cdataEnd(code) {
		if (code === 62) return end(code);
		if (code === 93) {
			effects.consume(code);
			return cdataEnd;
		}
		return cdata(code);
	}
	/**
	* In declaration.
	*
	* ```markdown
	* > | a <!b> c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function declaration(code) {
		if (code === null || code === 62) return end(code);
		if (markdownLineEnding(code)) {
			returnState = declaration;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return declaration;
	}
	/**
	* In instruction.
	*
	* ```markdown
	* > | a <?b?> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function instruction(code) {
		if (code === null) return nok(code);
		if (code === 63) {
			effects.consume(code);
			return instructionClose;
		}
		if (markdownLineEnding(code)) {
			returnState = instruction;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return instruction;
	}
	/**
	* In instruction, after `?`, at `>`.
	*
	* ```markdown
	* > | a <?b?> c
	*           ^
	* ```
	*
	* @type {State}
	*/
	function instructionClose(code) {
		return code === 62 ? end(code) : instruction(code);
	}
	/**
	* After `</`, in closing tag, at tag name.
	*
	* ```markdown
	* > | a </b> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function tagCloseStart(code) {
		if (asciiAlpha(code)) {
			effects.consume(code);
			return tagClose;
		}
		return nok(code);
	}
	/**
	* After `</x`, in a tag name.
	*
	* ```markdown
	* > | a </b> c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function tagClose(code) {
		if (code === 45 || asciiAlphanumeric(code)) {
			effects.consume(code);
			return tagClose;
		}
		return tagCloseBetween(code);
	}
	/**
	* In closing tag, after tag name.
	*
	* ```markdown
	* > | a </b> c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function tagCloseBetween(code) {
		if (markdownLineEnding(code)) {
			returnState = tagCloseBetween;
			return lineEndingBefore(code);
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return tagCloseBetween;
		}
		return end(code);
	}
	/**
	* After `<x`, in opening tag name.
	*
	* ```markdown
	* > | a <b> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function tagOpen(code) {
		if (code === 45 || asciiAlphanumeric(code)) {
			effects.consume(code);
			return tagOpen;
		}
		if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
		return nok(code);
	}
	/**
	* In opening tag, after tag name.
	*
	* ```markdown
	* > | a <b> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenBetween(code) {
		if (code === 47) {
			effects.consume(code);
			return end;
		}
		if (code === 58 || code === 95 || asciiAlpha(code)) {
			effects.consume(code);
			return tagOpenAttributeName;
		}
		if (markdownLineEnding(code)) {
			returnState = tagOpenBetween;
			return lineEndingBefore(code);
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return tagOpenBetween;
		}
		return end(code);
	}
	/**
	* In attribute name.
	*
	* ```markdown
	* > | a <b c> d
	*          ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeName(code) {
		if (code === 45 || code === 46 || code === 58 || code === 95 || asciiAlphanumeric(code)) {
			effects.consume(code);
			return tagOpenAttributeName;
		}
		return tagOpenAttributeNameAfter(code);
	}
	/**
	* After attribute name, before initializer, the end of the tag, or
	* whitespace.
	*
	* ```markdown
	* > | a <b c> d
	*           ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeNameAfter(code) {
		if (code === 61) {
			effects.consume(code);
			return tagOpenAttributeValueBefore;
		}
		if (markdownLineEnding(code)) {
			returnState = tagOpenAttributeNameAfter;
			return lineEndingBefore(code);
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return tagOpenAttributeNameAfter;
		}
		return tagOpenBetween(code);
	}
	/**
	* Before unquoted, double quoted, or single quoted attribute value, allowing
	* whitespace.
	*
	* ```markdown
	* > | a <b c=d> e
	*            ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeValueBefore(code) {
		if (code === null || code === 60 || code === 61 || code === 62 || code === 96) return nok(code);
		if (code === 34 || code === 39) {
			effects.consume(code);
			marker = code;
			return tagOpenAttributeValueQuoted;
		}
		if (markdownLineEnding(code)) {
			returnState = tagOpenAttributeValueBefore;
			return lineEndingBefore(code);
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return tagOpenAttributeValueBefore;
		}
		effects.consume(code);
		return tagOpenAttributeValueUnquoted;
	}
	/**
	* In double or single quoted attribute value.
	*
	* ```markdown
	* > | a <b c="d"> e
	*             ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeValueQuoted(code) {
		if (code === marker) {
			effects.consume(code);
			marker = void 0;
			return tagOpenAttributeValueQuotedAfter;
		}
		if (code === null) return nok(code);
		if (markdownLineEnding(code)) {
			returnState = tagOpenAttributeValueQuoted;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return tagOpenAttributeValueQuoted;
	}
	/**
	* In unquoted attribute value.
	*
	* ```markdown
	* > | a <b c=d> e
	*            ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeValueUnquoted(code) {
		if (code === null || code === 34 || code === 39 || code === 60 || code === 61 || code === 96) return nok(code);
		if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
		effects.consume(code);
		return tagOpenAttributeValueUnquoted;
	}
	/**
	* After double or single quoted attribute value, before whitespace or the end
	* of the tag.
	*
	* ```markdown
	* > | a <b c="d"> e
	*               ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeValueQuotedAfter(code) {
		if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
		return nok(code);
	}
	/**
	* In certain circumstances of a tag where only an `>` is allowed.
	*
	* ```markdown
	* > | a <b c="d"> e
	*               ^
	* ```
	*
	* @type {State}
	*/
	function end(code) {
		if (code === 62) {
			effects.consume(code);
			effects.exit("htmlTextData");
			effects.exit("htmlText");
			return ok;
		}
		return nok(code);
	}
	/**
	* At eol.
	*
	* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
	* > empty tokens.
	*
	* ```markdown
	* > | a <!--a
	*            ^
	*   | b-->
	* ```
	*
	* @type {State}
	*/
	function lineEndingBefore(code) {
		effects.exit("htmlTextData");
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return lineEndingAfter;
	}
	/**
	* After eol, at optional whitespace.
	*
	* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
	* > empty tokens.
	*
	* ```markdown
	*   | a <!--a
	* > | b-->
	*     ^
	* ```
	*
	* @type {State}
	*/
	function lineEndingAfter(code) {
		return markdownSpace(code) ? factorySpace(effects, lineEndingAfterPrefix, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code) : lineEndingAfterPrefix(code);
	}
	/**
	* After eol, after optional whitespace.
	*
	* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
	* > empty tokens.
	*
	* ```markdown
	*   | a <!--a
	* > | b-->
	*     ^
	* ```
	*
	* @type {State}
	*/
	function lineEndingAfterPrefix(code) {
		effects.enter("htmlTextData");
		return returnState(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/label-end.js
/**
* @import {
*   Construct,
*   Event,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var labelEnd = {
	name: "labelEnd",
	resolveAll: resolveAllLabelEnd,
	resolveTo: resolveToLabelEnd,
	tokenize: tokenizeLabelEnd
};
/** @type {Construct} */
var resourceConstruct = { tokenize: tokenizeResource };
/** @type {Construct} */
var referenceFullConstruct = { tokenize: tokenizeReferenceFull };
/** @type {Construct} */
var referenceCollapsedConstruct = { tokenize: tokenizeReferenceCollapsed };
/** @type {Resolver} */
function resolveAllLabelEnd(events) {
	let index = -1;
	/** @type {Array<Event>} */
	const newEvents = [];
	while (++index < events.length) {
		const token = events[index][1];
		newEvents.push(events[index]);
		if (token.type === "labelImage" || token.type === "labelLink" || token.type === "labelEnd") {
			const offset = token.type === "labelImage" ? 4 : 2;
			token.type = "data";
			index += offset;
		}
	}
	if (events.length !== newEvents.length) splice(events, 0, events.length, newEvents);
	return events;
}
/** @type {Resolver} */
function resolveToLabelEnd(events, context) {
	let index = events.length;
	let offset = 0;
	/** @type {Token} */
	let token;
	/** @type {number | undefined} */
	let open;
	/** @type {number | undefined} */
	let close;
	/** @type {Array<Event>} */
	let media;
	while (index--) {
		token = events[index][1];
		if (open) {
			if (token.type === "link" || token.type === "labelLink" && token._inactive) break;
			if (events[index][0] === "enter" && token.type === "labelLink") token._inactive = true;
		} else if (close) {
			if (events[index][0] === "enter" && (token.type === "labelImage" || token.type === "labelLink") && !token._balanced) {
				open = index;
				if (token.type !== "labelLink") {
					offset = 2;
					break;
				}
			}
		} else if (token.type === "labelEnd") close = index;
	}
	const group = {
		type: events[open][1].type === "labelLink" ? "link" : "image",
		start: { ...events[open][1].start },
		end: { ...events[events.length - 1][1].end }
	};
	const label = {
		type: "label",
		start: { ...events[open][1].start },
		end: { ...events[close][1].end }
	};
	const text = {
		type: "labelText",
		start: { ...events[open + offset + 2][1].end },
		end: { ...events[close - 2][1].start }
	};
	media = [[
		"enter",
		group,
		context
	], [
		"enter",
		label,
		context
	]];
	media = push(media, events.slice(open + 1, open + offset + 3));
	media = push(media, [[
		"enter",
		text,
		context
	]]);
	media = push(media, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + offset + 4, close - 3), context));
	media = push(media, [
		[
			"exit",
			text,
			context
		],
		events[close - 2],
		events[close - 1],
		[
			"exit",
			label,
			context
		]
	]);
	media = push(media, events.slice(close + 1));
	media = push(media, [[
		"exit",
		group,
		context
	]]);
	splice(events, open, events.length, media);
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeLabelEnd(effects, ok, nok) {
	const self = this;
	let index = self.events.length;
	/** @type {Token} */
	let labelStart;
	/** @type {boolean} */
	let defined;
	while (index--) if ((self.events[index][1].type === "labelImage" || self.events[index][1].type === "labelLink") && !self.events[index][1]._balanced) {
		labelStart = self.events[index][1];
		break;
	}
	return start;
	/**
	* Start of label end.
	*
	* ```markdown
	* > | [a](b) c
	*       ^
	* > | [a][b] c
	*       ^
	* > | [a][] b
	*       ^
	* > | [a] b
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (!labelStart) return nok(code);
		if (labelStart._inactive) return labelEndNok(code);
		defined = self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize({
			start: labelStart.end,
			end: self.now()
		})));
		effects.enter("labelEnd");
		effects.enter("labelMarker");
		effects.consume(code);
		effects.exit("labelMarker");
		effects.exit("labelEnd");
		return after;
	}
	/**
	* After `]`.
	*
	* ```markdown
	* > | [a](b) c
	*       ^
	* > | [a][b] c
	*       ^
	* > | [a][] b
	*       ^
	* > | [a] b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		if (code === 40) return effects.attempt(resourceConstruct, labelEndOk, defined ? labelEndOk : labelEndNok)(code);
		if (code === 91) return effects.attempt(referenceFullConstruct, labelEndOk, defined ? referenceNotFull : labelEndNok)(code);
		return defined ? labelEndOk(code) : labelEndNok(code);
	}
	/**
	* After `]`, at `[`, but not at a full reference.
	*
	* > 👉 **Note**: we only get here if the label is defined.
	*
	* ```markdown
	* > | [a][] b
	*        ^
	* > | [a] b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function referenceNotFull(code) {
		return effects.attempt(referenceCollapsedConstruct, labelEndOk, labelEndNok)(code);
	}
	/**
	* Done, we found something.
	*
	* ```markdown
	* > | [a](b) c
	*           ^
	* > | [a][b] c
	*           ^
	* > | [a][] b
	*          ^
	* > | [a] b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function labelEndOk(code) {
		return ok(code);
	}
	/**
	* Done, it’s nothing.
	*
	* There was an okay opening, but we didn’t match anything.
	*
	* ```markdown
	* > | [a](b c
	*        ^
	* > | [a][b c
	*        ^
	* > | [a] b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function labelEndNok(code) {
		labelStart._balanced = true;
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeResource(effects, ok, nok) {
	return resourceStart;
	/**
	* At a resource.
	*
	* ```markdown
	* > | [a](b) c
	*        ^
	* ```
	*
	* @type {State}
	*/
	function resourceStart(code) {
		effects.enter("resource");
		effects.enter("resourceMarker");
		effects.consume(code);
		effects.exit("resourceMarker");
		return resourceBefore;
	}
	/**
	* In resource, after `(`, at optional whitespace.
	*
	* ```markdown
	* > | [a](b) c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function resourceBefore(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceOpen)(code) : resourceOpen(code);
	}
	/**
	* In resource, after optional whitespace, at `)` or a destination.
	*
	* ```markdown
	* > | [a](b) c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function resourceOpen(code) {
		if (code === 41) return resourceEnd(code);
		return factoryDestination(effects, resourceDestinationAfter, resourceDestinationMissing, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(code);
	}
	/**
	* In resource, after destination, at optional whitespace.
	*
	* ```markdown
	* > | [a](b) c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function resourceDestinationAfter(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceBetween)(code) : resourceEnd(code);
	}
	/**
	* At invalid destination.
	*
	* ```markdown
	* > | [a](<<) b
	*         ^
	* ```
	*
	* @type {State}
	*/
	function resourceDestinationMissing(code) {
		return nok(code);
	}
	/**
	* In resource, after destination and whitespace, at `(` or title.
	*
	* ```markdown
	* > | [a](b ) c
	*           ^
	* ```
	*
	* @type {State}
	*/
	function resourceBetween(code) {
		if (code === 34 || code === 39 || code === 40) return factoryTitle(effects, resourceTitleAfter, nok, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(code);
		return resourceEnd(code);
	}
	/**
	* In resource, after title, at optional whitespace.
	*
	* ```markdown
	* > | [a](b "c") d
	*              ^
	* ```
	*
	* @type {State}
	*/
	function resourceTitleAfter(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceEnd)(code) : resourceEnd(code);
	}
	/**
	* In resource, at `)`.
	*
	* ```markdown
	* > | [a](b) d
	*          ^
	* ```
	*
	* @type {State}
	*/
	function resourceEnd(code) {
		if (code === 41) {
			effects.enter("resourceMarker");
			effects.consume(code);
			effects.exit("resourceMarker");
			effects.exit("resource");
			return ok;
		}
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeReferenceFull(effects, ok, nok) {
	const self = this;
	return referenceFull;
	/**
	* In a reference (full), at the `[`.
	*
	* ```markdown
	* > | [a][b] d
	*        ^
	* ```
	*
	* @type {State}
	*/
	function referenceFull(code) {
		return factoryLabel.call(self, effects, referenceFullAfter, referenceFullMissing, "reference", "referenceMarker", "referenceString")(code);
	}
	/**
	* In a reference (full), after `]`.
	*
	* ```markdown
	* > | [a][b] d
	*          ^
	* ```
	*
	* @type {State}
	*/
	function referenceFullAfter(code) {
		return self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize(self.events[self.events.length - 1][1]).slice(1, -1))) ? ok(code) : nok(code);
	}
	/**
	* In reference (full) that was missing.
	*
	* ```markdown
	* > | [a][b d
	*        ^
	* ```
	*
	* @type {State}
	*/
	function referenceFullMissing(code) {
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeReferenceCollapsed(effects, ok, nok) {
	return referenceCollapsedStart;
	/**
	* In reference (collapsed), at `[`.
	*
	* > 👉 **Note**: we only get here if the label is defined.
	*
	* ```markdown
	* > | [a][] d
	*        ^
	* ```
	*
	* @type {State}
	*/
	function referenceCollapsedStart(code) {
		effects.enter("reference");
		effects.enter("referenceMarker");
		effects.consume(code);
		effects.exit("referenceMarker");
		return referenceCollapsedOpen;
	}
	/**
	* In reference (collapsed), at `]`.
	*
	* > 👉 **Note**: we only get here if the label is defined.
	*
	* ```markdown
	* > | [a][] d
	*         ^
	* ```
	*
	*  @type {State}
	*/
	function referenceCollapsedOpen(code) {
		if (code === 93) {
			effects.enter("referenceMarker");
			effects.consume(code);
			effects.exit("referenceMarker");
			effects.exit("reference");
			return ok;
		}
		return nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/label-start-image.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var labelStartImage = {
	name: "labelStartImage",
	resolveAll: labelEnd.resolveAll,
	tokenize: tokenizeLabelStartImage
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeLabelStartImage(effects, ok, nok) {
	const self = this;
	return start;
	/**
	* Start of label (image) start.
	*
	* ```markdown
	* > | a ![b] c
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("labelImage");
		effects.enter("labelImageMarker");
		effects.consume(code);
		effects.exit("labelImageMarker");
		return open;
	}
	/**
	* After `!`, at `[`.
	*
	* ```markdown
	* > | a ![b] c
	*        ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (code === 91) {
			effects.enter("labelMarker");
			effects.consume(code);
			effects.exit("labelMarker");
			effects.exit("labelImage");
			return after;
		}
		return nok(code);
	}
	/**
	* After `![`.
	*
	* ```markdown
	* > | a ![b] c
	*         ^
	* ```
	*
	* This is needed in because, when GFM footnotes are enabled, images never
	* form when started with a `^`.
	* Instead, links form:
	*
	* ```markdown
	* ![^a](b)
	*
	* ![^a][b]
	*
	* [b]: c
	* ```
	*
	* ```html
	* <p>!<a href=\"b\">^a</a></p>
	* <p>!<a href=\"c\">^a</a></p>
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		/* c8 ignore next 3 */
		return code === 94 && "_hiddenFootnoteSupport" in self.parser.constructs ? nok(code) : ok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/label-start-link.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var labelStartLink = {
	name: "labelStartLink",
	resolveAll: labelEnd.resolveAll,
	tokenize: tokenizeLabelStartLink
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeLabelStartLink(effects, ok, nok) {
	const self = this;
	return start;
	/**
	* Start of label (link) start.
	*
	* ```markdown
	* > | a [b] c
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("labelLink");
		effects.enter("labelMarker");
		effects.consume(code);
		effects.exit("labelMarker");
		effects.exit("labelLink");
		return after;
	}
	/** @type {State} */
	function after(code) {
		/* c8 ignore next 3 */
		return code === 94 && "_hiddenFootnoteSupport" in self.parser.constructs ? nok(code) : ok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/line-ending.js
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var lineEnding = {
	name: "lineEnding",
	tokenize: tokenizeLineEnding
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeLineEnding(effects, ok) {
	return start;
	/** @type {State} */
	function start(code) {
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return factorySpace(effects, ok, "linePrefix");
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/thematic-break.js
/**
* @import {
*   Code,
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var thematicBreak$2 = {
	name: "thematicBreak",
	tokenize: tokenizeThematicBreak
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeThematicBreak(effects, ok, nok) {
	let size = 0;
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Start of thematic break.
	*
	* ```markdown
	* > | ***
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("thematicBreak");
		return before(code);
	}
	/**
	* After optional whitespace, at marker.
	*
	* ```markdown
	* > | ***
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		marker = code;
		return atBreak(code);
	}
	/**
	* After something, before something else.
	*
	* ```markdown
	* > | ***
	*     ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (code === marker) {
			effects.enter("thematicBreakSequence");
			return sequence(code);
		}
		if (size >= 3 && (code === null || markdownLineEnding(code))) {
			effects.exit("thematicBreak");
			return ok(code);
		}
		return nok(code);
	}
	/**
	* In sequence.
	*
	* ```markdown
	* > | ***
	*     ^
	* ```
	*
	* @type {State}
	*/
	function sequence(code) {
		if (code === marker) {
			effects.consume(code);
			size++;
			return sequence;
		}
		effects.exit("thematicBreakSequence");
		return markdownSpace(code) ? factorySpace(effects, atBreak, "whitespace")(code) : atBreak(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/list.js
/**
* @import {
*   Code,
*   Construct,
*   Exiter,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var list$2 = {
	continuation: { tokenize: tokenizeListContinuation },
	exit: tokenizeListEnd,
	name: "list",
	tokenize: tokenizeListStart
};
/** @type {Construct} */
var listItemPrefixWhitespaceConstruct = {
	partial: true,
	tokenize: tokenizeListItemPrefixWhitespace
};
/** @type {Construct} */
var indentConstruct = {
	partial: true,
	tokenize: tokenizeIndent$1
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeListStart(effects, ok, nok) {
	const self = this;
	const tail = self.events[self.events.length - 1];
	let initialSize = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
	let size = 0;
	return start;
	/** @type {State} */
	function start(code) {
		const kind = self.containerState.type || (code === 42 || code === 43 || code === 45 ? "listUnordered" : "listOrdered");
		if (kind === "listUnordered" ? !self.containerState.marker || code === self.containerState.marker : asciiDigit(code)) {
			if (!self.containerState.type) {
				self.containerState.type = kind;
				effects.enter(kind, { _container: true });
			}
			if (kind === "listUnordered") {
				effects.enter("listItemPrefix");
				return code === 42 || code === 45 ? effects.check(thematicBreak$2, nok, atMarker)(code) : atMarker(code);
			}
			if (!self.interrupt || code === 49) {
				effects.enter("listItemPrefix");
				effects.enter("listItemValue");
				return inside(code);
			}
		}
		return nok(code);
	}
	/** @type {State} */
	function inside(code) {
		if (asciiDigit(code) && ++size < 10) {
			effects.consume(code);
			return inside;
		}
		if ((!self.interrupt || size < 2) && (self.containerState.marker ? code === self.containerState.marker : code === 41 || code === 46)) {
			effects.exit("listItemValue");
			return atMarker(code);
		}
		return nok(code);
	}
	/**
	* @type {State}
	**/
	function atMarker(code) {
		effects.enter("listItemMarker");
		effects.consume(code);
		effects.exit("listItemMarker");
		self.containerState.marker = self.containerState.marker || code;
		return effects.check(blankLine, self.interrupt ? nok : onBlank, effects.attempt(listItemPrefixWhitespaceConstruct, endOfPrefix, otherPrefix));
	}
	/** @type {State} */
	function onBlank(code) {
		self.containerState.initialBlankLine = true;
		initialSize++;
		return endOfPrefix(code);
	}
	/** @type {State} */
	function otherPrefix(code) {
		if (markdownSpace(code)) {
			effects.enter("listItemPrefixWhitespace");
			effects.consume(code);
			effects.exit("listItemPrefixWhitespace");
			return endOfPrefix;
		}
		return nok(code);
	}
	/** @type {State} */
	function endOfPrefix(code) {
		self.containerState.size = initialSize + self.sliceSerialize(effects.exit("listItemPrefix"), true).length;
		return ok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeListContinuation(effects, ok, nok) {
	const self = this;
	self.containerState._closeFlow = void 0;
	return effects.check(blankLine, onBlank, notBlank);
	/** @type {State} */
	function onBlank(code) {
		self.containerState.furtherBlankLines = self.containerState.furtherBlankLines || self.containerState.initialBlankLine;
		return factorySpace(effects, ok, "listItemIndent", self.containerState.size + 1)(code);
	}
	/** @type {State} */
	function notBlank(code) {
		if (self.containerState.furtherBlankLines || !markdownSpace(code)) {
			self.containerState.furtherBlankLines = void 0;
			self.containerState.initialBlankLine = void 0;
			return notInCurrentItem(code);
		}
		self.containerState.furtherBlankLines = void 0;
		self.containerState.initialBlankLine = void 0;
		return effects.attempt(indentConstruct, ok, notInCurrentItem)(code);
	}
	/** @type {State} */
	function notInCurrentItem(code) {
		self.containerState._closeFlow = true;
		self.interrupt = void 0;
		return factorySpace(effects, effects.attempt(list$2, ok, nok), "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeIndent$1(effects, ok, nok) {
	const self = this;
	return factorySpace(effects, afterPrefix, "listItemIndent", self.containerState.size + 1);
	/** @type {State} */
	function afterPrefix(code) {
		const tail = self.events[self.events.length - 1];
		return tail && tail[1].type === "listItemIndent" && tail[2].sliceSerialize(tail[1], true).length === self.containerState.size ? ok(code) : nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Exiter}
*/
function tokenizeListEnd(effects) {
	effects.exit(this.containerState.type);
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeListItemPrefixWhitespace(effects, ok, nok) {
	const self = this;
	return factorySpace(effects, afterPrefix, "listItemPrefixWhitespace", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 5);
	/** @type {State} */
	function afterPrefix(code) {
		const tail = self.events[self.events.length - 1];
		return !markdownSpace(code) && tail && tail[1].type === "listItemPrefixWhitespace" ? ok(code) : nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-core-commonmark/lib/setext-underline.js
/**
* @import {
*   Code,
*   Construct,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
var setextUnderline = {
	name: "setextUnderline",
	resolveTo: resolveToSetextUnderline,
	tokenize: tokenizeSetextUnderline
};
/** @type {Resolver} */
function resolveToSetextUnderline(events, context) {
	let index = events.length;
	/** @type {number | undefined} */
	let content;
	/** @type {number | undefined} */
	let text;
	/** @type {number | undefined} */
	let definition;
	while (index--) if (events[index][0] === "enter") {
		if (events[index][1].type === "content") {
			content = index;
			break;
		}
		if (events[index][1].type === "paragraph") text = index;
	} else {
		if (events[index][1].type === "content") events.splice(index, 1);
		if (!definition && events[index][1].type === "definition") definition = index;
	}
	const heading = {
		type: "setextHeading",
		start: { ...events[content][1].start },
		end: { ...events[events.length - 1][1].end }
	};
	events[text][1].type = "setextHeadingText";
	if (definition) {
		events.splice(text, 0, [
			"enter",
			heading,
			context
		]);
		events.splice(definition + 1, 0, [
			"exit",
			events[content][1],
			context
		]);
		events[content][1].end = { ...events[definition][1].end };
	} else events[content][1] = heading;
	events.push([
		"exit",
		heading,
		context
	]);
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeSetextUnderline(effects, ok, nok) {
	const self = this;
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* At start of heading (setext) underline.
	*
	* ```markdown
	*   | aa
	* > | ==
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		let index = self.events.length;
		/** @type {boolean | undefined} */
		let paragraph;
		while (index--) if (self.events[index][1].type !== "lineEnding" && self.events[index][1].type !== "linePrefix" && self.events[index][1].type !== "content") {
			paragraph = self.events[index][1].type === "paragraph";
			break;
		}
		if (!self.parser.lazy[self.now().line] && (self.interrupt || paragraph)) {
			effects.enter("setextHeadingLine");
			marker = code;
			return before(code);
		}
		return nok(code);
	}
	/**
	* After optional whitespace, at `-` or `=`.
	*
	* ```markdown
	*   | aa
	* > | ==
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		effects.enter("setextHeadingLineSequence");
		return inside(code);
	}
	/**
	* In sequence.
	*
	* ```markdown
	*   | aa
	* > | ==
	*     ^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === marker) {
			effects.consume(code);
			return inside;
		}
		effects.exit("setextHeadingLineSequence");
		return markdownSpace(code) ? factorySpace(effects, after, "lineSuffix")(code) : after(code);
	}
	/**
	* After sequence, after optional whitespace.
	*
	* ```markdown
	*   | aa
	* > | ==
	*       ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("setextHeadingLine");
			return ok(code);
		}
		return nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark/lib/initialize/flow.js
/**
* @import {
*   InitialConstruct,
*   Initializer,
*   State,
*   TokenizeContext
* } from 'micromark-util-types'
*/
/** @type {InitialConstruct} */
var flow$1 = { tokenize: initializeFlow };
/**
* @this {TokenizeContext}
*   Self.
* @type {Initializer}
*   Initializer.
*/
function initializeFlow(effects) {
	const self = this;
	const initial = effects.attempt(blankLine, atBlankEnding, effects.attempt(this.parser.constructs.flowInitial, afterConstruct, factorySpace(effects, effects.attempt(this.parser.constructs.flow, afterConstruct, effects.attempt(content, afterConstruct)), "linePrefix")));
	return initial;
	/** @type {State} */
	function atBlankEnding(code) {
		if (code === null) {
			effects.consume(code);
			return;
		}
		effects.enter("lineEndingBlank");
		effects.consume(code);
		effects.exit("lineEndingBlank");
		self.currentConstruct = void 0;
		return initial;
	}
	/** @type {State} */
	function afterConstruct(code) {
		if (code === null) {
			effects.consume(code);
			return;
		}
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		self.currentConstruct = void 0;
		return initial;
	}
}
//#endregion
//#region ../../node_modules/micromark/lib/initialize/text.js
/**
* @import {
*   Code,
*   InitialConstruct,
*   Initializer,
*   Resolver,
*   State,
*   TokenizeContext
* } from 'micromark-util-types'
*/
var resolver = { resolveAll: createResolver() };
var string$1 = initializeFactory("string");
var text$4 = initializeFactory("text");
/**
* @param {'string' | 'text'} field
*   Field.
* @returns {InitialConstruct}
*   Construct.
*/
function initializeFactory(field) {
	return {
		resolveAll: createResolver(field === "text" ? resolveAllLineSuffixes : void 0),
		tokenize: initializeText
	};
	/**
	* @this {TokenizeContext}
	*   Context.
	* @type {Initializer}
	*/
	function initializeText(effects) {
		const self = this;
		const constructs = this.parser.constructs[field];
		const text = effects.attempt(constructs, start, notText);
		return start;
		/** @type {State} */
		function start(code) {
			return atBreak(code) ? text(code) : notText(code);
		}
		/** @type {State} */
		function notText(code) {
			if (code === null) {
				effects.consume(code);
				return;
			}
			effects.enter("data");
			effects.consume(code);
			return data;
		}
		/** @type {State} */
		function data(code) {
			if (atBreak(code)) {
				effects.exit("data");
				return text(code);
			}
			effects.consume(code);
			return data;
		}
		/**
		* @param {Code} code
		*   Code.
		* @returns {boolean}
		*   Whether the code is a break.
		*/
		function atBreak(code) {
			if (code === null) return true;
			const list = constructs[code];
			let index = -1;
			if (list) while (++index < list.length) {
				const item = list[index];
				if (!item.previous || item.previous.call(self, self.previous)) return true;
			}
			return false;
		}
	}
}
/**
* @param {Resolver | undefined} [extraResolver]
*   Resolver.
* @returns {Resolver}
*   Resolver.
*/
function createResolver(extraResolver) {
	return resolveAllText;
	/** @type {Resolver} */
	function resolveAllText(events, context) {
		let index = -1;
		/** @type {number | undefined} */
		let enter;
		while (++index <= events.length) if (enter === void 0) {
			if (events[index] && events[index][1].type === "data") {
				enter = index;
				index++;
			}
		} else if (!events[index] || events[index][1].type !== "data") {
			if (index !== enter + 2) {
				events[enter][1].end = events[index - 1][1].end;
				events.splice(enter + 2, index - enter - 2);
				index = enter + 2;
			}
			enter = void 0;
		}
		return extraResolver ? extraResolver(events, context) : events;
	}
}
/**
* A rather ugly set of instructions which again looks at chunks in the input
* stream.
* The reason to do this here is that it is *much* faster to parse in reverse.
* And that we can’t hook into `null` to split the line suffix before an EOF.
* To do: figure out if we can make this into a clean utility, or even in core.
* As it will be useful for GFMs literal autolink extension (and maybe even
* tables?)
*
* @type {Resolver}
*/
function resolveAllLineSuffixes(events, context) {
	let eventIndex = 0;
	while (++eventIndex <= events.length) if ((eventIndex === events.length || events[eventIndex][1].type === "lineEnding") && events[eventIndex - 1][1].type === "data") {
		const data = events[eventIndex - 1][1];
		const chunks = context.sliceStream(data);
		let index = chunks.length;
		let bufferIndex = -1;
		let size = 0;
		/** @type {boolean | undefined} */
		let tabs;
		while (index--) {
			const chunk = chunks[index];
			if (typeof chunk === "string") {
				bufferIndex = chunk.length;
				while (chunk.charCodeAt(bufferIndex - 1) === 32) {
					size++;
					bufferIndex--;
				}
				if (bufferIndex) break;
				bufferIndex = -1;
			} else if (chunk === -2) {
				tabs = true;
				size++;
			} else if (chunk === -1) {} else {
				index++;
				break;
			}
		}
		if (context._contentTypeTextTrailing && eventIndex === events.length) size = 0;
		if (size) {
			const token = {
				type: eventIndex === events.length || tabs || size < 2 ? "lineSuffix" : "hardBreakTrailing",
				start: {
					_bufferIndex: index ? bufferIndex : data.start._bufferIndex + bufferIndex,
					_index: data.start._index + index,
					line: data.end.line,
					column: data.end.column - size,
					offset: data.end.offset - size
				},
				end: { ...data.end }
			};
			data.end = { ...token.start };
			if (data.start.offset === data.end.offset) Object.assign(data, token);
			else {
				events.splice(eventIndex, 0, [
					"enter",
					token,
					context
				], [
					"exit",
					token,
					context
				]);
				eventIndex += 2;
			}
		}
		eventIndex++;
	}
	return events;
}
//#endregion
//#region ../../node_modules/micromark/lib/constructs.js
/**
* @import {Extension} from 'micromark-util-types'
*/
var constructs_exports = /* @__PURE__ */ __exportAll({
	attentionMarkers: () => attentionMarkers,
	contentInitial: () => contentInitial,
	disable: () => disable,
	document: () => document$1,
	flow: () => flow,
	flowInitial: () => flowInitial,
	insideSpan: () => insideSpan,
	string: () => string,
	text: () => text$3
});
/** @satisfies {Extension['document']} */
var document$1 = {
	[42]: list$2,
	[43]: list$2,
	[45]: list$2,
	[48]: list$2,
	[49]: list$2,
	[50]: list$2,
	[51]: list$2,
	[52]: list$2,
	[53]: list$2,
	[54]: list$2,
	[55]: list$2,
	[56]: list$2,
	[57]: list$2,
	[62]: blockQuote
};
/** @satisfies {Extension['contentInitial']} */
var contentInitial = { [91]: definition$1 };
/** @satisfies {Extension['flowInitial']} */
var flowInitial = {
	[-2]: codeIndented,
	[-1]: codeIndented,
	[32]: codeIndented
};
/** @satisfies {Extension['flow']} */
var flow = {
	[35]: headingAtx,
	[42]: thematicBreak$2,
	[45]: [setextUnderline, thematicBreak$2],
	[60]: htmlFlow,
	[61]: setextUnderline,
	[95]: thematicBreak$2,
	[96]: codeFenced,
	[126]: codeFenced
};
/** @satisfies {Extension['string']} */
var string = {
	[38]: characterReference,
	[92]: characterEscape
};
/** @satisfies {Extension['text']} */
var text$3 = {
	[-5]: lineEnding,
	[-4]: lineEnding,
	[-3]: lineEnding,
	[33]: labelStartImage,
	[38]: characterReference,
	[42]: attention,
	[60]: [autolink, htmlText],
	[91]: labelStartLink,
	[92]: [hardBreakEscape, characterEscape],
	[93]: labelEnd,
	[95]: attention,
	[96]: codeText
};
/** @satisfies {Extension['insideSpan']} */
var insideSpan = { null: [attention, resolver] };
/** @satisfies {Extension['attentionMarkers']} */
var attentionMarkers = { null: [42, 95] };
/** @satisfies {Extension['disable']} */
var disable = { null: [] };
//#endregion
//#region ../../node_modules/micromark/lib/create-tokenizer.js
/**
* @import {
*   Chunk,
*   Code,
*   ConstructRecord,
*   Construct,
*   Effects,
*   InitialConstruct,
*   ParseContext,
*   Point,
*   State,
*   TokenizeContext,
*   Token
* } from 'micromark-util-types'
*/
/**
* @callback Restore
*   Restore the state.
* @returns {undefined}
*   Nothing.
*
* @typedef Info
*   Info.
* @property {Restore} restore
*   Restore.
* @property {number} from
*   From.
*
* @callback ReturnHandle
*   Handle a successful run.
* @param {Construct} construct
*   Construct.
* @param {Info} info
*   Info.
* @returns {undefined}
*   Nothing.
*/
/**
* Create a tokenizer.
* Tokenizers deal with one type of data (e.g., containers, flow, text).
* The parser is the object dealing with it all.
* `initialize` works like other constructs, except that only its `tokenize`
* function is used, in which case it doesn’t receive an `ok` or `nok`.
* `from` can be given to set the point before the first character, although
* when further lines are indented, they must be set with `defineSkip`.
*
* @param {ParseContext} parser
*   Parser.
* @param {InitialConstruct} initialize
*   Construct.
* @param {Omit<Point, '_bufferIndex' | '_index'> | undefined} [from]
*   Point (optional).
* @returns {TokenizeContext}
*   Context.
*/
function createTokenizer(parser, initialize, from) {
	/** @type {Point} */
	let point = {
		_bufferIndex: -1,
		_index: 0,
		line: from && from.line || 1,
		column: from && from.column || 1,
		offset: from && from.offset || 0
	};
	/** @type {Record<string, number>} */
	const columnStart = {};
	/** @type {Array<Construct>} */
	const resolveAllConstructs = [];
	/** @type {Array<Chunk>} */
	let chunks = [];
	/** @type {Array<Token>} */
	let stack = [];
	/**
	* Tools used for tokenizing.
	*
	* @type {Effects}
	*/
	const effects = {
		attempt: constructFactory(onsuccessfulconstruct),
		check: constructFactory(onsuccessfulcheck),
		consume,
		enter,
		exit,
		interrupt: constructFactory(onsuccessfulcheck, { interrupt: true })
	};
	/**
	* State and tools for resolving and serializing.
	*
	* @type {TokenizeContext}
	*/
	const context = {
		code: null,
		containerState: {},
		defineSkip,
		events: [],
		now,
		parser,
		previous: null,
		sliceSerialize,
		sliceStream,
		write
	};
	/**
	* The state function.
	*
	* @type {State | undefined}
	*/
	let state = initialize.tokenize.call(context, effects);
	if (initialize.resolveAll) resolveAllConstructs.push(initialize);
	return context;
	/** @type {TokenizeContext['write']} */
	function write(slice) {
		chunks = push(chunks, slice);
		main();
		if (chunks[chunks.length - 1] !== null) return [];
		addResult(initialize, 0);
		context.events = resolveAll(resolveAllConstructs, context.events, context);
		return context.events;
	}
	/** @type {TokenizeContext['sliceSerialize']} */
	function sliceSerialize(token, expandTabs) {
		return serializeChunks(sliceStream(token), expandTabs);
	}
	/** @type {TokenizeContext['sliceStream']} */
	function sliceStream(token) {
		return sliceChunks(chunks, token);
	}
	/** @type {TokenizeContext['now']} */
	function now() {
		const { _bufferIndex, _index, line, column, offset } = point;
		return {
			_bufferIndex,
			_index,
			line,
			column,
			offset
		};
	}
	/** @type {TokenizeContext['defineSkip']} */
	function defineSkip(value) {
		columnStart[value.line] = value.column;
		accountForPotentialSkip();
	}
	/**
	* Main loop (note that `_index` and `_bufferIndex` in `point` are modified by
	* `consume`).
	* Here is where we walk through the chunks, which either include strings of
	* several characters, or numerical character codes.
	* The reason to do this in a loop instead of a call is so the stack can
	* drain.
	*
	* @returns {undefined}
	*   Nothing.
	*/
	function main() {
		/** @type {number} */
		let chunkIndex;
		while (point._index < chunks.length) {
			const chunk = chunks[point._index];
			if (typeof chunk === "string") {
				chunkIndex = point._index;
				if (point._bufferIndex < 0) point._bufferIndex = 0;
				while (point._index === chunkIndex && point._bufferIndex < chunk.length) go(chunk.charCodeAt(point._bufferIndex));
			} else go(chunk);
		}
	}
	/**
	* Deal with one code.
	*
	* @param {Code} code
	*   Code.
	* @returns {undefined}
	*   Nothing.
	*/
	function go(code) {
		state = state(code);
	}
	/** @type {Effects['consume']} */
	function consume(code) {
		if (markdownLineEnding(code)) {
			point.line++;
			point.column = 1;
			point.offset += code === -3 ? 2 : 1;
			accountForPotentialSkip();
		} else if (code !== -1) {
			point.column++;
			point.offset++;
		}
		if (point._bufferIndex < 0) point._index++;
		else {
			point._bufferIndex++;
			if (point._bufferIndex === chunks[point._index].length) {
				point._bufferIndex = -1;
				point._index++;
			}
		}
		context.previous = code;
	}
	/** @type {Effects['enter']} */
	function enter(type, fields) {
		/** @type {Token} */
		const token = fields || {};
		token.type = type;
		token.start = now();
		context.events.push([
			"enter",
			token,
			context
		]);
		stack.push(token);
		return token;
	}
	/** @type {Effects['exit']} */
	function exit(type) {
		const token = stack.pop();
		token.end = now();
		context.events.push([
			"exit",
			token,
			context
		]);
		return token;
	}
	/**
	* Use results.
	*
	* @type {ReturnHandle}
	*/
	function onsuccessfulconstruct(construct, info) {
		addResult(construct, info.from);
	}
	/**
	* Discard results.
	*
	* @type {ReturnHandle}
	*/
	function onsuccessfulcheck(_, info) {
		info.restore();
	}
	/**
	* Factory to attempt/check/interrupt.
	*
	* @param {ReturnHandle} onreturn
	*   Callback.
	* @param {{interrupt?: boolean | undefined} | undefined} [fields]
	*   Fields.
	*/
	function constructFactory(onreturn, fields) {
		return hook;
		/**
		* Handle either an object mapping codes to constructs, a list of
		* constructs, or a single construct.
		*
		* @param {Array<Construct> | ConstructRecord | Construct} constructs
		*   Constructs.
		* @param {State} returnState
		*   State.
		* @param {State | undefined} [bogusState]
		*   State.
		* @returns {State}
		*   State.
		*/
		function hook(constructs, returnState, bogusState) {
			/** @type {ReadonlyArray<Construct>} */
			let listOfConstructs;
			/** @type {number} */
			let constructIndex;
			/** @type {Construct} */
			let currentConstruct;
			/** @type {Info} */
			let info;
			return Array.isArray(constructs) ? handleListOfConstructs(constructs) : "tokenize" in constructs ? handleListOfConstructs([constructs]) : handleMapOfConstructs(constructs);
			/**
			* Handle a list of construct.
			*
			* @param {ConstructRecord} map
			*   Constructs.
			* @returns {State}
			*   State.
			*/
			function handleMapOfConstructs(map) {
				return start;
				/** @type {State} */
				function start(code) {
					const left = code !== null && map[code];
					const all = code !== null && map.null;
					return handleListOfConstructs([...Array.isArray(left) ? left : left ? [left] : [], ...Array.isArray(all) ? all : all ? [all] : []])(code);
				}
			}
			/**
			* Handle a list of construct.
			*
			* @param {ReadonlyArray<Construct>} list
			*   Constructs.
			* @returns {State}
			*   State.
			*/
			function handleListOfConstructs(list) {
				listOfConstructs = list;
				constructIndex = 0;
				if (list.length === 0) return bogusState;
				return handleConstruct(list[constructIndex]);
			}
			/**
			* Handle a single construct.
			*
			* @param {Construct} construct
			*   Construct.
			* @returns {State}
			*   State.
			*/
			function handleConstruct(construct) {
				return start;
				/** @type {State} */
				function start(code) {
					info = store();
					currentConstruct = construct;
					if (!construct.partial) context.currentConstruct = construct;
					if (construct.name && context.parser.constructs.disable.null.includes(construct.name)) return nok(code);
					return construct.tokenize.call(fields ? Object.assign(Object.create(context), fields) : context, effects, ok, nok)(code);
				}
			}
			/** @type {State} */
			function ok(code) {
				onreturn(currentConstruct, info);
				return returnState;
			}
			/** @type {State} */
			function nok(code) {
				info.restore();
				if (++constructIndex < listOfConstructs.length) return handleConstruct(listOfConstructs[constructIndex]);
				return bogusState;
			}
		}
	}
	/**
	* @param {Construct} construct
	*   Construct.
	* @param {number} from
	*   From.
	* @returns {undefined}
	*   Nothing.
	*/
	function addResult(construct, from) {
		if (construct.resolveAll && !resolveAllConstructs.includes(construct)) resolveAllConstructs.push(construct);
		if (construct.resolve) splice(context.events, from, context.events.length - from, construct.resolve(context.events.slice(from), context));
		if (construct.resolveTo) context.events = construct.resolveTo(context.events, context);
	}
	/**
	* Store state.
	*
	* @returns {Info}
	*   Info.
	*/
	function store() {
		const startPoint = now();
		const startPrevious = context.previous;
		const startCurrentConstruct = context.currentConstruct;
		const startEventsIndex = context.events.length;
		const startStack = Array.from(stack);
		return {
			from: startEventsIndex,
			restore
		};
		/**
		* Restore state.
		*
		* @returns {undefined}
		*   Nothing.
		*/
		function restore() {
			point = startPoint;
			context.previous = startPrevious;
			context.currentConstruct = startCurrentConstruct;
			context.events.length = startEventsIndex;
			stack = startStack;
			accountForPotentialSkip();
		}
	}
	/**
	* Move the current point a bit forward in the line when it’s on a column
	* skip.
	*
	* @returns {undefined}
	*   Nothing.
	*/
	function accountForPotentialSkip() {
		if (point.line in columnStart && point.column < 2) {
			point.column = columnStart[point.line];
			point.offset += columnStart[point.line] - 1;
		}
	}
}
/**
* Get the chunks from a slice of chunks in the range of a token.
*
* @param {ReadonlyArray<Chunk>} chunks
*   Chunks.
* @param {Pick<Token, 'end' | 'start'>} token
*   Token.
* @returns {Array<Chunk>}
*   Chunks.
*/
function sliceChunks(chunks, token) {
	const startIndex = token.start._index;
	const startBufferIndex = token.start._bufferIndex;
	const endIndex = token.end._index;
	const endBufferIndex = token.end._bufferIndex;
	/** @type {Array<Chunk>} */
	let view;
	if (startIndex === endIndex) view = [chunks[startIndex].slice(startBufferIndex, endBufferIndex)];
	else {
		view = chunks.slice(startIndex, endIndex);
		if (startBufferIndex > -1) {
			const head = view[0];
			if (typeof head === "string") view[0] = head.slice(startBufferIndex);
			else view.shift();
		}
		if (endBufferIndex > 0) view.push(chunks[endIndex].slice(0, endBufferIndex));
	}
	return view;
}
/**
* Get the string value of a slice of chunks.
*
* @param {ReadonlyArray<Chunk>} chunks
*   Chunks.
* @param {boolean | undefined} [expandTabs=false]
*   Whether to expand tabs (default: `false`).
* @returns {string}
*   Result.
*/
function serializeChunks(chunks, expandTabs) {
	let index = -1;
	/** @type {Array<string>} */
	const result = [];
	/** @type {boolean | undefined} */
	let atTab;
	while (++index < chunks.length) {
		const chunk = chunks[index];
		/** @type {string} */
		let value;
		if (typeof chunk === "string") value = chunk;
		else switch (chunk) {
			case -5:
				value = "\r";
				break;
			case -4:
				value = "\n";
				break;
			case -3:
				value = "\r\n";
				break;
			case -2:
				value = expandTabs ? " " : "	";
				break;
			case -1:
				if (!expandTabs && atTab) continue;
				value = " ";
				break;
			default: value = String.fromCharCode(chunk);
		}
		atTab = chunk === -2;
		result.push(value);
	}
	return result.join("");
}
//#endregion
//#region ../../node_modules/micromark/lib/parse.js
/**
* @import {
*   Create,
*   FullNormalizedExtension,
*   InitialConstruct,
*   ParseContext,
*   ParseOptions
* } from 'micromark-util-types'
*/
/**
* @param {ParseOptions | null | undefined} [options]
*   Configuration (optional).
* @returns {ParseContext}
*   Parser.
*/
function parse(options) {
	/** @type {ParseContext} */
	const parser = {
		constructs: combineExtensions([constructs_exports, ...(options || {}).extensions || []]),
		content: create(content$1),
		defined: [],
		document: create(document$2),
		flow: create(flow$1),
		lazy: {},
		string: create(string$1),
		text: create(text$4)
	};
	return parser;
	/**
	* @param {InitialConstruct} initial
	*   Construct to start with.
	* @returns {Create}
	*   Create a tokenizer.
	*/
	function create(initial) {
		return creator;
		/** @type {Create} */
		function creator(from) {
			return createTokenizer(parser, initial, from);
		}
	}
}
//#endregion
//#region ../../node_modules/micromark/lib/postprocess.js
/**
* @import {Event} from 'micromark-util-types'
*/
/**
* @param {Array<Event>} events
*   Events.
* @returns {Array<Event>}
*   Events.
*/
function postprocess(events) {
	while (!subtokenize(events));
	return events;
}
//#endregion
//#region ../../node_modules/micromark/lib/preprocess.js
/**
* @import {Chunk, Code, Encoding, Value} from 'micromark-util-types'
*/
/**
* @callback Preprocessor
*   Preprocess a value.
* @param {Value} value
*   Value.
* @param {Encoding | null | undefined} [encoding]
*   Encoding when `value` is a typed array (optional).
* @param {boolean | null | undefined} [end=false]
*   Whether this is the last chunk (default: `false`).
* @returns {Array<Chunk>}
*   Chunks.
*/
var search = /[\0\t\n\r]/g;
/**
* @returns {Preprocessor}
*   Preprocess a value.
*/
function preprocess() {
	let column = 1;
	let buffer = "";
	/** @type {boolean | undefined} */
	let start = true;
	/** @type {boolean | undefined} */
	let atCarriageReturn;
	return preprocessor;
	/** @type {Preprocessor} */
	function preprocessor(value, encoding, end) {
		/** @type {Array<Chunk>} */
		const chunks = [];
		/** @type {RegExpMatchArray | null} */
		let match;
		/** @type {number} */
		let next;
		/** @type {number} */
		let startPosition;
		/** @type {number} */
		let endPosition;
		/** @type {Code} */
		let code;
		value = buffer + (typeof value === "string" ? value.toString() : new TextDecoder(encoding || void 0).decode(value));
		startPosition = 0;
		buffer = "";
		if (start) {
			if (value.charCodeAt(0) === 65279) startPosition++;
			start = void 0;
		}
		while (startPosition < value.length) {
			search.lastIndex = startPosition;
			match = search.exec(value);
			endPosition = match && match.index !== void 0 ? match.index : value.length;
			code = value.charCodeAt(endPosition);
			if (!match) {
				buffer = value.slice(startPosition);
				break;
			}
			if (code === 10 && startPosition === endPosition && atCarriageReturn) {
				chunks.push(-3);
				atCarriageReturn = void 0;
			} else {
				if (atCarriageReturn) {
					chunks.push(-5);
					atCarriageReturn = void 0;
				}
				if (startPosition < endPosition) {
					chunks.push(value.slice(startPosition, endPosition));
					column += endPosition - startPosition;
				}
				switch (code) {
					case 0:
						chunks.push(65533);
						column++;
						break;
					case 9:
						next = Math.ceil(column / 4) * 4;
						chunks.push(-2);
						while (column++ < next) chunks.push(-1);
						break;
					case 10:
						chunks.push(-4);
						column = 1;
						break;
					default:
						atCarriageReturn = true;
						column = 1;
				}
			}
			startPosition = endPosition + 1;
		}
		if (end) {
			if (atCarriageReturn) chunks.push(-5);
			if (buffer) chunks.push(buffer);
			chunks.push(null);
		}
		return chunks;
	}
}
//#endregion
//#region ../../node_modules/micromark-util-decode-string/index.js
var characterEscapeOrReference = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
/**
* Decode markdown strings (which occur in places such as fenced code info
* strings, destinations, labels, and titles).
*
* The “string” content type allows character escapes and -references.
* This decodes those.
*
* @param {string} value
*   Value to decode.
* @returns {string}
*   Decoded value.
*/
function decodeString(value) {
	return value.replace(characterEscapeOrReference, decode);
}
/**
* @param {string} $0
*   Match.
* @param {string} $1
*   Character escape.
* @param {string} $2
*   Character reference.
* @returns {string}
*   Decoded value
*/
function decode($0, $1, $2) {
	if ($1) return $1;
	if ($2.charCodeAt(0) === 35) {
		const head = $2.charCodeAt(1);
		const hex = head === 120 || head === 88;
		return decodeNumericCharacterReference($2.slice(hex ? 2 : 1), hex ? 16 : 10);
	}
	return decodeNamedCharacterReference($2) || $0;
}
//#endregion
//#region ../../node_modules/mdast-util-from-markdown/lib/index.js
/**
* @import {
*   Break,
*   Blockquote,
*   Code,
*   Definition,
*   Emphasis,
*   Heading,
*   Html,
*   Image,
*   InlineCode,
*   Link,
*   ListItem,
*   List,
*   Nodes,
*   Paragraph,
*   PhrasingContent,
*   ReferenceType,
*   Root,
*   Strong,
*   Text,
*   ThematicBreak
* } from 'mdast'
* @import {
*   Encoding,
*   Event,
*   Token,
*   Value
* } from 'micromark-util-types'
* @import {Point} from 'unist'
* @import {
*   CompileContext,
*   CompileData,
*   Config,
*   Extension,
*   Handle,
*   OnEnterError,
*   Options
* } from './types.js'
*/
var own$2 = {}.hasOwnProperty;
/**
* Turn markdown into a syntax tree.
*
* @overload
* @param {Value} value
* @param {Encoding | null | undefined} [encoding]
* @param {Options | null | undefined} [options]
* @returns {Root}
*
* @overload
* @param {Value} value
* @param {Options | null | undefined} [options]
* @returns {Root}
*
* @param {Value} value
*   Markdown to parse.
* @param {Encoding | Options | null | undefined} [encoding]
*   Character encoding for when `value` is `Buffer`.
* @param {Options | null | undefined} [options]
*   Configuration.
* @returns {Root}
*   mdast tree.
*/
function fromMarkdown(value, encoding, options) {
	if (encoding && typeof encoding === "object") {
		options = encoding;
		encoding = void 0;
	}
	return compiler(options)(postprocess(parse(options).document().write(preprocess()(value, encoding, true))));
}
/**
* Note this compiler only understand complete buffering, not streaming.
*
* @param {Options | null | undefined} [options]
*/
function compiler(options) {
	/** @type {Config} */
	const config = {
		transforms: [],
		canContainEols: [
			"emphasis",
			"fragment",
			"heading",
			"paragraph",
			"strong"
		],
		enter: {
			autolink: opener(link),
			autolinkProtocol: onenterdata,
			autolinkEmail: onenterdata,
			atxHeading: opener(heading),
			blockQuote: opener(blockQuote),
			characterEscape: onenterdata,
			characterReference: onenterdata,
			codeFenced: opener(codeFlow),
			codeFencedFenceInfo: buffer,
			codeFencedFenceMeta: buffer,
			codeIndented: opener(codeFlow, buffer),
			codeText: opener(codeText, buffer),
			codeTextData: onenterdata,
			data: onenterdata,
			codeFlowValue: onenterdata,
			definition: opener(definition),
			definitionDestinationString: buffer,
			definitionLabelString: buffer,
			definitionTitleString: buffer,
			emphasis: opener(emphasis),
			hardBreakEscape: opener(hardBreak),
			hardBreakTrailing: opener(hardBreak),
			htmlFlow: opener(html, buffer),
			htmlFlowData: onenterdata,
			htmlText: opener(html, buffer),
			htmlTextData: onenterdata,
			image: opener(image),
			label: buffer,
			link: opener(link),
			listItem: opener(listItem),
			listItemValue: onenterlistitemvalue,
			listOrdered: opener(list, onenterlistordered),
			listUnordered: opener(list),
			paragraph: opener(paragraph),
			reference: onenterreference,
			referenceString: buffer,
			resourceDestinationString: buffer,
			resourceTitleString: buffer,
			setextHeading: opener(heading),
			strong: opener(strong),
			thematicBreak: opener(thematicBreak)
		},
		exit: {
			atxHeading: closer(),
			atxHeadingSequence: onexitatxheadingsequence,
			autolink: closer(),
			autolinkEmail: onexitautolinkemail,
			autolinkProtocol: onexitautolinkprotocol,
			blockQuote: closer(),
			characterEscapeValue: onexitdata,
			characterReferenceMarkerHexadecimal: onexitcharacterreferencemarker,
			characterReferenceMarkerNumeric: onexitcharacterreferencemarker,
			characterReferenceValue: onexitcharacterreferencevalue,
			characterReference: onexitcharacterreference,
			codeFenced: closer(onexitcodefenced),
			codeFencedFence: onexitcodefencedfence,
			codeFencedFenceInfo: onexitcodefencedfenceinfo,
			codeFencedFenceMeta: onexitcodefencedfencemeta,
			codeFlowValue: onexitdata,
			codeIndented: closer(onexitcodeindented),
			codeText: closer(onexitcodetext),
			codeTextData: onexitdata,
			data: onexitdata,
			definition: closer(),
			definitionDestinationString: onexitdefinitiondestinationstring,
			definitionLabelString: onexitdefinitionlabelstring,
			definitionTitleString: onexitdefinitiontitlestring,
			emphasis: closer(),
			hardBreakEscape: closer(onexithardbreak),
			hardBreakTrailing: closer(onexithardbreak),
			htmlFlow: closer(onexithtmlflow),
			htmlFlowData: onexitdata,
			htmlText: closer(onexithtmltext),
			htmlTextData: onexitdata,
			image: closer(onexitimage),
			label: onexitlabel,
			labelText: onexitlabeltext,
			lineEnding: onexitlineending,
			link: closer(onexitlink),
			listItem: closer(),
			listOrdered: closer(),
			listUnordered: closer(),
			paragraph: closer(),
			referenceString: onexitreferencestring,
			resourceDestinationString: onexitresourcedestinationstring,
			resourceTitleString: onexitresourcetitlestring,
			resource: onexitresource,
			setextHeading: closer(onexitsetextheading),
			setextHeadingLineSequence: onexitsetextheadinglinesequence,
			setextHeadingText: onexitsetextheadingtext,
			strong: closer(),
			thematicBreak: closer()
		}
	};
	configure(config, (options || {}).mdastExtensions || []);
	/** @type {CompileData} */
	const data = {};
	return compile;
	/**
	* Turn micromark events into an mdast tree.
	*
	* @param {Array<Event>} events
	*   Events.
	* @returns {Root}
	*   mdast tree.
	*/
	function compile(events) {
		/** @type {Root} */
		let tree = {
			type: "root",
			children: []
		};
		/** @type {Omit<CompileContext, 'sliceSerialize'>} */
		const context = {
			stack: [tree],
			tokenStack: [],
			config,
			enter,
			exit,
			buffer,
			resume,
			data
		};
		/** @type {Array<number>} */
		const listStack = [];
		let index = -1;
		while (++index < events.length) if (events[index][1].type === "listOrdered" || events[index][1].type === "listUnordered") {
			if (events[index][0] === "enter") listStack.push(index);
			else index = prepareList(events, listStack.pop(), index);
		}
		index = -1;
		while (++index < events.length) {
			const handler = config[events[index][0]];
			if (own$2.call(handler, events[index][1].type)) handler[events[index][1].type].call(Object.assign({ sliceSerialize: events[index][2].sliceSerialize }, context), events[index][1]);
		}
		if (context.tokenStack.length > 0) {
			const tail = context.tokenStack[context.tokenStack.length - 1];
			(tail[1] || defaultOnError).call(context, void 0, tail[0]);
		}
		tree.position = {
			start: point(events.length > 0 ? events[0][1].start : {
				line: 1,
				column: 1,
				offset: 0
			}),
			end: point(events.length > 0 ? events[events.length - 2][1].end : {
				line: 1,
				column: 1,
				offset: 0
			})
		};
		index = -1;
		while (++index < config.transforms.length) tree = config.transforms[index](tree) || tree;
		return tree;
	}
	/**
	* @param {Array<Event>} events
	* @param {number} start
	* @param {number} length
	* @returns {number}
	*/
	function prepareList(events, start, length) {
		let index = start - 1;
		let containerBalance = -1;
		let listSpread = false;
		/** @type {Token | undefined} */
		let listItem;
		/** @type {number | undefined} */
		let lineIndex;
		/** @type {number | undefined} */
		let firstBlankLineIndex;
		/** @type {boolean | undefined} */
		let atMarker;
		while (++index <= length) {
			const event = events[index];
			switch (event[1].type) {
				case "listUnordered":
				case "listOrdered":
				case "blockQuote":
					if (event[0] === "enter") containerBalance++;
					else containerBalance--;
					atMarker = void 0;
					break;
				case "lineEndingBlank":
					if (event[0] === "enter") {
						if (listItem && !atMarker && !containerBalance && !firstBlankLineIndex) firstBlankLineIndex = index;
						atMarker = void 0;
					}
					break;
				case "linePrefix":
				case "listItemValue":
				case "listItemMarker":
				case "listItemPrefix":
				case "listItemPrefixWhitespace": break;
				default: atMarker = void 0;
			}
			if (!containerBalance && event[0] === "enter" && event[1].type === "listItemPrefix" || containerBalance === -1 && event[0] === "exit" && (event[1].type === "listUnordered" || event[1].type === "listOrdered")) {
				if (listItem) {
					let tailIndex = index;
					lineIndex = void 0;
					while (tailIndex--) {
						const tailEvent = events[tailIndex];
						if (tailEvent[1].type === "lineEnding" || tailEvent[1].type === "lineEndingBlank") {
							if (tailEvent[0] === "exit") continue;
							if (lineIndex) {
								events[lineIndex][1].type = "lineEndingBlank";
								listSpread = true;
							}
							tailEvent[1].type = "lineEnding";
							lineIndex = tailIndex;
						} else if (tailEvent[1].type === "linePrefix" || tailEvent[1].type === "blockQuotePrefix" || tailEvent[1].type === "blockQuotePrefixWhitespace" || tailEvent[1].type === "blockQuoteMarker" || tailEvent[1].type === "listItemIndent") {} else break;
					}
					if (firstBlankLineIndex && (!lineIndex || firstBlankLineIndex < lineIndex)) listItem._spread = true;
					listItem.end = Object.assign({}, lineIndex ? events[lineIndex][1].start : event[1].end);
					events.splice(lineIndex || index, 0, [
						"exit",
						listItem,
						event[2]
					]);
					index++;
					length++;
				}
				if (event[1].type === "listItemPrefix") {
					/** @type {Token} */
					const item = {
						type: "listItem",
						_spread: false,
						start: Object.assign({}, event[1].start),
						end: void 0
					};
					listItem = item;
					events.splice(index, 0, [
						"enter",
						item,
						event[2]
					]);
					index++;
					length++;
					firstBlankLineIndex = void 0;
					atMarker = true;
				}
			}
		}
		events[start][1]._spread = listSpread;
		return length;
	}
	/**
	* Create an opener handle.
	*
	* @param {(token: Token) => Nodes} create
	*   Create a node.
	* @param {Handle | undefined} [and]
	*   Optional function to also run.
	* @returns {Handle}
	*   Handle.
	*/
	function opener(create, and) {
		return open;
		/**
		* @this {CompileContext}
		* @param {Token} token
		* @returns {undefined}
		*/
		function open(token) {
			enter.call(this, create(token), token);
			if (and) and.call(this, token);
		}
	}
	/**
	* @type {CompileContext['buffer']}
	*/
	function buffer() {
		this.stack.push({
			type: "fragment",
			children: []
		});
	}
	/**
	* @type {CompileContext['enter']}
	*/
	function enter(node, token, errorHandler) {
		this.stack[this.stack.length - 1].children.push(node);
		this.stack.push(node);
		this.tokenStack.push([token, errorHandler || void 0]);
		node.position = {
			start: point(token.start),
			end: void 0
		};
	}
	/**
	* Create a closer handle.
	*
	* @param {Handle | undefined} [and]
	*   Optional function to also run.
	* @returns {Handle}
	*   Handle.
	*/
	function closer(and) {
		return close;
		/**
		* @this {CompileContext}
		* @param {Token} token
		* @returns {undefined}
		*/
		function close(token) {
			if (and) and.call(this, token);
			exit.call(this, token);
		}
	}
	/**
	* @type {CompileContext['exit']}
	*/
	function exit(token, onExitError) {
		const node = this.stack.pop();
		const open = this.tokenStack.pop();
		if (!open) throw new Error("Cannot close `" + token.type + "` (" + stringifyPosition({
			start: token.start,
			end: token.end
		}) + "): it’s not open");
		else if (open[0].type !== token.type) {
			if (onExitError) onExitError.call(this, token, open[0]);
			else (open[1] || defaultOnError).call(this, token, open[0]);
		}
		node.position.end = point(token.end);
	}
	/**
	* @type {CompileContext['resume']}
	*/
	function resume() {
		return toString$1(this.stack.pop());
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onenterlistordered() {
		this.data.expectingFirstListItemValue = true;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onenterlistitemvalue(token) {
		if (this.data.expectingFirstListItemValue) {
			const ancestor = this.stack[this.stack.length - 2];
			ancestor.start = Number.parseInt(this.sliceSerialize(token), 10);
			this.data.expectingFirstListItemValue = void 0;
		}
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodefencedfenceinfo() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.lang = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodefencedfencemeta() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.meta = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodefencedfence() {
		if (this.data.flowCodeInside) return;
		this.buffer();
		this.data.flowCodeInside = true;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodefenced() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
		this.data.flowCodeInside = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodeindented() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data.replace(/(\r?\n|\r)$/g, "");
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitdefinitionlabelstring(token) {
		const label = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.label = label;
		node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitdefinitiontitlestring() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.title = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitdefinitiondestinationstring() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.url = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitatxheadingsequence(token) {
		const node = this.stack[this.stack.length - 1];
		if (!node.depth) node.depth = this.sliceSerialize(token).length;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitsetextheadingtext() {
		this.data.setextHeadingSlurpLineEnding = true;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitsetextheadinglinesequence(token) {
		const node = this.stack[this.stack.length - 1];
		node.depth = this.sliceSerialize(token).codePointAt(0) === 61 ? 1 : 2;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitsetextheading() {
		this.data.setextHeadingSlurpLineEnding = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onenterdata(token) {
		/** @type {Array<Nodes>} */
		const siblings = this.stack[this.stack.length - 1].children;
		let tail = siblings[siblings.length - 1];
		if (!tail || tail.type !== "text") {
			tail = text();
			tail.position = {
				start: point(token.start),
				end: void 0
			};
			siblings.push(tail);
		}
		this.stack.push(tail);
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitdata(token) {
		const tail = this.stack.pop();
		tail.value += this.sliceSerialize(token);
		tail.position.end = point(token.end);
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitlineending(token) {
		const context = this.stack[this.stack.length - 1];
		if (this.data.atHardBreak) {
			const tail = context.children[context.children.length - 1];
			tail.position.end = point(token.end);
			this.data.atHardBreak = void 0;
			return;
		}
		if (!this.data.setextHeadingSlurpLineEnding && config.canContainEols.includes(context.type)) {
			onenterdata.call(this, token);
			onexitdata.call(this, token);
		}
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexithardbreak() {
		this.data.atHardBreak = true;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexithtmlflow() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexithtmltext() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodetext() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitlink() {
		const node = this.stack[this.stack.length - 1];
		if (this.data.inReference) {
			/** @type {ReferenceType} */
			const referenceType = this.data.referenceType || "shortcut";
			node.type += "Reference";
			node.referenceType = referenceType;
			delete node.url;
			delete node.title;
		} else {
			delete node.identifier;
			delete node.label;
		}
		this.data.referenceType = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitimage() {
		const node = this.stack[this.stack.length - 1];
		if (this.data.inReference) {
			/** @type {ReferenceType} */
			const referenceType = this.data.referenceType || "shortcut";
			node.type += "Reference";
			node.referenceType = referenceType;
			delete node.url;
			delete node.title;
		} else {
			delete node.identifier;
			delete node.label;
		}
		this.data.referenceType = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitlabeltext(token) {
		const string = this.sliceSerialize(token);
		const ancestor = this.stack[this.stack.length - 2];
		ancestor.label = decodeString(string);
		ancestor.identifier = normalizeIdentifier(string).toLowerCase();
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitlabel() {
		const fragment = this.stack[this.stack.length - 1];
		const value = this.resume();
		const node = this.stack[this.stack.length - 1];
		this.data.inReference = true;
		if (node.type === "link") node.children = fragment.children;
		else node.alt = value;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitresourcedestinationstring() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.url = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitresourcetitlestring() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.title = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitresource() {
		this.data.inReference = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onenterreference() {
		this.data.referenceType = "collapsed";
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitreferencestring(token) {
		const label = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.label = label;
		node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
		this.data.referenceType = "full";
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcharacterreferencemarker(token) {
		this.data.characterReferenceType = token.type;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcharacterreferencevalue(token) {
		const data = this.sliceSerialize(token);
		const type = this.data.characterReferenceType;
		/** @type {string} */
		let value;
		if (type) {
			value = decodeNumericCharacterReference(data, type === "characterReferenceMarkerNumeric" ? 10 : 16);
			this.data.characterReferenceType = void 0;
		} else value = decodeNamedCharacterReference(data);
		const tail = this.stack[this.stack.length - 1];
		tail.value += value;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcharacterreference(token) {
		const tail = this.stack.pop();
		tail.position.end = point(token.end);
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitautolinkprotocol(token) {
		onexitdata.call(this, token);
		const node = this.stack[this.stack.length - 1];
		node.url = this.sliceSerialize(token);
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitautolinkemail(token) {
		onexitdata.call(this, token);
		const node = this.stack[this.stack.length - 1];
		node.url = "mailto:" + this.sliceSerialize(token);
	}
	/** @returns {Blockquote} */
	function blockQuote() {
		return {
			type: "blockquote",
			children: []
		};
	}
	/** @returns {Code} */
	function codeFlow() {
		return {
			type: "code",
			lang: null,
			meta: null,
			value: ""
		};
	}
	/** @returns {InlineCode} */
	function codeText() {
		return {
			type: "inlineCode",
			value: ""
		};
	}
	/** @returns {Definition} */
	function definition() {
		return {
			type: "definition",
			identifier: "",
			label: null,
			title: null,
			url: ""
		};
	}
	/** @returns {Emphasis} */
	function emphasis() {
		return {
			type: "emphasis",
			children: []
		};
	}
	/** @returns {Heading} */
	function heading() {
		return {
			type: "heading",
			depth: 0,
			children: []
		};
	}
	/** @returns {Break} */
	function hardBreak() {
		return { type: "break" };
	}
	/** @returns {Html} */
	function html() {
		return {
			type: "html",
			value: ""
		};
	}
	/** @returns {Image} */
	function image() {
		return {
			type: "image",
			title: null,
			url: "",
			alt: null
		};
	}
	/** @returns {Link} */
	function link() {
		return {
			type: "link",
			title: null,
			url: "",
			children: []
		};
	}
	/**
	* @param {Token} token
	* @returns {List}
	*/
	function list(token) {
		return {
			type: "list",
			ordered: token.type === "listOrdered",
			start: null,
			spread: token._spread,
			children: []
		};
	}
	/**
	* @param {Token} token
	* @returns {ListItem}
	*/
	function listItem(token) {
		return {
			type: "listItem",
			spread: token._spread,
			checked: null,
			children: []
		};
	}
	/** @returns {Paragraph} */
	function paragraph() {
		return {
			type: "paragraph",
			children: []
		};
	}
	/** @returns {Strong} */
	function strong() {
		return {
			type: "strong",
			children: []
		};
	}
	/** @returns {Text} */
	function text() {
		return {
			type: "text",
			value: ""
		};
	}
	/** @returns {ThematicBreak} */
	function thematicBreak() {
		return { type: "thematicBreak" };
	}
}
/**
* Copy a point-like value.
*
* @param {Point} d
*   Point-like value.
* @returns {Point}
*   unist point.
*/
function point(d) {
	return {
		line: d.line,
		column: d.column,
		offset: d.offset
	};
}
/**
* @param {Config} combined
* @param {Array<Array<Extension> | Extension>} extensions
* @returns {undefined}
*/
function configure(combined, extensions) {
	let index = -1;
	while (++index < extensions.length) {
		const value = extensions[index];
		if (Array.isArray(value)) configure(combined, value);
		else extension(combined, value);
	}
}
/**
* @param {Config} combined
* @param {Extension} extension
* @returns {undefined}
*/
function extension(combined, extension) {
	/** @type {keyof Extension} */
	let key;
	for (key in extension) if (own$2.call(extension, key)) switch (key) {
		case "canContainEols": {
			const right = extension[key];
			if (right) combined[key].push(...right);
			break;
		}
		case "transforms": {
			const right = extension[key];
			if (right) combined[key].push(...right);
			break;
		}
		case "enter":
		case "exit": {
			const right = extension[key];
			if (right) Object.assign(combined[key], right);
			break;
		}
	}
}
/** @type {OnEnterError} */
function defaultOnError(left, right) {
	if (left) throw new Error("Cannot close `" + left.type + "` (" + stringifyPosition({
		start: left.start,
		end: left.end
	}) + "): a different token (`" + right.type + "`, " + stringifyPosition({
		start: right.start,
		end: right.end
	}) + ") is open");
	else throw new Error("Cannot close document, a token (`" + right.type + "`, " + stringifyPosition({
		start: right.start,
		end: right.end
	}) + ") is still open");
}
//#endregion
//#region ../../node_modules/remark-parse/lib/index.js
/**
* @typedef {import('mdast').Root} Root
* @typedef {import('mdast-util-from-markdown').Options} FromMarkdownOptions
* @typedef {import('unified').Parser<Root>} Parser
* @typedef {import('unified').Processor<Root>} Processor
*/
/**
* @typedef {Omit<FromMarkdownOptions, 'extensions' | 'mdastExtensions'>} Options
*/
/**
* Aadd support for parsing from markdown.
*
* @param {Readonly<Options> | null | undefined} [options]
*   Configuration (optional).
* @returns {undefined}
*   Nothing.
*/
function remarkParse(options) {
	/** @type {Processor} */
	const self = this;
	self.parser = parser;
	/**
	* @type {Parser}
	*/
	function parser(doc) {
		return fromMarkdown(doc, {
			...self.data("settings"),
			...options,
			extensions: self.data("micromarkExtensions") || [],
			mdastExtensions: self.data("fromMarkdownExtensions") || []
		});
	}
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/blockquote.js
/**
* @import {Element} from 'hast'
* @import {Blockquote} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `blockquote` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Blockquote} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function blockquote$1(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "blockquote",
		properties: {},
		children: state.wrap(state.all(node), true)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/break.js
/**
* @import {Element, Text} from 'hast'
* @import {Break} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `break` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Break} node
*   mdast node.
* @returns {Array<Element | Text>}
*   hast element content.
*/
function hardBreak$1(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "br",
		properties: {},
		children: []
	};
	state.patch(node, result);
	return [state.applyData(node, result), {
		type: "text",
		value: "\n"
	}];
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/code.js
/**
* @import {Element, Properties} from 'hast'
* @import {Code} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `code` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Code} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function code$2(state, node) {
	const value = node.value ? node.value + "\n" : "";
	/** @type {Properties} */
	const properties = {};
	const language = node.lang ? node.lang.split(/\s+/) : [];
	if (language.length > 0) properties.className = ["language-" + language[0]];
	/** @type {Element} */
	let result = {
		type: "element",
		tagName: "code",
		properties,
		children: [{
			type: "text",
			value
		}]
	};
	if (node.meta) result.data = { meta: node.meta };
	state.patch(node, result);
	result = state.applyData(node, result);
	result = {
		type: "element",
		tagName: "pre",
		properties: {},
		children: [result]
	};
	state.patch(node, result);
	return result;
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/delete.js
/**
* @import {Element} from 'hast'
* @import {Delete} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `delete` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Delete} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function strikethrough(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "del",
		properties: {},
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/emphasis.js
/**
* @import {Element} from 'hast'
* @import {Emphasis} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `emphasis` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Emphasis} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function emphasis$1(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "em",
		properties: {},
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/footnote-reference.js
/**
* @import {Element} from 'hast'
* @import {FootnoteReference} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `footnoteReference` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {FootnoteReference} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function footnoteReference$1(state, node) {
	const clobberPrefix = typeof state.options.clobberPrefix === "string" ? state.options.clobberPrefix : "user-content-";
	const id = String(node.identifier).toUpperCase();
	const safeId = normalizeUri(id.toLowerCase());
	const index = state.footnoteOrder.indexOf(id);
	/** @type {number} */
	let counter;
	let reuseCounter = state.footnoteCounts.get(id);
	if (reuseCounter === void 0) {
		reuseCounter = 0;
		state.footnoteOrder.push(id);
		counter = state.footnoteOrder.length;
	} else counter = index + 1;
	reuseCounter += 1;
	state.footnoteCounts.set(id, reuseCounter);
	/** @type {Element} */
	const link = {
		type: "element",
		tagName: "a",
		properties: {
			href: "#" + clobberPrefix + "fn-" + safeId,
			id: clobberPrefix + "fnref-" + safeId + (reuseCounter > 1 ? "-" + reuseCounter : ""),
			dataFootnoteRef: true,
			ariaDescribedBy: ["footnote-label"]
		},
		children: [{
			type: "text",
			value: String(counter)
		}]
	};
	state.patch(node, link);
	/** @type {Element} */
	const sup = {
		type: "element",
		tagName: "sup",
		properties: {},
		children: [link]
	};
	state.patch(node, sup);
	return state.applyData(node, sup);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/heading.js
/**
* @import {Element} from 'hast'
* @import {Heading} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `heading` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Heading} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function heading$1(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "h" + node.depth,
		properties: {},
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/html.js
/**
* @import {Element} from 'hast'
* @import {Html} from 'mdast'
* @import {State} from '../state.js'
* @import {Raw} from '../../index.js'
*/
/**
* Turn an mdast `html` node into hast (`raw` node in dangerous mode, otherwise
* nothing).
*
* @param {State} state
*   Info passed around.
* @param {Html} node
*   mdast node.
* @returns {Element | Raw | undefined}
*   hast node.
*/
function html$1(state, node) {
	if (state.options.allowDangerousHtml) {
		/** @type {Raw} */
		const result = {
			type: "raw",
			value: node.value
		};
		state.patch(node, result);
		return state.applyData(node, result);
	}
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/revert.js
/**
* @import {ElementContent} from 'hast'
* @import {Reference, Nodes} from 'mdast'
* @import {State} from './state.js'
*/
/**
* Return the content of a reference without definition as plain text.
*
* @param {State} state
*   Info passed around.
* @param {Extract<Nodes, Reference>} node
*   Reference node (image, link).
* @returns {Array<ElementContent>}
*   hast content.
*/
function revert(state, node) {
	const subtype = node.referenceType;
	let suffix = "]";
	if (subtype === "collapsed") suffix += "[]";
	else if (subtype === "full") suffix += "[" + (node.label || node.identifier) + "]";
	if (node.type === "imageReference") return [{
		type: "text",
		value: "![" + node.alt + suffix
	}];
	const contents = state.all(node);
	const head = contents[0];
	if (head && head.type === "text") head.value = "[" + head.value;
	else contents.unshift({
		type: "text",
		value: "["
	});
	const tail = contents[contents.length - 1];
	if (tail && tail.type === "text") tail.value += suffix;
	else contents.push({
		type: "text",
		value: suffix
	});
	return contents;
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/image-reference.js
/**
* @import {ElementContent, Element, Properties} from 'hast'
* @import {ImageReference} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `imageReference` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {ImageReference} node
*   mdast node.
* @returns {Array<ElementContent> | ElementContent}
*   hast node.
*/
function imageReference$1(state, node) {
	const id = String(node.identifier).toUpperCase();
	const definition = state.definitionById.get(id);
	if (!definition) return revert(state, node);
	/** @type {Properties} */
	const properties = {
		src: normalizeUri(definition.url || ""),
		alt: node.alt
	};
	if (definition.title !== null && definition.title !== void 0) properties.title = definition.title;
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "img",
		properties,
		children: []
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/image.js
/**
* @import {Element, Properties} from 'hast'
* @import {Image} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `image` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Image} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function image$1(state, node) {
	/** @type {Properties} */
	const properties = { src: normalizeUri(node.url) };
	if (node.alt !== null && node.alt !== void 0) properties.alt = node.alt;
	if (node.title !== null && node.title !== void 0) properties.title = node.title;
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "img",
		properties,
		children: []
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/inline-code.js
/**
* @import {Element, Text} from 'hast'
* @import {InlineCode} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `inlineCode` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {InlineCode} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function inlineCode$1(state, node) {
	/** @type {Text} */
	const text = {
		type: "text",
		value: node.value.replace(/\r?\n|\r/g, " ")
	};
	state.patch(node, text);
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "code",
		properties: {},
		children: [text]
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/link-reference.js
/**
* @import {ElementContent, Element, Properties} from 'hast'
* @import {LinkReference} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `linkReference` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {LinkReference} node
*   mdast node.
* @returns {Array<ElementContent> | ElementContent}
*   hast node.
*/
function linkReference$1(state, node) {
	const id = String(node.identifier).toUpperCase();
	const definition = state.definitionById.get(id);
	if (!definition) return revert(state, node);
	/** @type {Properties} */
	const properties = { href: normalizeUri(definition.url || "") };
	if (definition.title !== null && definition.title !== void 0) properties.title = definition.title;
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "a",
		properties,
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/link.js
/**
* @import {Element, Properties} from 'hast'
* @import {Link} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `link` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Link} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function link$1(state, node) {
	/** @type {Properties} */
	const properties = { href: normalizeUri(node.url) };
	if (node.title !== null && node.title !== void 0) properties.title = node.title;
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "a",
		properties,
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/list-item.js
/**
* @import {ElementContent, Element, Properties} from 'hast'
* @import {ListItem, Parents} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `listItem` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {ListItem} node
*   mdast node.
* @param {Parents | undefined} parent
*   Parent of `node`.
* @returns {Element}
*   hast node.
*/
function listItem$1(state, node, parent) {
	const results = state.all(node);
	const loose = parent ? listLoose(parent) : listItemLoose(node);
	/** @type {Properties} */
	const properties = {};
	/** @type {Array<ElementContent>} */
	const children = [];
	if (typeof node.checked === "boolean") {
		const head = results[0];
		/** @type {Element} */
		let paragraph;
		if (head && head.type === "element" && head.tagName === "p") paragraph = head;
		else {
			paragraph = {
				type: "element",
				tagName: "p",
				properties: {},
				children: []
			};
			results.unshift(paragraph);
		}
		if (paragraph.children.length > 0) paragraph.children.unshift({
			type: "text",
			value: " "
		});
		paragraph.children.unshift({
			type: "element",
			tagName: "input",
			properties: {
				type: "checkbox",
				checked: node.checked,
				disabled: true
			},
			children: []
		});
		properties.className = ["task-list-item"];
	}
	let index = -1;
	while (++index < results.length) {
		const child = results[index];
		if (loose || index !== 0 || child.type !== "element" || child.tagName !== "p") children.push({
			type: "text",
			value: "\n"
		});
		if (child.type === "element" && child.tagName === "p" && !loose) children.push(...child.children);
		else children.push(child);
	}
	const tail = results[results.length - 1];
	if (tail && (loose || tail.type !== "element" || tail.tagName !== "p")) children.push({
		type: "text",
		value: "\n"
	});
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "li",
		properties,
		children
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
/**
* @param {Parents} node
* @return {Boolean}
*/
function listLoose(node) {
	let loose = false;
	if (node.type === "list") {
		loose = node.spread || false;
		const children = node.children;
		let index = -1;
		while (!loose && ++index < children.length) loose = listItemLoose(children[index]);
	}
	return loose;
}
/**
* @param {ListItem} node
* @return {Boolean}
*/
function listItemLoose(node) {
	const spread = node.spread;
	return spread === null || spread === void 0 ? node.children.length > 1 : spread;
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/list.js
/**
* @import {Element, Properties} from 'hast'
* @import {List} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `list` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {List} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function list$1(state, node) {
	/** @type {Properties} */
	const properties = {};
	const results = state.all(node);
	let index = -1;
	if (typeof node.start === "number" && node.start !== 1) properties.start = node.start;
	while (++index < results.length) {
		const child = results[index];
		if (child.type === "element" && child.tagName === "li" && child.properties && Array.isArray(child.properties.className) && child.properties.className.includes("task-list-item")) {
			properties.className = ["contains-task-list"];
			break;
		}
	}
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: node.ordered ? "ol" : "ul",
		properties,
		children: state.wrap(results, true)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/paragraph.js
/**
* @import {Element} from 'hast'
* @import {Paragraph} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `paragraph` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Paragraph} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function paragraph$1(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "p",
		properties: {},
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/root.js
/**
* @import {Parents as HastParents, Root as HastRoot} from 'hast'
* @import {Root as MdastRoot} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `root` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {MdastRoot} node
*   mdast node.
* @returns {HastParents}
*   hast node.
*/
function root$1(state, node) {
	/** @type {HastRoot} */
	const result = {
		type: "root",
		children: state.wrap(state.all(node))
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/strong.js
/**
* @import {Element} from 'hast'
* @import {Strong} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `strong` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Strong} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function strong$1(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "strong",
		properties: {},
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/table.js
/**
* @import {Table} from 'mdast'
* @import {Element} from 'hast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `table` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {Table} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function table(state, node) {
	const rows = state.all(node);
	const firstRow = rows.shift();
	/** @type {Array<Element>} */
	const tableContent = [];
	if (firstRow) {
		/** @type {Element} */
		const head = {
			type: "element",
			tagName: "thead",
			properties: {},
			children: state.wrap([firstRow], true)
		};
		state.patch(node.children[0], head);
		tableContent.push(head);
	}
	if (rows.length > 0) {
		/** @type {Element} */
		const body = {
			type: "element",
			tagName: "tbody",
			properties: {},
			children: state.wrap(rows, true)
		};
		const start = pointStart(node.children[1]);
		const end = pointEnd(node.children[node.children.length - 1]);
		if (start && end) body.position = {
			start,
			end
		};
		tableContent.push(body);
	}
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "table",
		properties: {},
		children: state.wrap(tableContent, true)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/table-row.js
/**
* @import {Element, ElementContent, Properties} from 'hast'
* @import {Parents, TableRow} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `tableRow` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {TableRow} node
*   mdast node.
* @param {Parents | undefined} parent
*   Parent of `node`.
* @returns {Element}
*   hast node.
*/
function tableRow(state, node, parent) {
	const siblings = parent ? parent.children : void 0;
	const tagName = (siblings ? siblings.indexOf(node) : 1) === 0 ? "th" : "td";
	const align = parent && parent.type === "table" ? parent.align : void 0;
	const length = align ? align.length : node.children.length;
	let cellIndex = -1;
	/** @type {Array<ElementContent>} */
	const cells = [];
	while (++cellIndex < length) {
		const cell = node.children[cellIndex];
		/** @type {Properties} */
		const properties = {};
		const alignValue = align ? align[cellIndex] : void 0;
		if (alignValue) properties.align = alignValue;
		/** @type {Element} */
		let result = {
			type: "element",
			tagName,
			properties,
			children: []
		};
		if (cell) {
			result.children = state.all(cell);
			state.patch(cell, result);
			result = state.applyData(cell, result);
		}
		cells.push(result);
	}
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "tr",
		properties: {},
		children: state.wrap(cells, true)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/table-cell.js
/**
* @import {Element} from 'hast'
* @import {TableCell} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `tableCell` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {TableCell} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function tableCell(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "td",
		properties: {},
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/trim-lines/index.js
var tab = 9;
var space = 32;
/**
* Remove initial and final spaces and tabs at the line breaks in `value`.
* Does not trim initial and final spaces and tabs of the value itself.
*
* @param {string} value
*   Value to trim.
* @returns {string}
*   Trimmed value.
*/
function trimLines(value) {
	const source = String(value);
	const search = /\r?\n|\r/g;
	let match = search.exec(source);
	let last = 0;
	/** @type {Array<string>} */
	const lines = [];
	while (match) {
		lines.push(trimLine(source.slice(last, match.index), last > 0, true), match[0]);
		last = match.index + match[0].length;
		match = search.exec(source);
	}
	lines.push(trimLine(source.slice(last), last > 0, false));
	return lines.join("");
}
/**
* @param {string} value
*   Line to trim.
* @param {boolean} start
*   Whether to trim the start of the line.
* @param {boolean} end
*   Whether to trim the end of the line.
* @returns {string}
*   Trimmed line.
*/
function trimLine(value, start, end) {
	let startIndex = 0;
	let endIndex = value.length;
	if (start) {
		let code = value.codePointAt(startIndex);
		while (code === tab || code === space) {
			startIndex++;
			code = value.codePointAt(startIndex);
		}
	}
	if (end) {
		let code = value.codePointAt(endIndex - 1);
		while (code === tab || code === space) {
			endIndex--;
			code = value.codePointAt(endIndex - 1);
		}
	}
	return endIndex > startIndex ? value.slice(startIndex, endIndex) : "";
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/text.js
/**
* @import {Element as HastElement, Text as HastText} from 'hast'
* @import {Text as MdastText} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `text` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {MdastText} node
*   mdast node.
* @returns {HastElement | HastText}
*   hast node.
*/
function text$2(state, node) {
	/** @type {HastText} */
	const result = {
		type: "text",
		value: trimLines(String(node.value))
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/thematic-break.js
/**
* @import {Element} from 'hast'
* @import {ThematicBreak} from 'mdast'
* @import {State} from '../state.js'
*/
/**
* Turn an mdast `thematicBreak` node into hast.
*
* @param {State} state
*   Info passed around.
* @param {ThematicBreak} node
*   mdast node.
* @returns {Element}
*   hast node.
*/
function thematicBreak$1(state, node) {
	/** @type {Element} */
	const result = {
		type: "element",
		tagName: "hr",
		properties: {},
		children: []
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/handlers/index.js
/**
* @import {Handlers} from '../state.js'
*/
/**
* Default handlers for nodes.
*
* @satisfies {Handlers}
*/
var handlers = {
	blockquote: blockquote$1,
	break: hardBreak$1,
	code: code$2,
	delete: strikethrough,
	emphasis: emphasis$1,
	footnoteReference: footnoteReference$1,
	heading: heading$1,
	html: html$1,
	imageReference: imageReference$1,
	image: image$1,
	inlineCode: inlineCode$1,
	linkReference: linkReference$1,
	link: link$1,
	listItem: listItem$1,
	list: list$1,
	paragraph: paragraph$1,
	root: root$1,
	strong: strong$1,
	table,
	tableCell,
	tableRow,
	text: text$2,
	thematicBreak: thematicBreak$1,
	toml: ignore,
	yaml: ignore,
	definition: ignore,
	footnoteDefinition: ignore
};
function ignore() {}
//#endregion
//#region ../../node_modules/@ungap/structured-clone/esm/deserialize.js
var env = typeof self === "object" ? self : globalThis;
var guard = (name, init) => {
	switch (name) {
		case "Function":
		case "SharedWorker":
		case "Worker":
		case "eval":
		case "setInterval":
		case "setTimeout": throw new TypeError("unable to deserialize " + name);
	}
	return new env[name](init);
};
var deserializer = ($, _) => {
	const as = (out, index) => {
		$.set(index, out);
		return out;
	};
	const unpair = (index) => {
		if ($.has(index)) return $.get(index);
		const [type, value] = _[index];
		switch (type) {
			case 0:
			case -1: return as(value, index);
			case 1: {
				const arr = as([], index);
				for (const index of value) arr.push(unpair(index));
				return arr;
			}
			case 2: {
				const object = as({}, index);
				for (const [key, index] of value) object[unpair(key)] = unpair(index);
				return object;
			}
			case 3: return as(new Date(value), index);
			case 4: {
				const { source, flags } = value;
				return as(new RegExp(source, flags), index);
			}
			case 5: {
				const map = as(/* @__PURE__ */ new Map(), index);
				for (const [key, index] of value) map.set(unpair(key), unpair(index));
				return map;
			}
			case 6: {
				const set = as(/* @__PURE__ */ new Set(), index);
				for (const index of value) set.add(unpair(index));
				return set;
			}
			case 7: {
				const { name, message } = value;
				return as(guard(name, message), index);
			}
			case 8: return as(BigInt(value), index);
			case "BigInt": return as(Object(BigInt(value)), index);
			case "ArrayBuffer": return as(new Uint8Array(value).buffer, value);
			case "DataView": {
				const { buffer } = new Uint8Array(value);
				return as(new DataView(buffer), value);
			}
		}
		return as(guard(type, value), index);
	};
	return unpair;
};
/**
* @typedef {Array<string,any>} Record a type representation
*/
/**
* Returns a deserialized value from a serialized array of Records.
* @param {Record[]} serialized a previously serialized value.
* @returns {any}
*/
var deserialize = (serialized) => deserializer(/* @__PURE__ */ new Map(), serialized)(0);
//#endregion
//#region ../../node_modules/@ungap/structured-clone/esm/serialize.js
var EMPTY = "";
var { toString } = {};
var { keys } = Object;
var typeOf = (value) => {
	const type = typeof value;
	if (type !== "object" || !value) return [0, type];
	const asString = toString.call(value).slice(8, -1);
	switch (asString) {
		case "Array": return [1, EMPTY];
		case "Object": return [2, EMPTY];
		case "Date": return [3, EMPTY];
		case "RegExp": return [4, EMPTY];
		case "Map": return [5, EMPTY];
		case "Set": return [6, EMPTY];
		case "DataView": return [1, asString];
	}
	if (asString.includes("Array")) return [1, asString];
	if (asString.includes("Error")) return [7, asString];
	return [2, asString];
};
var shouldSkip = ([TYPE, type]) => TYPE === 0 && (type === "function" || type === "symbol");
var serializer = (strict, json, $, _) => {
	const as = (out, value) => {
		const index = _.push(out) - 1;
		$.set(value, index);
		return index;
	};
	const pair = (value) => {
		if ($.has(value)) return $.get(value);
		let [TYPE, type] = typeOf(value);
		switch (TYPE) {
			case 0: {
				let entry = value;
				switch (type) {
					case "bigint":
						TYPE = 8;
						entry = value.toString();
						break;
					case "function":
					case "symbol":
						if (strict) throw new TypeError("unable to serialize " + type);
						entry = null;
						break;
					case "undefined": return as([-1], value);
				}
				return as([TYPE, entry], value);
			}
			case 1: {
				if (type) {
					let spread = value;
					if (type === "DataView") spread = new Uint8Array(value.buffer);
					else if (type === "ArrayBuffer") spread = new Uint8Array(value);
					return as([type, [...spread]], value);
				}
				const arr = [];
				const index = as([TYPE, arr], value);
				for (const entry of value) arr.push(pair(entry));
				return index;
			}
			case 2: {
				if (type) switch (type) {
					case "BigInt": return as([type, value.toString()], value);
					case "Boolean":
					case "Number":
					case "String": return as([type, value.valueOf()], value);
				}
				if (json && "toJSON" in value) return pair(value.toJSON());
				const entries = [];
				const index = as([TYPE, entries], value);
				for (const key of keys(value)) if (strict || !shouldSkip(typeOf(value[key]))) entries.push([pair(key), pair(value[key])]);
				return index;
			}
			case 3: return as([TYPE, value.toISOString()], value);
			case 4: {
				const { source, flags } = value;
				return as([TYPE, {
					source,
					flags
				}], value);
			}
			case 5: {
				const entries = [];
				const index = as([TYPE, entries], value);
				for (const [key, entry] of value) if (strict || !(shouldSkip(typeOf(key)) || shouldSkip(typeOf(entry)))) entries.push([pair(key), pair(entry)]);
				return index;
			}
			case 6: {
				const entries = [];
				const index = as([TYPE, entries], value);
				for (const entry of value) if (strict || !shouldSkip(typeOf(entry))) entries.push(pair(entry));
				return index;
			}
		}
		const { message } = value;
		return as([TYPE, {
			name: type,
			message
		}], value);
	};
	return pair;
};
/**
* @typedef {Array<string,any>} Record a type representation
*/
/**
* Returns an array of serialized Records.
* @param {any} value a serializable value.
* @param {{json?: boolean, lossy?: boolean}?} options an object with a `lossy` or `json` property that,
*  if `true`, will not throw errors on incompatible types, and behave more
*  like JSON stringify would behave. Symbol and Function will be discarded.
* @returns {Record[]}
*/
var serialize$1 = (value, { json, lossy } = {}) => {
	const _ = [];
	return serializer(!(json || lossy), !!json, /* @__PURE__ */ new Map(), _)(value), _;
};
//#endregion
//#region ../../node_modules/@ungap/structured-clone/esm/index.js
/**
* @typedef {Array<string,any>} Record a type representation
*/
/**
* Returns an array of serialized Records.
* @param {any} any a serializable value.
* @param {{transfer?: any[], json?: boolean, lossy?: boolean}?} options an object with
* a transfer option (ignored when polyfilled) and/or non standard fields that
* fallback to the polyfill if present.
* @returns {Record[]}
*/
var esm_default = typeof structuredClone === "function" ?
/* c8 ignore start */
(any, options) => options && ("json" in options || "lossy" in options) ? deserialize(serialize$1(any, options)) : structuredClone(any) : (any, options) => deserialize(serialize$1(any, options));
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/footer.js
/**
* @import {ElementContent, Element} from 'hast'
* @import {State} from './state.js'
*/
/**
* @callback FootnoteBackContentTemplate
*   Generate content for the backreference dynamically.
*
*   For the following markdown:
*
*   ```markdown
*   Alpha[^micromark], bravo[^micromark], and charlie[^remark].
*
*   [^remark]: things about remark
*   [^micromark]: things about micromark
*   ```
*
*   This function will be called with:
*
*   *  `0` and `0` for the backreference from `things about micromark` to
*      `alpha`, as it is the first used definition, and the first call to it
*   *  `0` and `1` for the backreference from `things about micromark` to
*      `bravo`, as it is the first used definition, and the second call to it
*   *  `1` and `0` for the backreference from `things about remark` to
*      `charlie`, as it is the second used definition
* @param {number} referenceIndex
*   Index of the definition in the order that they are first referenced,
*   0-indexed.
* @param {number} rereferenceIndex
*   Index of calls to the same definition, 0-indexed.
* @returns {Array<ElementContent> | ElementContent | string}
*   Content for the backreference when linking back from definitions to their
*   reference.
*
* @callback FootnoteBackLabelTemplate
*   Generate a back label dynamically.
*
*   For the following markdown:
*
*   ```markdown
*   Alpha[^micromark], bravo[^micromark], and charlie[^remark].
*
*   [^remark]: things about remark
*   [^micromark]: things about micromark
*   ```
*
*   This function will be called with:
*
*   *  `0` and `0` for the backreference from `things about micromark` to
*      `alpha`, as it is the first used definition, and the first call to it
*   *  `0` and `1` for the backreference from `things about micromark` to
*      `bravo`, as it is the first used definition, and the second call to it
*   *  `1` and `0` for the backreference from `things about remark` to
*      `charlie`, as it is the second used definition
* @param {number} referenceIndex
*   Index of the definition in the order that they are first referenced,
*   0-indexed.
* @param {number} rereferenceIndex
*   Index of calls to the same definition, 0-indexed.
* @returns {string}
*   Back label to use when linking back from definitions to their reference.
*/
/**
* Generate the default content that GitHub uses on backreferences.
*
* @param {number} _
*   Index of the definition in the order that they are first referenced,
*   0-indexed.
* @param {number} rereferenceIndex
*   Index of calls to the same definition, 0-indexed.
* @returns {Array<ElementContent>}
*   Content.
*/
function defaultFootnoteBackContent(_, rereferenceIndex) {
	/** @type {Array<ElementContent>} */
	const result = [{
		type: "text",
		value: "↩"
	}];
	if (rereferenceIndex > 1) result.push({
		type: "element",
		tagName: "sup",
		properties: {},
		children: [{
			type: "text",
			value: String(rereferenceIndex)
		}]
	});
	return result;
}
/**
* Generate the default label that GitHub uses on backreferences.
*
* @param {number} referenceIndex
*   Index of the definition in the order that they are first referenced,
*   0-indexed.
* @param {number} rereferenceIndex
*   Index of calls to the same definition, 0-indexed.
* @returns {string}
*   Label.
*/
function defaultFootnoteBackLabel(referenceIndex, rereferenceIndex) {
	return "Back to reference " + (referenceIndex + 1) + (rereferenceIndex > 1 ? "-" + rereferenceIndex : "");
}
/**
* Generate a hast footer for called footnote definitions.
*
* @param {State} state
*   Info passed around.
* @returns {Element | undefined}
*   `section` element or `undefined`.
*/
function footer(state) {
	const clobberPrefix = typeof state.options.clobberPrefix === "string" ? state.options.clobberPrefix : "user-content-";
	const footnoteBackContent = state.options.footnoteBackContent || defaultFootnoteBackContent;
	const footnoteBackLabel = state.options.footnoteBackLabel || defaultFootnoteBackLabel;
	const footnoteLabel = state.options.footnoteLabel || "Footnotes";
	const footnoteLabelTagName = state.options.footnoteLabelTagName || "h2";
	const footnoteLabelProperties = state.options.footnoteLabelProperties || { className: ["sr-only"] };
	/** @type {Array<ElementContent>} */
	const listItems = [];
	let referenceIndex = -1;
	while (++referenceIndex < state.footnoteOrder.length) {
		const definition = state.footnoteById.get(state.footnoteOrder[referenceIndex]);
		if (!definition) continue;
		const content = state.all(definition);
		const id = String(definition.identifier).toUpperCase();
		const safeId = normalizeUri(id.toLowerCase());
		let rereferenceIndex = 0;
		/** @type {Array<ElementContent>} */
		const backReferences = [];
		const counts = state.footnoteCounts.get(id);
		while (counts !== void 0 && ++rereferenceIndex <= counts) {
			if (backReferences.length > 0) backReferences.push({
				type: "text",
				value: " "
			});
			let children = typeof footnoteBackContent === "string" ? footnoteBackContent : footnoteBackContent(referenceIndex, rereferenceIndex);
			if (typeof children === "string") children = {
				type: "text",
				value: children
			};
			backReferences.push({
				type: "element",
				tagName: "a",
				properties: {
					href: "#" + clobberPrefix + "fnref-" + safeId + (rereferenceIndex > 1 ? "-" + rereferenceIndex : ""),
					dataFootnoteBackref: "",
					ariaLabel: typeof footnoteBackLabel === "string" ? footnoteBackLabel : footnoteBackLabel(referenceIndex, rereferenceIndex),
					className: ["data-footnote-backref"]
				},
				children: Array.isArray(children) ? children : [children]
			});
		}
		const tail = content[content.length - 1];
		if (tail && tail.type === "element" && tail.tagName === "p") {
			const tailTail = tail.children[tail.children.length - 1];
			if (tailTail && tailTail.type === "text") tailTail.value += " ";
			else tail.children.push({
				type: "text",
				value: " "
			});
			tail.children.push(...backReferences);
		} else content.push(...backReferences);
		/** @type {Element} */
		const listItem = {
			type: "element",
			tagName: "li",
			properties: { id: clobberPrefix + "fn-" + safeId },
			children: state.wrap(content, true)
		};
		state.patch(definition, listItem);
		listItems.push(listItem);
	}
	if (listItems.length === 0) return;
	return {
		type: "element",
		tagName: "section",
		properties: {
			dataFootnotes: true,
			className: ["footnotes"]
		},
		children: [
			{
				type: "element",
				tagName: footnoteLabelTagName,
				properties: {
					...esm_default(footnoteLabelProperties),
					id: "footnote-label"
				},
				children: [{
					type: "text",
					value: footnoteLabel
				}]
			},
			{
				type: "text",
				value: "\n"
			},
			{
				type: "element",
				tagName: "ol",
				properties: {},
				children: state.wrap(listItems, true)
			},
			{
				type: "text",
				value: "\n"
			}
		]
	};
}
//#endregion
//#region ../../node_modules/unist-util-is/lib/index.js
/**
* Generate an assertion from a test.
*
* Useful if you’re going to test many nodes, for example when creating a
* utility where something else passes a compatible test.
*
* The created function is a bit faster because it expects valid input only:
* a `node`, `index`, and `parent`.
*
* @param {Test} test
*   *   when nullish, checks if `node` is a `Node`.
*   *   when `string`, works like passing `(node) => node.type === test`.
*   *   when `function` checks if function passed the node is true.
*   *   when `object`, checks that all keys in test are in node, and that they have (strictly) equal values.
*   *   when `array`, checks if any one of the subtests pass.
* @returns {Check}
*   An assertion.
*/
var convert = (
/**
* @param {Test} [test]
* @returns {Check}
*/
function(test) {
	if (test === null || test === void 0) return ok;
	if (typeof test === "function") return castFactory(test);
	if (typeof test === "object") return Array.isArray(test) ? anyFactory(test) : propertiesFactory(test);
	if (typeof test === "string") return typeFactory(test);
	throw new Error("Expected function, string, or object as test");
});
/**
* @param {Array<Props | TestFunction | string>} tests
* @returns {Check}
*/
function anyFactory(tests) {
	/** @type {Array<Check>} */
	const checks = [];
	let index = -1;
	while (++index < tests.length) checks[index] = convert(tests[index]);
	return castFactory(any);
	/**
	* @this {unknown}
	* @type {TestFunction}
	*/
	function any(...parameters) {
		let index = -1;
		while (++index < checks.length) if (checks[index].apply(this, parameters)) return true;
		return false;
	}
}
/**
* Turn an object into a test for a node with a certain fields.
*
* @param {Props} check
* @returns {Check}
*/
function propertiesFactory(check) {
	const checkAsRecord = check;
	return castFactory(all);
	/**
	* @param {Node} node
	* @returns {boolean}
	*/
	function all(node) {
		const nodeAsRecord = node;
		/** @type {string} */
		let key;
		for (key in check) if (nodeAsRecord[key] !== checkAsRecord[key]) return false;
		return true;
	}
}
/**
* Turn a string into a test for a node with a certain type.
*
* @param {string} check
* @returns {Check}
*/
function typeFactory(check) {
	return castFactory(type);
	/**
	* @param {Node} node
	*/
	function type(node) {
		return node && node.type === check;
	}
}
/**
* Turn a custom test into a test for a node that passes that test.
*
* @param {TestFunction} testFunction
* @returns {Check}
*/
function castFactory(testFunction) {
	return check;
	/**
	* @this {unknown}
	* @type {Check}
	*/
	function check(value, index, parent) {
		return Boolean(looksLikeANode(value) && testFunction.call(this, value, typeof index === "number" ? index : void 0, parent || void 0));
	}
}
function ok() {
	return true;
}
/**
* @param {unknown} value
* @returns {value is Node}
*/
function looksLikeANode(value) {
	return value !== null && typeof value === "object" && "type" in value;
}
//#endregion
//#region ../../node_modules/unist-util-visit-parents/lib/color.js
/**
* @param {string} d
* @returns {string}
*/
function color(d) {
	return d;
}
//#endregion
//#region ../../node_modules/unist-util-visit-parents/lib/index.js
/**
* @import {Node as UnistNode, Parent as UnistParent} from 'unist'
*/
/**
* @typedef {Exclude<import('unist-util-is').Test, undefined> | undefined} Test
*   Test from `unist-util-is`.
*
*   Note: we have remove and add `undefined`, because otherwise when generating
*   automatic `.d.ts` files, TS tries to flatten paths from a local perspective,
*   which doesn’t work when publishing on npm.
*/
/**
* @typedef {(
*   Fn extends (value: any) => value is infer Thing
*   ? Thing
*   : Fallback
* )} Predicate
*   Get the value of a type guard `Fn`.
* @template Fn
*   Value; typically function that is a type guard (such as `(x): x is Y`).
* @template Fallback
*   Value to yield if `Fn` is not a type guard.
*/
/**
* @typedef {(
*   Check extends null | undefined // No test.
*   ? Value
*   : Value extends {type: Check} // String (type) test.
*   ? Value
*   : Value extends Check // Partial test.
*   ? Value
*   : Check extends Function // Function test.
*   ? Predicate<Check, Value> extends Value
*     ? Predicate<Check, Value>
*     : never
*   : never // Some other test?
* )} MatchesOne
*   Check whether a node matches a primitive check in the type system.
* @template Value
*   Value; typically unist `Node`.
* @template Check
*   Value; typically `unist-util-is`-compatible test, but not arrays.
*/
/**
* @typedef {(
*   Check extends ReadonlyArray<infer T>
*   ? MatchesOne<Value, T>
*   : Check extends Array<infer T>
*   ? MatchesOne<Value, T>
*   : MatchesOne<Value, Check>
* )} Matches
*   Check whether a node matches a check in the type system.
* @template Value
*   Value; typically unist `Node`.
* @template Check
*   Value; typically `unist-util-is`-compatible test.
*/
/**
* @typedef {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10} Uint
*   Number; capped reasonably.
*/
/**
* @typedef {I extends 0 ? 1 : I extends 1 ? 2 : I extends 2 ? 3 : I extends 3 ? 4 : I extends 4 ? 5 : I extends 5 ? 6 : I extends 6 ? 7 : I extends 7 ? 8 : I extends 8 ? 9 : 10} Increment
*   Increment a number in the type system.
* @template {Uint} [I=0]
*   Index.
*/
/**
* @typedef {(
*   Node extends UnistParent
*   ? Node extends {children: Array<infer Children>}
*     ? Child extends Children ? Node : never
*     : never
*   : never
* )} InternalParent
*   Collect nodes that can be parents of `Child`.
* @template {UnistNode} Node
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
*/
/**
* @typedef {InternalParent<InclusiveDescendant<Tree>, Child>} Parent
*   Collect nodes in `Tree` that can be parents of `Child`.
* @template {UnistNode} Tree
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
*/
/**
* @typedef {(
*   Depth extends Max
*   ? never
*   :
*     | InternalParent<Node, Child>
*     | InternalAncestor<Node, InternalParent<Node, Child>, Max, Increment<Depth>>
* )} InternalAncestor
*   Collect nodes in `Tree` that can be ancestors of `Child`.
* @template {UnistNode} Node
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
* @template {Uint} [Max=10]
*   Max; searches up to this depth.
* @template {Uint} [Depth=0]
*   Current depth.
*/
/**
* @typedef {InternalAncestor<InclusiveDescendant<Tree>, Child>} Ancestor
*   Collect nodes in `Tree` that can be ancestors of `Child`.
* @template {UnistNode} Tree
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
*/
/**
* @typedef {(
*   Tree extends UnistParent
*     ? Depth extends Max
*       ? Tree
*       : Tree | InclusiveDescendant<Tree['children'][number], Max, Increment<Depth>>
*     : Tree
* )} InclusiveDescendant
*   Collect all (inclusive) descendants of `Tree`.
*
*   > 👉 **Note**: for performance reasons, this seems to be the fastest way to
*   > recurse without actually running into an infinite loop, which the
*   > previous version did.
*   >
*   > Practically, a max of `2` is typically enough assuming a `Root` is
*   > passed, but it doesn’t improve performance.
*   > It gets higher with `List > ListItem > Table > TableRow > TableCell`.
*   > Using up to `10` doesn’t hurt or help either.
* @template {UnistNode} Tree
*   Tree type.
* @template {Uint} [Max=10]
*   Max; searches up to this depth.
* @template {Uint} [Depth=0]
*   Current depth.
*/
/**
* @typedef {'skip' | boolean} Action
*   Union of the action types.
*
* @typedef {number} Index
*   Move to the sibling at `index` next (after node itself is completely
*   traversed).
*
*   Useful if mutating the tree, such as removing the node the visitor is
*   currently on, or any of its previous siblings.
*   Results less than 0 or greater than or equal to `children.length` stop
*   traversing the parent.
*
* @typedef {[(Action | null | undefined | void)?, (Index | null | undefined)?]} ActionTuple
*   List with one or two values, the first an action, the second an index.
*
* @typedef {Action | ActionTuple | Index | null | undefined | void} VisitorResult
*   Any value that can be returned from a visitor.
*/
/**
* @callback Visitor
*   Handle a node (matching `test`, if given).
*
*   Visitors are free to transform `node`.
*   They can also transform the parent of node (the last of `ancestors`).
*
*   Replacing `node` itself, if `SKIP` is not returned, still causes its
*   descendants to be walked (which is a bug).
*
*   When adding or removing previous siblings of `node` (or next siblings, in
*   case of reverse), the `Visitor` should return a new `Index` to specify the
*   sibling to traverse after `node` is traversed.
*   Adding or removing next siblings of `node` (or previous siblings, in case
*   of reverse) is handled as expected without needing to return a new `Index`.
*
*   Removing the children property of an ancestor still results in them being
*   traversed.
* @param {Visited} node
*   Found node.
* @param {Array<VisitedParents>} ancestors
*   Ancestors of `node`.
* @returns {VisitorResult}
*   What to do next.
*
*   An `Index` is treated as a tuple of `[CONTINUE, Index]`.
*   An `Action` is treated as a tuple of `[Action]`.
*
*   Passing a tuple back only makes sense if the `Action` is `SKIP`.
*   When the `Action` is `EXIT`, that action can be returned.
*   When the `Action` is `CONTINUE`, `Index` can be returned.
* @template {UnistNode} [Visited=UnistNode]
*   Visited node type.
* @template {UnistParent} [VisitedParents=UnistParent]
*   Ancestor type.
*/
/**
* @typedef {Visitor<Matches<InclusiveDescendant<Tree>, Check>, Ancestor<Tree, Matches<InclusiveDescendant<Tree>, Check>>>} BuildVisitor
*   Build a typed `Visitor` function from a tree and a test.
*
*   It will infer which values are passed as `node` and which as `parents`.
* @template {UnistNode} [Tree=UnistNode]
*   Tree type.
* @template {Test} [Check=Test]
*   Test type.
*/
/** @type {Readonly<ActionTuple>} */
var empty = [];
/**
* Visit nodes, with ancestral information.
*
* This algorithm performs *depth-first* *tree traversal* in *preorder*
* (**NLR**) or if `reverse` is given, in *reverse preorder* (**NRL**).
*
* You can choose for which nodes `visitor` is called by passing a `test`.
* For complex tests, you should test yourself in `visitor`, as it will be
* faster and will have improved type information.
*
* Walking the tree is an intensive task.
* Make use of the return values of the visitor when possible.
* Instead of walking a tree multiple times, walk it once, use `unist-util-is`
* to check if a node matches, and then perform different operations.
*
* You can change the tree.
* See `Visitor` for more info.
*
* @overload
* @param {Tree} tree
* @param {Check} check
* @param {BuildVisitor<Tree, Check>} visitor
* @param {boolean | null | undefined} [reverse]
* @returns {undefined}
*
* @overload
* @param {Tree} tree
* @param {BuildVisitor<Tree>} visitor
* @param {boolean | null | undefined} [reverse]
* @returns {undefined}
*
* @param {UnistNode} tree
*   Tree to traverse.
* @param {Visitor | Test} test
*   `unist-util-is`-compatible test
* @param {Visitor | boolean | null | undefined} [visitor]
*   Handle each node.
* @param {boolean | null | undefined} [reverse]
*   Traverse in reverse preorder (NRL) instead of the default preorder (NLR).
* @returns {undefined}
*   Nothing.
*
* @template {UnistNode} Tree
*   Node type.
* @template {Test} Check
*   `unist-util-is`-compatible test.
*/
function visitParents(tree, test, visitor, reverse) {
	/** @type {Test} */
	let check;
	if (typeof test === "function" && typeof visitor !== "function") {
		reverse = visitor;
		visitor = test;
	} else check = test;
	const is = convert(check);
	const step = reverse ? -1 : 1;
	factory(tree, void 0, [])();
	/**
	* @param {UnistNode} node
	* @param {number | undefined} index
	* @param {Array<UnistParent>} parents
	*/
	function factory(node, index, parents) {
		const value = node && typeof node === "object" ? node : {};
		if (typeof value.type === "string") {
			const name = typeof value.tagName === "string" ? value.tagName : typeof value.name === "string" ? value.name : void 0;
			Object.defineProperty(visit, "name", { value: "node (" + color(node.type + (name ? "<" + name + ">" : "")) + ")" });
		}
		return visit;
		function visit() {
			/** @type {Readonly<ActionTuple>} */
			let result = empty;
			/** @type {Readonly<ActionTuple>} */
			let subresult;
			/** @type {number} */
			let offset;
			/** @type {Array<UnistParent>} */
			let grandparents;
			if (!test || is(node, index, parents[parents.length - 1] || void 0)) {
				result = toResult(visitor(node, parents));
				if (result[0] === false) return result;
			}
			if ("children" in node && node.children) {
				const nodeAsParent = node;
				if (nodeAsParent.children && result[0] !== "skip") {
					offset = (reverse ? nodeAsParent.children.length : -1) + step;
					grandparents = parents.concat(nodeAsParent);
					while (offset > -1 && offset < nodeAsParent.children.length) {
						const child = nodeAsParent.children[offset];
						subresult = factory(child, offset, grandparents)();
						if (subresult[0] === false) return subresult;
						offset = typeof subresult[1] === "number" ? subresult[1] : offset + step;
					}
				}
			}
			return result;
		}
	}
}
/**
* Turn a return value into a clean result.
*
* @param {VisitorResult} value
*   Valid return values from visitors.
* @returns {Readonly<ActionTuple>}
*   Clean result.
*/
function toResult(value) {
	if (Array.isArray(value)) return value;
	if (typeof value === "number") return [true, value];
	return value === null || value === void 0 ? empty : [value];
}
//#endregion
//#region ../../node_modules/unist-util-visit/lib/index.js
/**
* @import {Node as UnistNode, Parent as UnistParent} from 'unist'
* @import {VisitorResult} from 'unist-util-visit-parents'
*/
/**
* @typedef {Exclude<import('unist-util-is').Test, undefined> | undefined} Test
*   Test from `unist-util-is`.
*
*   Note: we have remove and add `undefined`, because otherwise when generating
*   automatic `.d.ts` files, TS tries to flatten paths from a local perspective,
*   which doesn’t work when publishing on npm.
*/
/**
* @typedef {(
*   Fn extends (value: any) => value is infer Thing
*   ? Thing
*   : Fallback
* )} Predicate
*   Get the value of a type guard `Fn`.
* @template Fn
*   Value; typically function that is a type guard (such as `(x): x is Y`).
* @template Fallback
*   Value to yield if `Fn` is not a type guard.
*/
/**
* @typedef {(
*   Check extends null | undefined // No test.
*   ? Value
*   : Value extends {type: Check} // String (type) test.
*   ? Value
*   : Value extends Check // Partial test.
*   ? Value
*   : Check extends Function // Function test.
*   ? Predicate<Check, Value> extends Value
*     ? Predicate<Check, Value>
*     : never
*   : never // Some other test?
* )} MatchesOne
*   Check whether a node matches a primitive check in the type system.
* @template Value
*   Value; typically unist `Node`.
* @template Check
*   Value; typically `unist-util-is`-compatible test, but not arrays.
*/
/**
* @typedef {(
*   Check extends ReadonlyArray<any>
*   ? MatchesOne<Value, Check[number]>
*   : MatchesOne<Value, Check>
* )} Matches
*   Check whether a node matches a check in the type system.
* @template Value
*   Value; typically unist `Node`.
* @template Check
*   Value; typically `unist-util-is`-compatible test.
*/
/**
* @typedef {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10} Uint
*   Number; capped reasonably.
*/
/**
* @typedef {I extends 0 ? 1 : I extends 1 ? 2 : I extends 2 ? 3 : I extends 3 ? 4 : I extends 4 ? 5 : I extends 5 ? 6 : I extends 6 ? 7 : I extends 7 ? 8 : I extends 8 ? 9 : 10} Increment
*   Increment a number in the type system.
* @template {Uint} [I=0]
*   Index.
*/
/**
* @typedef {(
*   Node extends UnistParent
*   ? Node extends {children: Array<infer Children>}
*     ? Child extends Children ? Node : never
*     : never
*   : never
* )} InternalParent
*   Collect nodes that can be parents of `Child`.
* @template {UnistNode} Node
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
*/
/**
* @typedef {InternalParent<InclusiveDescendant<Tree>, Child>} Parent
*   Collect nodes in `Tree` that can be parents of `Child`.
* @template {UnistNode} Tree
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
*/
/**
* @typedef {(
*   Depth extends Max
*   ? never
*   :
*     | InternalParent<Node, Child>
*     | InternalAncestor<Node, InternalParent<Node, Child>, Max, Increment<Depth>>
* )} InternalAncestor
*   Collect nodes in `Tree` that can be ancestors of `Child`.
* @template {UnistNode} Node
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
* @template {Uint} [Max=10]
*   Max; searches up to this depth.
* @template {Uint} [Depth=0]
*   Current depth.
*/
/**
* @typedef {(
*   Tree extends UnistParent
*     ? Depth extends Max
*       ? Tree
*       : Tree | InclusiveDescendant<Tree['children'][number], Max, Increment<Depth>>
*     : Tree
* )} InclusiveDescendant
*   Collect all (inclusive) descendants of `Tree`.
*
*   > 👉 **Note**: for performance reasons, this seems to be the fastest way to
*   > recurse without actually running into an infinite loop, which the
*   > previous version did.
*   >
*   > Practically, a max of `2` is typically enough assuming a `Root` is
*   > passed, but it doesn’t improve performance.
*   > It gets higher with `List > ListItem > Table > TableRow > TableCell`.
*   > Using up to `10` doesn’t hurt or help either.
* @template {UnistNode} Tree
*   Tree type.
* @template {Uint} [Max=10]
*   Max; searches up to this depth.
* @template {Uint} [Depth=0]
*   Current depth.
*/
/**
* @callback Visitor
*   Handle a node (matching `test`, if given).
*
*   Visitors are free to transform `node`.
*   They can also transform `parent`.
*
*   Replacing `node` itself, if `SKIP` is not returned, still causes its
*   descendants to be walked (which is a bug).
*
*   When adding or removing previous siblings of `node` (or next siblings, in
*   case of reverse), the `Visitor` should return a new `Index` to specify the
*   sibling to traverse after `node` is traversed.
*   Adding or removing next siblings of `node` (or previous siblings, in case
*   of reverse) is handled as expected without needing to return a new `Index`.
*
*   Removing the children property of `parent` still results in them being
*   traversed.
* @param {Visited} node
*   Found node.
* @param {Visited extends UnistNode ? number | undefined : never} index
*   Index of `node` in `parent`.
* @param {Ancestor extends UnistParent ? Ancestor | undefined : never} parent
*   Parent of `node`.
* @returns {VisitorResult}
*   What to do next.
*
*   An `Index` is treated as a tuple of `[CONTINUE, Index]`.
*   An `Action` is treated as a tuple of `[Action]`.
*
*   Passing a tuple back only makes sense if the `Action` is `SKIP`.
*   When the `Action` is `EXIT`, that action can be returned.
*   When the `Action` is `CONTINUE`, `Index` can be returned.
* @template {UnistNode} [Visited=UnistNode]
*   Visited node type.
* @template {UnistParent} [Ancestor=UnistParent]
*   Ancestor type.
*/
/**
* @typedef {Visitor<Visited, Parent<Ancestor, Visited>>} BuildVisitorFromMatch
*   Build a typed `Visitor` function from a node and all possible parents.
*
*   It will infer which values are passed as `node` and which as `parent`.
* @template {UnistNode} Visited
*   Node type.
* @template {UnistParent} Ancestor
*   Parent type.
*/
/**
* @typedef {(
*   BuildVisitorFromMatch<
*     Matches<Descendant, Check>,
*     Extract<Descendant, UnistParent>
*   >
* )} BuildVisitorFromDescendants
*   Build a typed `Visitor` function from a list of descendants and a test.
*
*   It will infer which values are passed as `node` and which as `parent`.
* @template {UnistNode} Descendant
*   Node type.
* @template {Test} Check
*   Test type.
*/
/**
* @typedef {(
*   BuildVisitorFromDescendants<
*     InclusiveDescendant<Tree>,
*     Check
*   >
* )} BuildVisitor
*   Build a typed `Visitor` function from a tree and a test.
*
*   It will infer which values are passed as `node` and which as `parent`.
* @template {UnistNode} [Tree=UnistNode]
*   Node type.
* @template {Test} [Check=Test]
*   Test type.
*/
/**
* Visit nodes.
*
* This algorithm performs *depth-first* *tree traversal* in *preorder*
* (**NLR**) or if `reverse` is given, in *reverse preorder* (**NRL**).
*
* You can choose for which nodes `visitor` is called by passing a `test`.
* For complex tests, you should test yourself in `visitor`, as it will be
* faster and will have improved type information.
*
* Walking the tree is an intensive task.
* Make use of the return values of the visitor when possible.
* Instead of walking a tree multiple times, walk it once, use `unist-util-is`
* to check if a node matches, and then perform different operations.
*
* You can change the tree.
* See `Visitor` for more info.
*
* @overload
* @param {Tree} tree
* @param {Check} check
* @param {BuildVisitor<Tree, Check>} visitor
* @param {boolean | null | undefined} [reverse]
* @returns {undefined}
*
* @overload
* @param {Tree} tree
* @param {BuildVisitor<Tree>} visitor
* @param {boolean | null | undefined} [reverse]
* @returns {undefined}
*
* @param {UnistNode} tree
*   Tree to traverse.
* @param {Visitor | Test} testOrVisitor
*   `unist-util-is`-compatible test (optional, omit to pass a visitor).
* @param {Visitor | boolean | null | undefined} [visitorOrReverse]
*   Handle each node (when test is omitted, pass `reverse`).
* @param {boolean | null | undefined} [maybeReverse=false]
*   Traverse in reverse preorder (NRL) instead of the default preorder (NLR).
* @returns {undefined}
*   Nothing.
*
* @template {UnistNode} Tree
*   Node type.
* @template {Test} Check
*   `unist-util-is`-compatible test.
*/
function visit(tree, testOrVisitor, visitorOrReverse, maybeReverse) {
	/** @type {boolean | null | undefined} */
	let reverse;
	/** @type {Test} */
	let test;
	/** @type {Visitor} */
	let visitor;
	if (typeof testOrVisitor === "function" && typeof visitorOrReverse !== "function") {
		test = void 0;
		visitor = testOrVisitor;
		reverse = visitorOrReverse;
	} else {
		test = testOrVisitor;
		visitor = visitorOrReverse;
		reverse = maybeReverse;
	}
	visitParents(tree, test, overload, reverse);
	/**
	* @param {UnistNode} node
	* @param {Array<UnistParent>} parents
	*/
	function overload(node, parents) {
		const parent = parents[parents.length - 1];
		const index = parent ? parent.children.indexOf(node) : void 0;
		return visitor(node, index, parent);
	}
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/state.js
/**
* @import {
*   ElementContent as HastElementContent,
*   Element as HastElement,
*   Nodes as HastNodes,
*   Properties as HastProperties,
*   RootContent as HastRootContent,
*   Text as HastText
* } from 'hast'
* @import {
*   Definition as MdastDefinition,
*   FootnoteDefinition as MdastFootnoteDefinition,
*   Nodes as MdastNodes,
*   Parents as MdastParents
* } from 'mdast'
* @import {VFile} from 'vfile'
* @import {
*   FootnoteBackContentTemplate,
*   FootnoteBackLabelTemplate
* } from './footer.js'
*/
/**
* @callback Handler
*   Handle a node.
* @param {State} state
*   Info passed around.
* @param {any} node
*   mdast node to handle.
* @param {MdastParents | undefined} parent
*   Parent of `node`.
* @returns {Array<HastElementContent> | HastElementContent | undefined}
*   hast node.
*
* @typedef {Partial<Record<MdastNodes['type'], Handler>>} Handlers
*   Handle nodes.
*
* @typedef Options
*   Configuration (optional).
* @property {boolean | null | undefined} [allowDangerousHtml=false]
*   Whether to persist raw HTML in markdown in the hast tree (default:
*   `false`).
* @property {string | null | undefined} [clobberPrefix='user-content-']
*   Prefix to use before the `id` property on footnotes to prevent them from
*   *clobbering* (default: `'user-content-'`).
*
*   Pass `''` for trusted markdown and when you are careful with
*   polyfilling.
*   You could pass a different prefix.
*
*   DOM clobbering is this:
*
*   ```html
*   <p id="x"></p>
*   <script>alert(x) // `x` now refers to the `p#x` DOM element<\/script>
*   ```
*
*   The above example shows that elements are made available by browsers, by
*   their ID, on the `window` object.
*   This is a security risk because you might be expecting some other variable
*   at that place.
*   It can also break polyfills.
*   Using a prefix solves these problems.
* @property {VFile | null | undefined} [file]
*   Corresponding virtual file representing the input document (optional).
* @property {FootnoteBackContentTemplate | string | null | undefined} [footnoteBackContent]
*   Content of the backreference back to references (default: `defaultFootnoteBackContent`).
*
*   The default value is:
*
*   ```js
*   function defaultFootnoteBackContent(_, rereferenceIndex) {
*     const result = [{type: 'text', value: '↩'}]
*
*     if (rereferenceIndex > 1) {
*       result.push({
*         type: 'element',
*         tagName: 'sup',
*         properties: {},
*         children: [{type: 'text', value: String(rereferenceIndex)}]
*       })
*     }
*
*     return result
*   }
*   ```
*
*   This content is used in the `a` element of each backreference (the `↩`
*   links).
* @property {FootnoteBackLabelTemplate | string | null | undefined} [footnoteBackLabel]
*   Label to describe the backreference back to references (default:
*   `defaultFootnoteBackLabel`).
*
*   The default value is:
*
*   ```js
*   function defaultFootnoteBackLabel(referenceIndex, rereferenceIndex) {
*    return (
*      'Back to reference ' +
*      (referenceIndex + 1) +
*      (rereferenceIndex > 1 ? '-' + rereferenceIndex : '')
*    )
*   }
*   ```
*
*   Change it when the markdown is not in English.
*
*   This label is used in the `ariaLabel` property on each backreference
*   (the `↩` links).
*   It affects users of assistive technology.
* @property {string | null | undefined} [footnoteLabel='Footnotes']
*   Textual label to use for the footnotes section (default: `'Footnotes'`).
*
*   Change it when the markdown is not in English.
*
*   This label is typically hidden visually (assuming a `sr-only` CSS class
*   is defined that does that) and so affects screen readers only.
*   If you do have such a class, but want to show this section to everyone,
*   pass different properties with the `footnoteLabelProperties` option.
* @property {HastProperties | null | undefined} [footnoteLabelProperties={className: ['sr-only']}]
*   Properties to use on the footnote label (default: `{className:
*   ['sr-only']}`).
*
*   Change it to show the label and add other properties.
*
*   This label is typically hidden visually (assuming an `sr-only` CSS class
*   is defined that does that) and so affects screen readers only.
*   If you do have such a class, but want to show this section to everyone,
*   pass an empty string.
*   You can also add different properties.
*
*   > **Note**: `id: 'footnote-label'` is always added, because footnote
*   > calls use it with `aria-describedby` to provide an accessible label.
* @property {string | null | undefined} [footnoteLabelTagName='h2']
*   HTML tag name to use for the footnote label element (default: `'h2'`).
*
*   Change it to match your document structure.
*
*   This label is typically hidden visually (assuming a `sr-only` CSS class
*   is defined that does that) and so affects screen readers only.
*   If you do have such a class, but want to show this section to everyone,
*   pass different properties with the `footnoteLabelProperties` option.
* @property {Handlers | null | undefined} [handlers]
*   Extra handlers for nodes (optional).
* @property {Array<MdastNodes['type']> | null | undefined} [passThrough]
*   List of custom mdast node types to pass through (keep) in hast (note that
*   the node itself is passed, but eventual children are transformed)
*   (optional).
* @property {Handler | null | undefined} [unknownHandler]
*   Handler for all unknown nodes (optional).
*
* @typedef State
*   Info passed around.
* @property {(node: MdastNodes) => Array<HastElementContent>} all
*   Transform the children of an mdast parent to hast.
* @property {<Type extends HastNodes>(from: MdastNodes, to: Type) => HastElement | Type} applyData
*   Honor the `data` of `from`, and generate an element instead of `node`.
* @property {Map<string, MdastDefinition>} definitionById
*   Definitions by their identifier.
* @property {Map<string, MdastFootnoteDefinition>} footnoteById
*   Footnote definitions by their identifier.
* @property {Map<string, number>} footnoteCounts
*   Counts for how often the same footnote was called.
* @property {Array<string>} footnoteOrder
*   Identifiers of order when footnote calls first appear in tree order.
* @property {Handlers} handlers
*   Applied handlers.
* @property {(node: MdastNodes, parent: MdastParents | undefined) => Array<HastElementContent> | HastElementContent | undefined} one
*   Transform an mdast node to hast.
* @property {Options} options
*   Configuration.
* @property {(from: MdastNodes, node: HastNodes) => undefined} patch
*   Copy a node’s positional info.
* @property {<Type extends HastRootContent>(nodes: Array<Type>, loose?: boolean | undefined) => Array<HastText | Type>} wrap
*   Wrap `nodes` with line endings between each node, adds initial/final line endings when `loose`.
*/
var own$1 = {}.hasOwnProperty;
/** @type {Options} */
var emptyOptions$1 = {};
/**
* Create `state` from an mdast tree.
*
* @param {MdastNodes} tree
*   mdast node to transform.
* @param {Options | null | undefined} [options]
*   Configuration (optional).
* @returns {State}
*   `state` function.
*/
function createState(tree, options) {
	const settings = options || emptyOptions$1;
	/** @type {Map<string, MdastDefinition>} */
	const definitionById = /* @__PURE__ */ new Map();
	/** @type {Map<string, MdastFootnoteDefinition>} */
	const footnoteById = /* @__PURE__ */ new Map();
	/** @type {State} */
	const state = {
		all,
		applyData,
		definitionById,
		footnoteById,
		footnoteCounts: /* @__PURE__ */ new Map(),
		footnoteOrder: [],
		handlers: {
			...handlers,
			...settings.handlers
		},
		one,
		options: settings,
		patch,
		wrap: wrap$1
	};
	visit(tree, function(node) {
		if (node.type === "definition" || node.type === "footnoteDefinition") {
			const map = node.type === "definition" ? definitionById : footnoteById;
			const id = String(node.identifier).toUpperCase();
			if (!map.has(id)) map.set(id, node);
		}
	});
	return state;
	/**
	* Transform an mdast node into a hast node.
	*
	* @param {MdastNodes} node
	*   mdast node.
	* @param {MdastParents | undefined} [parent]
	*   Parent of `node`.
	* @returns {Array<HastElementContent> | HastElementContent | undefined}
	*   Resulting hast node.
	*/
	function one(node, parent) {
		const type = node.type;
		const handle = state.handlers[type];
		if (own$1.call(state.handlers, type) && handle) return handle(state, node, parent);
		if (state.options.passThrough && state.options.passThrough.includes(type)) {
			if ("children" in node) {
				const { children, ...shallow } = node;
				const result = esm_default(shallow);
				result.children = state.all(node);
				return result;
			}
			return esm_default(node);
		}
		return (state.options.unknownHandler || defaultUnknownHandler)(state, node, parent);
	}
	/**
	* Transform the children of an mdast node into hast nodes.
	*
	* @param {MdastNodes} parent
	*   mdast node to compile
	* @returns {Array<HastElementContent>}
	*   Resulting hast nodes.
	*/
	function all(parent) {
		/** @type {Array<HastElementContent>} */
		const values = [];
		if ("children" in parent) {
			const nodes = parent.children;
			let index = -1;
			while (++index < nodes.length) {
				const result = state.one(nodes[index], parent);
				if (result) {
					if (index && nodes[index - 1].type === "break") {
						if (!Array.isArray(result) && result.type === "text") result.value = trimMarkdownSpaceStart(result.value);
						if (!Array.isArray(result) && result.type === "element") {
							const head = result.children[0];
							if (head && head.type === "text") head.value = trimMarkdownSpaceStart(head.value);
						}
					}
					if (Array.isArray(result)) values.push(...result);
					else values.push(result);
				}
			}
		}
		return values;
	}
}
/**
* Copy a node’s positional info.
*
* @param {MdastNodes} from
*   mdast node to copy from.
* @param {HastNodes} to
*   hast node to copy into.
* @returns {undefined}
*   Nothing.
*/
function patch(from, to) {
	if (from.position) to.position = position$1(from);
}
/**
* Honor the `data` of `from` and maybe generate an element instead of `to`.
*
* @template {HastNodes} Type
*   Node type.
* @param {MdastNodes} from
*   mdast node to use data from.
* @param {Type} to
*   hast node to change.
* @returns {HastElement | Type}
*   Nothing.
*/
function applyData(from, to) {
	/** @type {HastElement | Type} */
	let result = to;
	if (from && from.data) {
		const hName = from.data.hName;
		const hChildren = from.data.hChildren;
		const hProperties = from.data.hProperties;
		if (typeof hName === "string") {
			if (result.type === "element") result.tagName = hName;
			else result = {
				type: "element",
				tagName: hName,
				properties: {},
				children: "children" in result ? result.children : [result]
			};
		}
		if (result.type === "element" && hProperties) Object.assign(result.properties, esm_default(hProperties));
		if ("children" in result && result.children && hChildren !== null && hChildren !== void 0) result.children = hChildren;
	}
	return result;
}
/**
* Transform an unknown node.
*
* @param {State} state
*   Info passed around.
* @param {MdastNodes} node
*   Unknown mdast node.
* @returns {HastElement | HastText}
*   Resulting hast node.
*/
function defaultUnknownHandler(state, node) {
	const data = node.data || {};
	/** @type {HastElement | HastText} */
	const result = "value" in node && !(own$1.call(data, "hProperties") || own$1.call(data, "hChildren")) ? {
		type: "text",
		value: node.value
	} : {
		type: "element",
		tagName: "div",
		properties: {},
		children: state.all(node)
	};
	state.patch(node, result);
	return state.applyData(node, result);
}
/**
* Wrap `nodes` with line endings between each node.
*
* @template {HastRootContent} Type
*   Node type.
* @param {Array<Type>} nodes
*   List of nodes to wrap.
* @param {boolean | undefined} [loose=false]
*   Whether to add line endings at start and end (default: `false`).
* @returns {Array<HastText | Type>}
*   Wrapped nodes.
*/
function wrap$1(nodes, loose) {
	/** @type {Array<HastText | Type>} */
	const result = [];
	let index = -1;
	if (loose) result.push({
		type: "text",
		value: "\n"
	});
	while (++index < nodes.length) {
		if (index) result.push({
			type: "text",
			value: "\n"
		});
		result.push(nodes[index]);
	}
	if (loose && nodes.length > 0) result.push({
		type: "text",
		value: "\n"
	});
	return result;
}
/**
* Trim spaces and tabs at the start of `value`.
*
* @param {string} value
*   Value to trim.
* @returns {string}
*   Result.
*/
function trimMarkdownSpaceStart(value) {
	let index = 0;
	let code = value.charCodeAt(index);
	while (code === 9 || code === 32) {
		index++;
		code = value.charCodeAt(index);
	}
	return value.slice(index);
}
//#endregion
//#region ../../node_modules/mdast-util-to-hast/lib/index.js
/**
* @import {Nodes as HastNodes} from 'hast'
* @import {Nodes as MdastNodes} from 'mdast'
* @import {Options} from './state.js'
*/
/**
* Transform mdast to hast.
*
* ##### Notes
*
* ###### HTML
*
* Raw HTML is available in mdast as `html` nodes and can be embedded in hast
* as semistandard `raw` nodes.
* Most utilities ignore `raw` nodes but two notable ones don’t:
*
* *   `hast-util-to-html` also has an option `allowDangerousHtml` which will
*     output the raw HTML.
*     This is typically discouraged as noted by the option name but is useful
*     if you completely trust authors
* *   `hast-util-raw` can handle the raw embedded HTML strings by parsing them
*     into standard hast nodes (`element`, `text`, etc).
*     This is a heavy task as it needs a full HTML parser, but it is the only
*     way to support untrusted content
*
* ###### Footnotes
*
* Many options supported here relate to footnotes.
* Footnotes are not specified by CommonMark, which we follow by default.
* They are supported by GitHub, so footnotes can be enabled in markdown with
* `mdast-util-gfm`.
*
* The options `footnoteBackLabel` and `footnoteLabel` define natural language
* that explains footnotes, which is hidden for sighted users but shown to
* assistive technology.
* When your page is not in English, you must define translated values.
*
* Back references use ARIA attributes, but the section label itself uses a
* heading that is hidden with an `sr-only` class.
* To show it to sighted users, define different attributes in
* `footnoteLabelProperties`.
*
* ###### Clobbering
*
* Footnotes introduces a problem, as it links footnote calls to footnote
* definitions on the page through `id` attributes generated from user content,
* which results in DOM clobbering.
*
* DOM clobbering is this:
*
* ```html
* <p id=x></p>
* <script>alert(x) // `x` now refers to the DOM `p#x` element<\/script>
* ```
*
* Elements by their ID are made available by browsers on the `window` object,
* which is a security risk.
* Using a prefix solves this problem.
*
* More information on how to handle clobbering and the prefix is explained in
* Example: headings (DOM clobbering) in `rehype-sanitize`.
*
* ###### Unknown nodes
*
* Unknown nodes are nodes with a type that isn’t in `handlers` or `passThrough`.
* The default behavior for unknown nodes is:
*
* *   when the node has a `value` (and doesn’t have `data.hName`,
*     `data.hProperties`, or `data.hChildren`, see later), create a hast `text`
*     node
* *   otherwise, create a `<div>` element (which could be changed with
*     `data.hName`), with its children mapped from mdast to hast as well
*
* This behavior can be changed by passing an `unknownHandler`.
*
* @param {MdastNodes} tree
*   mdast tree.
* @param {Options | null | undefined} [options]
*   Configuration (optional).
* @returns {HastNodes}
*   hast tree.
*/
function toHast(tree, options) {
	const state = createState(tree, options);
	const node = state.one(tree, void 0);
	const foot = footer(state);
	/** @type {HastNodes} */
	const result = Array.isArray(node) ? {
		type: "root",
		children: node
	} : node || {
		type: "root",
		children: []
	};
	if (foot) {
		"children" in result;
		result.children.push({
			type: "text",
			value: "\n"
		}, foot);
	}
	return result;
}
//#endregion
//#region ../../node_modules/remark-rehype/lib/index.js
/**
* @import {Root as HastRoot} from 'hast'
* @import {Root as MdastRoot} from 'mdast'
* @import {Options as ToHastOptions} from 'mdast-util-to-hast'
* @import {Processor} from 'unified'
* @import {VFile} from 'vfile'
*/
/**
* @typedef {Omit<ToHastOptions, 'file'>} Options
*
* @callback TransformBridge
*   Bridge-mode.
*
*   Runs the destination with the new hast tree.
*   Discards result.
* @param {MdastRoot} tree
*   Tree.
* @param {VFile} file
*   File.
* @returns {Promise<undefined>}
*   Nothing.
*
* @callback TransformMutate
*  Mutate-mode.
*
*  Further transformers run on the hast tree.
* @param {MdastRoot} tree
*   Tree.
* @param {VFile} file
*   File.
* @returns {HastRoot}
*   Tree (hast).
*/
/**
* Turn markdown into HTML.
*
* ##### Notes
*
* ###### Signature
*
* * if a processor is given,
*   runs the (rehype) plugins used on it with a hast tree,
*   then discards the result (*bridge mode*)
* * otherwise,
*   returns a hast tree,
*   the plugins used after `remarkRehype` are rehype plugins (*mutate mode*)
*
* > 👉 **Note**:
* > It’s highly unlikely that you want to pass a `processor`.
*
* ###### HTML
*
* Raw HTML is available in mdast as `html` nodes and can be embedded in hast
* as semistandard `raw` nodes.
* Most plugins ignore `raw` nodes but two notable ones don’t:
*
* * `rehype-stringify` also has an option `allowDangerousHtml` which will
*   output the raw HTML.
*   This is typically discouraged as noted by the option name but is useful if
*   you completely trust authors
* * `rehype-raw` can handle the raw embedded HTML strings by parsing them
*   into standard hast nodes (`element`, `text`, etc);
*   this is a heavy task as it needs a full HTML parser,
*   but it is the only way to support untrusted content
*
* ###### Footnotes
*
* Many options supported here relate to footnotes.
* Footnotes are not specified by CommonMark,
* which we follow by default.
* They are supported by GitHub,
* so footnotes can be enabled in markdown with `remark-gfm`.
*
* The options `footnoteBackLabel` and `footnoteLabel` define natural language
* that explains footnotes,
* which is hidden for sighted users but shown to assistive technology.
* When your page is not in English,
* you must define translated values.
*
* Back references use ARIA attributes,
* but the section label itself uses a heading that is hidden with an
* `sr-only` class.
* To show it to sighted users,
* define different attributes in `footnoteLabelProperties`.
*
* ###### Clobbering
*
* Footnotes introduces a problem,
* as it links footnote calls to footnote definitions on the page through `id`
* attributes generated from user content,
* which results in DOM clobbering.
*
* DOM clobbering is this:
*
* ```html
* <p id=x></p>
* <script>alert(x) // `x` now refers to the DOM `p#x` element<\/script>
* ```
*
* Elements by their ID are made available by browsers on the `window` object,
* which is a security risk.
* Using a prefix solves this problem.
*
* More information on how to handle clobbering and the prefix is explained in
* *Example: headings (DOM clobbering)* in `rehype-sanitize`.
*
* ###### Unknown nodes
*
* Unknown nodes are nodes with a type that isn’t in `handlers` or `passThrough`.
* The default behavior for unknown nodes is:
*
* * when the node has a `value`
*   (and doesn’t have `data.hName`, `data.hProperties`, or `data.hChildren`,
*   see later),
*   create a hast `text` node
* * otherwise,
*   create a `<div>` element (which could be changed with `data.hName`),
*   with its children mapped from mdast to hast as well
*
* This behavior can be changed by passing an `unknownHandler`.
*
* @overload
* @param {Processor} processor
* @param {Readonly<Options> | null | undefined} [options]
* @returns {TransformBridge}
*
* @overload
* @param {Readonly<Options> | null | undefined} [options]
* @returns {TransformMutate}
*
* @overload
* @param {Readonly<Options> | Processor | null | undefined} [destination]
* @param {Readonly<Options> | null | undefined} [options]
* @returns {TransformBridge | TransformMutate}
*
* @param {Readonly<Options> | Processor | null | undefined} [destination]
*   Processor or configuration (optional).
* @param {Readonly<Options> | null | undefined} [options]
*   When a processor was given,
*   configuration (optional).
* @returns {TransformBridge | TransformMutate}
*   Transform.
*/
function remarkRehype(destination, options) {
	if (destination && "run" in destination)
 /**
	* @type {TransformBridge}
	*/
	return async function(tree, file) {
		const hastTree = toHast(tree, {
			file,
			...options
		});
		await destination.run(hastTree, file);
	};
	/**
	* @type {TransformMutate}
	*/
	return function(tree, file) {
		return toHast(tree, {
			file,
			...destination || options
		});
	};
}
//#endregion
//#region ../../node_modules/bail/index.js
/**
* Throw a given error.
*
* @param {Error|null|undefined} [error]
*   Maybe error.
* @returns {asserts error is null|undefined}
*/
function bail(error) {
	if (error) throw error;
}
//#endregion
//#region ../../node_modules/extend/index.js
var require_extend = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var hasOwn = Object.prototype.hasOwnProperty;
	var toStr = Object.prototype.toString;
	var defineProperty = Object.defineProperty;
	var gOPD = Object.getOwnPropertyDescriptor;
	var isArray = function isArray(arr) {
		if (typeof Array.isArray === "function") return Array.isArray(arr);
		return toStr.call(arr) === "[object Array]";
	};
	var isPlainObject = function isPlainObject(obj) {
		if (!obj || toStr.call(obj) !== "[object Object]") return false;
		var hasOwnConstructor = hasOwn.call(obj, "constructor");
		var hasIsPrototypeOf = obj.constructor && obj.constructor.prototype && hasOwn.call(obj.constructor.prototype, "isPrototypeOf");
		if (obj.constructor && !hasOwnConstructor && !hasIsPrototypeOf) return false;
		var key;
		for (key in obj);
		return typeof key === "undefined" || hasOwn.call(obj, key);
	};
	var setProperty = function setProperty(target, options) {
		if (defineProperty && options.name === "__proto__") defineProperty(target, options.name, {
			enumerable: true,
			configurable: true,
			value: options.newValue,
			writable: true
		});
		else target[options.name] = options.newValue;
	};
	var getProperty = function getProperty(obj, name) {
		if (name === "__proto__") {
			if (!hasOwn.call(obj, name)) return;
			else if (gOPD) return gOPD(obj, name).value;
		}
		return obj[name];
	};
	module.exports = function extend() {
		var options, name, src, copy, copyIsArray, clone;
		var target = arguments[0];
		var i = 1;
		var length = arguments.length;
		var deep = false;
		if (typeof target === "boolean") {
			deep = target;
			target = arguments[1] || {};
			i = 2;
		}
		if (target == null || typeof target !== "object" && typeof target !== "function") target = {};
		for (; i < length; ++i) {
			options = arguments[i];
			if (options != null) for (name in options) {
				src = getProperty(target, name);
				copy = getProperty(options, name);
				if (target !== copy) {
					if (deep && copy && (isPlainObject(copy) || (copyIsArray = isArray(copy)))) {
						if (copyIsArray) {
							copyIsArray = false;
							clone = src && isArray(src) ? src : [];
						} else clone = src && isPlainObject(src) ? src : {};
						setProperty(target, {
							name,
							newValue: extend(deep, clone, copy)
						});
					} else if (typeof copy !== "undefined") setProperty(target, {
						name,
						newValue: copy
					});
				}
			}
		}
		return target;
	};
}));
//#endregion
//#region ../../node_modules/is-plain-obj/index.js
function isPlainObject(value) {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in value) && !(Symbol.iterator in value);
}
//#endregion
//#region ../../node_modules/trough/lib/index.js
/**
* @typedef {(error?: Error | null | undefined, ...output: Array<any>) => void} Callback
*   Callback.
*
* @typedef {(...input: Array<any>) => any} Middleware
*   Ware.
*
* @typedef Pipeline
*   Pipeline.
* @property {Run} run
*   Run the pipeline.
* @property {Use} use
*   Add middleware.
*
* @typedef {(...input: Array<any>) => void} Run
*   Call all middleware.
*
*   Calls `done` on completion with either an error or the output of the
*   last middleware.
*
*   > 👉 **Note**: as the length of input defines whether async functions get a
*   > `next` function,
*   > it’s recommended to keep `input` at one value normally.

*
* @typedef {(fn: Middleware) => Pipeline} Use
*   Add middleware.
*/
/**
* Create new middleware.
*
* @returns {Pipeline}
*   Pipeline.
*/
function trough() {
	/** @type {Array<Middleware>} */
	const fns = [];
	/** @type {Pipeline} */
	const pipeline = {
		run,
		use
	};
	return pipeline;
	/** @type {Run} */
	function run(...values) {
		let middlewareIndex = -1;
		/** @type {Callback} */
		const callback = values.pop();
		if (typeof callback !== "function") throw new TypeError("Expected function as last argument, not " + callback);
		next(null, ...values);
		/**
		* Run the next `fn`, or we’re done.
		*
		* @param {Error | null | undefined} error
		* @param {Array<any>} output
		*/
		function next(error, ...output) {
			const fn = fns[++middlewareIndex];
			let index = -1;
			if (error) {
				callback(error);
				return;
			}
			while (++index < values.length) if (output[index] === null || output[index] === void 0) output[index] = values[index];
			values = output;
			if (fn) wrap(fn, next)(...output);
			else callback(null, ...output);
		}
	}
	/** @type {Use} */
	function use(middelware) {
		if (typeof middelware !== "function") throw new TypeError("Expected `middelware` to be a function, not " + middelware);
		fns.push(middelware);
		return pipeline;
	}
}
/**
* Wrap `middleware` into a uniform interface.
*
* You can pass all input to the resulting function.
* `callback` is then called with the output of `middleware`.
*
* If `middleware` accepts more arguments than the later given in input,
* an extra `done` function is passed to it after that input,
* which must be called by `middleware`.
*
* The first value in `input` is the main input value.
* All other input values are the rest input values.
* The values given to `callback` are the input values,
* merged with every non-nullish output value.
*
* * if `middleware` throws an error,
*   returns a promise that is rejected,
*   or calls the given `done` function with an error,
*   `callback` is called with that error
* * if `middleware` returns a value or returns a promise that is resolved,
*   that value is the main output value
* * if `middleware` calls `done`,
*   all non-nullish values except for the first one (the error) overwrite the
*   output values
*
* @param {Middleware} middleware
*   Function to wrap.
* @param {Callback} callback
*   Callback called with the output of `middleware`.
* @returns {Run}
*   Wrapped middleware.
*/
function wrap(middleware, callback) {
	/** @type {boolean} */
	let called;
	return wrapped;
	/**
	* Call `middleware`.
	* @this {any}
	* @param {Array<any>} parameters
	* @returns {void}
	*/
	function wrapped(...parameters) {
		const fnExpectsCallback = middleware.length > parameters.length;
		/** @type {any} */
		let result;
		if (fnExpectsCallback) parameters.push(done);
		try {
			result = middleware.apply(this, parameters);
		} catch (error) {
			const exception = error;
			if (fnExpectsCallback && called) throw exception;
			return done(exception);
		}
		if (!fnExpectsCallback) {
			if (result && result.then && typeof result.then === "function") result.then(then, done);
			else if (result instanceof Error) done(result);
			else then(result);
		}
	}
	/**
	* Call `callback`, only once.
	*
	* @type {Callback}
	*/
	function done(error, ...output) {
		if (!called) {
			called = true;
			callback(error, ...output);
		}
	}
	/**
	* Call `done` with one value.
	*
	* @param {any} [value]
	*/
	function then(value) {
		done(null, value);
	}
}
//#endregion
//#region ../../node_modules/vfile/lib/minpath.browser.js
var minpath = {
	basename,
	dirname,
	extname,
	join,
	sep: "/"
};
/**
* Get the basename from a path.
*
* @param {string} path
*   File path.
* @param {string | null | undefined} [extname]
*   Extension to strip.
* @returns {string}
*   Stem or basename.
*/
function basename(path, extname) {
	if (extname !== void 0 && typeof extname !== "string") throw new TypeError("\"ext\" argument must be a string");
	assertPath$1(path);
	let start = 0;
	let end = -1;
	let index = path.length;
	/** @type {boolean | undefined} */
	let seenNonSlash;
	if (extname === void 0 || extname.length === 0 || extname.length > path.length) {
		while (index--) if (path.codePointAt(index) === 47) {
			if (seenNonSlash) {
				start = index + 1;
				break;
			}
		} else if (end < 0) {
			seenNonSlash = true;
			end = index + 1;
		}
		return end < 0 ? "" : path.slice(start, end);
	}
	if (extname === path) return "";
	let firstNonSlashEnd = -1;
	let extnameIndex = extname.length - 1;
	while (index--) if (path.codePointAt(index) === 47) {
		if (seenNonSlash) {
			start = index + 1;
			break;
		}
	} else {
		if (firstNonSlashEnd < 0) {
			seenNonSlash = true;
			firstNonSlashEnd = index + 1;
		}
		if (extnameIndex > -1) {
			if (path.codePointAt(index) === extname.codePointAt(extnameIndex--)) {
				if (extnameIndex < 0) end = index;
			} else {
				extnameIndex = -1;
				end = firstNonSlashEnd;
			}
		}
	}
	if (start === end) end = firstNonSlashEnd;
	else if (end < 0) end = path.length;
	return path.slice(start, end);
}
/**
* Get the dirname from a path.
*
* @param {string} path
*   File path.
* @returns {string}
*   File path.
*/
function dirname(path) {
	assertPath$1(path);
	if (path.length === 0) return ".";
	let end = -1;
	let index = path.length;
	/** @type {boolean | undefined} */
	let unmatchedSlash;
	while (--index) if (path.codePointAt(index) === 47) {
		if (unmatchedSlash) {
			end = index;
			break;
		}
	} else if (!unmatchedSlash) unmatchedSlash = true;
	return end < 0 ? path.codePointAt(0) === 47 ? "/" : "." : end === 1 && path.codePointAt(0) === 47 ? "//" : path.slice(0, end);
}
/**
* Get an extname from a path.
*
* @param {string} path
*   File path.
* @returns {string}
*   Extname.
*/
function extname(path) {
	assertPath$1(path);
	let index = path.length;
	let end = -1;
	let startPart = 0;
	let startDot = -1;
	let preDotState = 0;
	/** @type {boolean | undefined} */
	let unmatchedSlash;
	while (index--) {
		const code = path.codePointAt(index);
		if (code === 47) {
			if (unmatchedSlash) {
				startPart = index + 1;
				break;
			}
			continue;
		}
		if (end < 0) {
			unmatchedSlash = true;
			end = index + 1;
		}
		if (code === 46) {
			if (startDot < 0) startDot = index;
			else if (preDotState !== 1) preDotState = 1;
		} else if (startDot > -1) preDotState = -1;
	}
	if (startDot < 0 || end < 0 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) return "";
	return path.slice(startDot, end);
}
/**
* Join segments from a path.
*
* @param {Array<string>} segments
*   Path segments.
* @returns {string}
*   File path.
*/
function join(...segments) {
	let index = -1;
	/** @type {string | undefined} */
	let joined;
	while (++index < segments.length) {
		assertPath$1(segments[index]);
		if (segments[index]) joined = joined === void 0 ? segments[index] : joined + "/" + segments[index];
	}
	return joined === void 0 ? "." : normalize(joined);
}
/**
* Normalize a basic file path.
*
* @param {string} path
*   File path.
* @returns {string}
*   File path.
*/
function normalize(path) {
	assertPath$1(path);
	const absolute = path.codePointAt(0) === 47;
	let value = normalizeString(path, !absolute);
	if (value.length === 0 && !absolute) value = ".";
	if (value.length > 0 && path.codePointAt(path.length - 1) === 47) value += "/";
	return absolute ? "/" + value : value;
}
/**
* Resolve `.` and `..` elements in a path with directory names.
*
* @param {string} path
*   File path.
* @param {boolean} allowAboveRoot
*   Whether `..` can move above root.
* @returns {string}
*   File path.
*/
function normalizeString(path, allowAboveRoot) {
	let result = "";
	let lastSegmentLength = 0;
	let lastSlash = -1;
	let dots = 0;
	let index = -1;
	/** @type {number | undefined} */
	let code;
	/** @type {number} */
	let lastSlashIndex;
	while (++index <= path.length) {
		if (index < path.length) code = path.codePointAt(index);
		else if (code === 47) break;
		else code = 47;
		if (code === 47) {
			if (lastSlash === index - 1 || dots === 1) {} else if (lastSlash !== index - 1 && dots === 2) {
				if (result.length < 2 || lastSegmentLength !== 2 || result.codePointAt(result.length - 1) !== 46 || result.codePointAt(result.length - 2) !== 46) {
					if (result.length > 2) {
						lastSlashIndex = result.lastIndexOf("/");
						if (lastSlashIndex !== result.length - 1) {
							if (lastSlashIndex < 0) {
								result = "";
								lastSegmentLength = 0;
							} else {
								result = result.slice(0, lastSlashIndex);
								lastSegmentLength = result.length - 1 - result.lastIndexOf("/");
							}
							lastSlash = index;
							dots = 0;
							continue;
						}
					} else if (result.length > 0) {
						result = "";
						lastSegmentLength = 0;
						lastSlash = index;
						dots = 0;
						continue;
					}
				}
				if (allowAboveRoot) {
					result = result.length > 0 ? result + "/.." : "..";
					lastSegmentLength = 2;
				}
			} else {
				if (result.length > 0) result += "/" + path.slice(lastSlash + 1, index);
				else result = path.slice(lastSlash + 1, index);
				lastSegmentLength = index - lastSlash - 1;
			}
			lastSlash = index;
			dots = 0;
		} else if (code === 46 && dots > -1) dots++;
		else dots = -1;
	}
	return result;
}
/**
* Make sure `path` is a string.
*
* @param {string} path
*   File path.
* @returns {asserts path is string}
*   Nothing.
*/
function assertPath$1(path) {
	if (typeof path !== "string") throw new TypeError("Path must be a string. Received " + JSON.stringify(path));
}
//#endregion
//#region ../../node_modules/vfile/lib/minproc.browser.js
var minproc = { cwd };
function cwd() {
	return "/";
}
//#endregion
//#region ../../node_modules/vfile/lib/minurl.shared.js
/**
* Checks if a value has the shape of a WHATWG URL object.
*
* Using a symbol or instanceof would not be able to recognize URL objects
* coming from other implementations (e.g. in Electron), so instead we are
* checking some well known properties for a lack of a better test.
*
* We use `href` and `protocol` as they are the only properties that are
* easy to retrieve and calculate due to the lazy nature of the getters.
*
* We check for auth attribute to distinguish legacy url instance with
* WHATWG URL instance.
*
* @param {unknown} fileUrlOrPath
*   File path or URL.
* @returns {fileUrlOrPath is URL}
*   Whether it’s a URL.
*/
function isUrl(fileUrlOrPath) {
	return Boolean(fileUrlOrPath !== null && typeof fileUrlOrPath === "object" && "href" in fileUrlOrPath && fileUrlOrPath.href && "protocol" in fileUrlOrPath && fileUrlOrPath.protocol && fileUrlOrPath.auth === void 0);
}
//#endregion
//#region ../../node_modules/vfile/lib/minurl.browser.js
/**
* @param {URL | string} path
*   File URL.
* @returns {string}
*   File URL.
*/
function urlToPath(path) {
	if (typeof path === "string") path = new URL(path);
	else if (!isUrl(path)) {
		/** @type {NodeJS.ErrnoException} */
		const error = /* @__PURE__ */ new TypeError("The \"path\" argument must be of type string or an instance of URL. Received `" + path + "`");
		error.code = "ERR_INVALID_ARG_TYPE";
		throw error;
	}
	if (path.protocol !== "file:") {
		/** @type {NodeJS.ErrnoException} */
		const error = /* @__PURE__ */ new TypeError("The URL must be of scheme file");
		error.code = "ERR_INVALID_URL_SCHEME";
		throw error;
	}
	return getPathFromURLPosix(path);
}
/**
* Get a path from a POSIX URL.
*
* @param {URL} url
*   URL.
* @returns {string}
*   File path.
*/
function getPathFromURLPosix(url) {
	if (url.hostname !== "") {
		/** @type {NodeJS.ErrnoException} */
		const error = /* @__PURE__ */ new TypeError("File URL host must be \"localhost\" or empty on darwin");
		error.code = "ERR_INVALID_FILE_URL_HOST";
		throw error;
	}
	const pathname = url.pathname;
	let index = -1;
	while (++index < pathname.length) if (pathname.codePointAt(index) === 37 && pathname.codePointAt(index + 1) === 50) {
		const third = pathname.codePointAt(index + 2);
		if (third === 70 || third === 102) {
			/** @type {NodeJS.ErrnoException} */
			const error = /* @__PURE__ */ new TypeError("File URL path must not include encoded / characters");
			error.code = "ERR_INVALID_FILE_URL_PATH";
			throw error;
		}
	}
	return decodeURIComponent(pathname);
}
//#endregion
//#region ../../node_modules/vfile/lib/index.js
/**
* @import {Node, Point, Position} from 'unist'
* @import {Options as MessageOptions} from 'vfile-message'
* @import {Compatible, Data, Map, Options, Value} from 'vfile'
*/
/**
* @typedef {object & {type: string, position?: Position | undefined}} NodeLike
*/
/**
* Order of setting (least specific to most), we need this because otherwise
* `{stem: 'a', path: '~/b.js'}` would throw, as a path is needed before a
* stem can be set.
*/
var order = [
	"history",
	"path",
	"basename",
	"stem",
	"extname",
	"dirname"
];
var VFile = class {
	/**
	* Create a new virtual file.
	*
	* `options` is treated as:
	*
	* *   `string` or `Uint8Array` — `{value: options}`
	* *   `URL` — `{path: options}`
	* *   `VFile` — shallow copies its data over to the new file
	* *   `object` — all fields are shallow copied over to the new file
	*
	* Path related fields are set in the following order (least specific to
	* most specific): `history`, `path`, `basename`, `stem`, `extname`,
	* `dirname`.
	*
	* You cannot set `dirname` or `extname` without setting either `history`,
	* `path`, `basename`, or `stem` too.
	*
	* @param {Compatible | null | undefined} [value]
	*   File value.
	* @returns
	*   New instance.
	*/
	constructor(value) {
		/** @type {Options | VFile} */
		let options;
		if (!value) options = {};
		else if (isUrl(value)) options = { path: value };
		else if (typeof value === "string" || isUint8Array$1(value)) options = { value };
		else options = value;
		/**
		* Base of `path` (default: `process.cwd()` or `'/'` in browsers).
		*
		* @type {string}
		*/
		this.cwd = "cwd" in options ? "" : minproc.cwd();
		/**
		* Place to store custom info (default: `{}`).
		*
		* It’s OK to store custom data directly on the file but moving it to
		* `data` is recommended.
		*
		* @type {Data}
		*/
		this.data = {};
		/**
		* List of file paths the file moved between.
		*
		* The first is the original path and the last is the current path.
		*
		* @type {Array<string>}
		*/
		this.history = [];
		/**
		* List of messages associated with the file.
		*
		* @type {Array<VFileMessage>}
		*/
		this.messages = [];
		/**
		* Raw value.
		*
		* @type {Value}
		*/
		this.value;
		/**
		* Source map.
		*
		* This type is equivalent to the `RawSourceMap` type from the `source-map`
		* module.
		*
		* @type {Map | null | undefined}
		*/
		this.map;
		/**
		* Custom, non-string, compiled, representation.
		*
		* This is used by unified to store non-string results.
		* One example is when turning markdown into React nodes.
		*
		* @type {unknown}
		*/
		this.result;
		/**
		* Whether a file was saved to disk.
		*
		* This is used by vfile reporters.
		*
		* @type {boolean}
		*/
		this.stored;
		let index = -1;
		while (++index < order.length) {
			const field = order[index];
			if (field in options && options[field] !== void 0 && options[field] !== null) this[field] = field === "history" ? [...options[field]] : options[field];
		}
		/** @type {string} */
		let field;
		for (field in options) if (!order.includes(field)) this[field] = options[field];
	}
	/**
	* Get the basename (including extname) (example: `'index.min.js'`).
	*
	* @returns {string | undefined}
	*   Basename.
	*/
	get basename() {
		return typeof this.path === "string" ? minpath.basename(this.path) : void 0;
	}
	/**
	* Set basename (including extname) (`'index.min.js'`).
	*
	* Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
	* on windows).
	* Cannot be nullified (use `file.path = file.dirname` instead).
	*
	* @param {string} basename
	*   Basename.
	* @returns {undefined}
	*   Nothing.
	*/
	set basename(basename) {
		assertNonEmpty(basename, "basename");
		assertPart(basename, "basename");
		this.path = minpath.join(this.dirname || "", basename);
	}
	/**
	* Get the parent path (example: `'~'`).
	*
	* @returns {string | undefined}
	*   Dirname.
	*/
	get dirname() {
		return typeof this.path === "string" ? minpath.dirname(this.path) : void 0;
	}
	/**
	* Set the parent path (example: `'~'`).
	*
	* Cannot be set if there’s no `path` yet.
	*
	* @param {string | undefined} dirname
	*   Dirname.
	* @returns {undefined}
	*   Nothing.
	*/
	set dirname(dirname) {
		assertPath(this.basename, "dirname");
		this.path = minpath.join(dirname || "", this.basename);
	}
	/**
	* Get the extname (including dot) (example: `'.js'`).
	*
	* @returns {string | undefined}
	*   Extname.
	*/
	get extname() {
		return typeof this.path === "string" ? minpath.extname(this.path) : void 0;
	}
	/**
	* Set the extname (including dot) (example: `'.js'`).
	*
	* Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
	* on windows).
	* Cannot be set if there’s no `path` yet.
	*
	* @param {string | undefined} extname
	*   Extname.
	* @returns {undefined}
	*   Nothing.
	*/
	set extname(extname) {
		assertPart(extname, "extname");
		assertPath(this.dirname, "extname");
		if (extname) {
			if (extname.codePointAt(0) !== 46) throw new Error("`extname` must start with `.`");
			if (extname.includes(".", 1)) throw new Error("`extname` cannot contain multiple dots");
		}
		this.path = minpath.join(this.dirname, this.stem + (extname || ""));
	}
	/**
	* Get the full path (example: `'~/index.min.js'`).
	*
	* @returns {string}
	*   Path.
	*/
	get path() {
		return this.history[this.history.length - 1];
	}
	/**
	* Set the full path (example: `'~/index.min.js'`).
	*
	* Cannot be nullified.
	* You can set a file URL (a `URL` object with a `file:` protocol) which will
	* be turned into a path with `url.fileURLToPath`.
	*
	* @param {URL | string} path
	*   Path.
	* @returns {undefined}
	*   Nothing.
	*/
	set path(path) {
		if (isUrl(path)) path = urlToPath(path);
		assertNonEmpty(path, "path");
		if (this.path !== path) this.history.push(path);
	}
	/**
	* Get the stem (basename w/o extname) (example: `'index.min'`).
	*
	* @returns {string | undefined}
	*   Stem.
	*/
	get stem() {
		return typeof this.path === "string" ? minpath.basename(this.path, this.extname) : void 0;
	}
	/**
	* Set the stem (basename w/o extname) (example: `'index.min'`).
	*
	* Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
	* on windows).
	* Cannot be nullified (use `file.path = file.dirname` instead).
	*
	* @param {string} stem
	*   Stem.
	* @returns {undefined}
	*   Nothing.
	*/
	set stem(stem) {
		assertNonEmpty(stem, "stem");
		assertPart(stem, "stem");
		this.path = minpath.join(this.dirname || "", stem + (this.extname || ""));
	}
	/**
	* Create a fatal message for `reason` associated with the file.
	*
	* The `fatal` field of the message is set to `true` (error; file not usable)
	* and the `file` field is set to the current file path.
	* The message is added to the `messages` field on `file`.
	*
	* > 🪦 **Note**: also has obsolete signatures.
	*
	* @overload
	* @param {string} reason
	* @param {MessageOptions | null | undefined} [options]
	* @returns {never}
	*
	* @overload
	* @param {string} reason
	* @param {Node | NodeLike | null | undefined} parent
	* @param {string | null | undefined} [origin]
	* @returns {never}
	*
	* @overload
	* @param {string} reason
	* @param {Point | Position | null | undefined} place
	* @param {string | null | undefined} [origin]
	* @returns {never}
	*
	* @overload
	* @param {string} reason
	* @param {string | null | undefined} [origin]
	* @returns {never}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {Node | NodeLike | null | undefined} parent
	* @param {string | null | undefined} [origin]
	* @returns {never}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {Point | Position | null | undefined} place
	* @param {string | null | undefined} [origin]
	* @returns {never}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {string | null | undefined} [origin]
	* @returns {never}
	*
	* @param {Error | VFileMessage | string} causeOrReason
	*   Reason for message, should use markdown.
	* @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
	*   Configuration (optional).
	* @param {string | null | undefined} [origin]
	*   Place in code where the message originates (example:
	*   `'my-package:my-rule'` or `'my-rule'`).
	* @returns {never}
	*   Never.
	* @throws {VFileMessage}
	*   Message.
	*/
	fail(causeOrReason, optionsOrParentOrPlace, origin) {
		const message = this.message(causeOrReason, optionsOrParentOrPlace, origin);
		message.fatal = true;
		throw message;
	}
	/**
	* Create an info message for `reason` associated with the file.
	*
	* The `fatal` field of the message is set to `undefined` (info; change
	* likely not needed) and the `file` field is set to the current file path.
	* The message is added to the `messages` field on `file`.
	*
	* > 🪦 **Note**: also has obsolete signatures.
	*
	* @overload
	* @param {string} reason
	* @param {MessageOptions | null | undefined} [options]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {string} reason
	* @param {Node | NodeLike | null | undefined} parent
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {string} reason
	* @param {Point | Position | null | undefined} place
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {string} reason
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {Node | NodeLike | null | undefined} parent
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {Point | Position | null | undefined} place
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @param {Error | VFileMessage | string} causeOrReason
	*   Reason for message, should use markdown.
	* @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
	*   Configuration (optional).
	* @param {string | null | undefined} [origin]
	*   Place in code where the message originates (example:
	*   `'my-package:my-rule'` or `'my-rule'`).
	* @returns {VFileMessage}
	*   Message.
	*/
	info(causeOrReason, optionsOrParentOrPlace, origin) {
		const message = this.message(causeOrReason, optionsOrParentOrPlace, origin);
		message.fatal = void 0;
		return message;
	}
	/**
	* Create a message for `reason` associated with the file.
	*
	* The `fatal` field of the message is set to `false` (warning; change may be
	* needed) and the `file` field is set to the current file path.
	* The message is added to the `messages` field on `file`.
	*
	* > 🪦 **Note**: also has obsolete signatures.
	*
	* @overload
	* @param {string} reason
	* @param {MessageOptions | null | undefined} [options]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {string} reason
	* @param {Node | NodeLike | null | undefined} parent
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {string} reason
	* @param {Point | Position | null | undefined} place
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {string} reason
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {Node | NodeLike | null | undefined} parent
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {Point | Position | null | undefined} place
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @overload
	* @param {Error | VFileMessage} cause
	* @param {string | null | undefined} [origin]
	* @returns {VFileMessage}
	*
	* @param {Error | VFileMessage | string} causeOrReason
	*   Reason for message, should use markdown.
	* @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
	*   Configuration (optional).
	* @param {string | null | undefined} [origin]
	*   Place in code where the message originates (example:
	*   `'my-package:my-rule'` or `'my-rule'`).
	* @returns {VFileMessage}
	*   Message.
	*/
	message(causeOrReason, optionsOrParentOrPlace, origin) {
		const message = new VFileMessage(causeOrReason, optionsOrParentOrPlace, origin);
		if (this.path) {
			message.name = this.path + ":" + message.name;
			message.file = this.path;
		}
		message.fatal = false;
		this.messages.push(message);
		return message;
	}
	/**
	* Serialize the file.
	*
	* > **Note**: which encodings are supported depends on the engine.
	* > For info on Node.js, see:
	* > <https://nodejs.org/api/util.html#whatwg-supported-encodings>.
	*
	* @param {string | null | undefined} [encoding='utf8']
	*   Character encoding to understand `value` as when it’s a `Uint8Array`
	*   (default: `'utf-8'`).
	* @returns {string}
	*   Serialized file.
	*/
	toString(encoding) {
		if (this.value === void 0) return "";
		if (typeof this.value === "string") return this.value;
		return new TextDecoder(encoding || void 0).decode(this.value);
	}
};
/**
* Assert that `part` is not a path (as in, does not contain `path.sep`).
*
* @param {string | null | undefined} part
*   File path part.
* @param {string} name
*   Part name.
* @returns {undefined}
*   Nothing.
*/
function assertPart(part, name) {
	if (part && part.includes(minpath.sep)) throw new Error("`" + name + "` cannot be a path: did not expect `" + minpath.sep + "`");
}
/**
* Assert that `part` is not empty.
*
* @param {string | undefined} part
*   Thing.
* @param {string} name
*   Part name.
* @returns {asserts part is string}
*   Nothing.
*/
function assertNonEmpty(part, name) {
	if (!part) throw new Error("`" + name + "` cannot be empty");
}
/**
* Assert `path` exists.
*
* @param {string | undefined} path
*   Path.
* @param {string} name
*   Dependency name.
* @returns {asserts path is string}
*   Nothing.
*/
function assertPath(path, name) {
	if (!path) throw new Error("Setting `" + name + "` requires `path` to be set too");
}
/**
* Assert `value` is an `Uint8Array`.
*
* @param {unknown} value
*   thing.
* @returns {value is Uint8Array}
*   Whether `value` is an `Uint8Array`.
*/
function isUint8Array$1(value) {
	return Boolean(value && typeof value === "object" && "byteLength" in value && "byteOffset" in value);
}
//#endregion
//#region ../../node_modules/unified/lib/callable-instance.js
var CallableInstance = (
/**
* @this {Function}
* @param {string | symbol} property
* @returns {(...parameters: Array<unknown>) => unknown}
*/
function(property) {
	const proto = this.constructor.prototype;
	const value = proto[property];
	/** @type {(...parameters: Array<unknown>) => unknown} */
	const apply = function() {
		return value.apply(apply, arguments);
	};
	Object.setPrototypeOf(apply, proto);
	return apply;
});
//#endregion
//#region ../../node_modules/unified/lib/index.js
/**
* @typedef {import('trough').Pipeline} Pipeline
*
* @typedef {import('unist').Node} Node
*
* @typedef {import('vfile').Compatible} Compatible
* @typedef {import('vfile').Value} Value
*
* @typedef {import('../index.js').CompileResultMap} CompileResultMap
* @typedef {import('../index.js').Data} Data
* @typedef {import('../index.js').Settings} Settings
*/
/**
* @typedef {CompileResultMap[keyof CompileResultMap]} CompileResults
*   Acceptable results from compilers.
*
*   To register custom results, add them to
*   {@linkcode CompileResultMap}.
*/
/**
* @template {Node} [Tree=Node]
*   The node that the compiler receives (default: `Node`).
* @template {CompileResults} [Result=CompileResults]
*   The thing that the compiler yields (default: `CompileResults`).
* @callback Compiler
*   A **compiler** handles the compiling of a syntax tree to something else
*   (in most cases, text) (TypeScript type).
*
*   It is used in the stringify phase and called with a {@linkcode Node}
*   and {@linkcode VFile} representation of the document to compile.
*   It should return the textual representation of the given tree (typically
*   `string`).
*
*   > **Note**: unified typically compiles by serializing: most compilers
*   > return `string` (or `Uint8Array`).
*   > Some compilers, such as the one configured with
*   > [`rehype-react`][rehype-react], return other values (in this case, a
*   > React tree).
*   > If you’re using a compiler that doesn’t serialize, expect different
*   > result values.
*   >
*   > To register custom results in TypeScript, add them to
*   > {@linkcode CompileResultMap}.
*
*   [rehype-react]: https://github.com/rehypejs/rehype-react
* @param {Tree} tree
*   Tree to compile.
* @param {VFile} file
*   File associated with `tree`.
* @returns {Result}
*   New content: compiled text (`string` or `Uint8Array`, for `file.value`) or
*   something else (for `file.result`).
*/
/**
* @template {Node} [Tree=Node]
*   The node that the parser yields (default: `Node`)
* @callback Parser
*   A **parser** handles the parsing of text to a syntax tree.
*
*   It is used in the parse phase and is called with a `string` and
*   {@linkcode VFile} of the document to parse.
*   It must return the syntax tree representation of the given file
*   ({@linkcode Node}).
* @param {string} document
*   Document to parse.
* @param {VFile} file
*   File associated with `document`.
* @returns {Tree}
*   Node representing the given file.
*/
/**
* @typedef {(
*   Plugin<Array<any>, any, any> |
*   PluginTuple<Array<any>, any, any> |
*   Preset
* )} Pluggable
*   Union of the different ways to add plugins and settings.
*/
/**
* @typedef {Array<Pluggable>} PluggableList
*   List of plugins and presets.
*/
/**
* @template {Array<unknown>} [PluginParameters=[]]
*   Arguments passed to the plugin (default: `[]`, the empty tuple).
* @template {Node | string | undefined} [Input=Node]
*   Value that is expected as input (default: `Node`).
*
*   *   If the plugin returns a {@linkcode Transformer}, this
*       should be the node it expects.
*   *   If the plugin sets a {@linkcode Parser}, this should be
*       `string`.
*   *   If the plugin sets a {@linkcode Compiler}, this should be the
*       node it expects.
* @template [Output=Input]
*   Value that is yielded as output (default: `Input`).
*
*   *   If the plugin returns a {@linkcode Transformer}, this
*       should be the node that that yields.
*   *   If the plugin sets a {@linkcode Parser}, this should be the
*       node that it yields.
*   *   If the plugin sets a {@linkcode Compiler}, this should be
*       result it yields.
* @typedef {(
*   (this: Processor, ...parameters: PluginParameters) =>
*     Input extends string ? // Parser.
*        Output extends Node | undefined ? undefined | void : never :
*     Output extends CompileResults ? // Compiler.
*        Input extends Node | undefined ? undefined | void : never :
*     Transformer<
*       Input extends Node ? Input : Node,
*       Output extends Node ? Output : Node
*     > | undefined | void
* )} Plugin
*   Single plugin.
*
*   Plugins configure the processors they are applied on in the following
*   ways:
*
*   *   they change the processor, such as the parser, the compiler, or by
*       configuring data
*   *   they specify how to handle trees and files
*
*   In practice, they are functions that can receive options and configure the
*   processor (`this`).
*
*   > **Note**: plugins are called when the processor is *frozen*, not when
*   > they are applied.
*/
/**
* Tuple of a plugin and its configuration.
*
* The first item is a plugin, the rest are its parameters.
*
* @template {Array<unknown>} [TupleParameters=[]]
*   Arguments passed to the plugin (default: `[]`, the empty tuple).
* @template {Node | string | undefined} [Input=undefined]
*   Value that is expected as input (optional).
*
*   *   If the plugin returns a {@linkcode Transformer}, this
*       should be the node it expects.
*   *   If the plugin sets a {@linkcode Parser}, this should be
*       `string`.
*   *   If the plugin sets a {@linkcode Compiler}, this should be the
*       node it expects.
* @template [Output=undefined] (optional).
*   Value that is yielded as output.
*
*   *   If the plugin returns a {@linkcode Transformer}, this
*       should be the node that that yields.
*   *   If the plugin sets a {@linkcode Parser}, this should be the
*       node that it yields.
*   *   If the plugin sets a {@linkcode Compiler}, this should be
*       result it yields.
* @typedef {(
*   [
*     plugin: Plugin<TupleParameters, Input, Output>,
*     ...parameters: TupleParameters
*   ]
* )} PluginTuple
*/
/**
* @typedef Preset
*   Sharable configuration.
*
*   They can contain plugins and settings.
* @property {PluggableList | undefined} [plugins]
*   List of plugins and presets (optional).
* @property {Settings | undefined} [settings]
*   Shared settings for parsers and compilers (optional).
*/
/**
* @template {VFile} [File=VFile]
*   The file that the callback receives (default: `VFile`).
* @callback ProcessCallback
*   Callback called when the process is done.
*
*   Called with either an error or a result.
* @param {Error | undefined} [error]
*   Fatal error (optional).
* @param {File | undefined} [file]
*   Processed file (optional).
* @returns {undefined}
*   Nothing.
*/
/**
* @template {Node} [Tree=Node]
*   The tree that the callback receives (default: `Node`).
* @callback RunCallback
*   Callback called when transformers are done.
*
*   Called with either an error or results.
* @param {Error | undefined} [error]
*   Fatal error (optional).
* @param {Tree | undefined} [tree]
*   Transformed tree (optional).
* @param {VFile | undefined} [file]
*   File (optional).
* @returns {undefined}
*   Nothing.
*/
/**
* @template {Node} [Output=Node]
*   Node type that the transformer yields (default: `Node`).
* @callback TransformCallback
*   Callback passed to transforms.
*
*   If the signature of a `transformer` accepts a third argument, the
*   transformer may perform asynchronous operations, and must call it.
* @param {Error | undefined} [error]
*   Fatal error to stop the process (optional).
* @param {Output | undefined} [tree]
*   New, changed, tree (optional).
* @param {VFile | undefined} [file]
*   New, changed, file (optional).
* @returns {undefined}
*   Nothing.
*/
/**
* @template {Node} [Input=Node]
*   Node type that the transformer expects (default: `Node`).
* @template {Node} [Output=Input]
*   Node type that the transformer yields (default: `Input`).
* @callback Transformer
*   Transformers handle syntax trees and files.
*
*   They are functions that are called each time a syntax tree and file are
*   passed through the run phase.
*   When an error occurs in them (either because it’s thrown, returned,
*   rejected, or passed to `next`), the process stops.
*
*   The run phase is handled by [`trough`][trough], see its documentation for
*   the exact semantics of these functions.
*
*   > **Note**: you should likely ignore `next`: don’t accept it.
*   > it supports callback-style async work.
*   > But promises are likely easier to reason about.
*
*   [trough]: https://github.com/wooorm/trough#function-fninput-next
* @param {Input} tree
*   Tree to handle.
* @param {VFile} file
*   File to handle.
* @param {TransformCallback<Output>} next
*   Callback.
* @returns {(
*   Promise<Output | undefined | void> |
*   Promise<never> | // For some reason this is needed separately.
*   Output |
*   Error |
*   undefined |
*   void
* )}
*   If you accept `next`, nothing.
*   Otherwise:
*
*   *   `Error` — fatal error to stop the process
*   *   `Promise<undefined>` or `undefined` — the next transformer keeps using
*       same tree
*   *   `Promise<Node>` or `Node` — new, changed, tree
*/
/**
* @template {Node | undefined} ParseTree
*   Output of `parse`.
* @template {Node | undefined} HeadTree
*   Input for `run`.
* @template {Node | undefined} TailTree
*   Output for `run`.
* @template {Node | undefined} CompileTree
*   Input of `stringify`.
* @template {CompileResults | undefined} CompileResult
*   Output of `stringify`.
* @template {Node | string | undefined} Input
*   Input of plugin.
* @template Output
*   Output of plugin (optional).
* @typedef {(
*   Input extends string
*     ? Output extends Node | undefined
*       ? // Parser.
*         Processor<
*           Output extends undefined ? ParseTree : Output,
*           HeadTree,
*           TailTree,
*           CompileTree,
*           CompileResult
*         >
*       : // Unknown.
*         Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>
*     : Output extends CompileResults
*     ? Input extends Node | undefined
*       ? // Compiler.
*         Processor<
*           ParseTree,
*           HeadTree,
*           TailTree,
*           Input extends undefined ? CompileTree : Input,
*           Output extends undefined ? CompileResult : Output
*         >
*       : // Unknown.
*         Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>
*     : Input extends Node | undefined
*     ? Output extends Node | undefined
*       ? // Transform.
*         Processor<
*           ParseTree,
*           HeadTree extends undefined ? Input : HeadTree,
*           Output extends undefined ? TailTree : Output,
*           CompileTree,
*           CompileResult
*         >
*       : // Unknown.
*         Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>
*     : // Unknown.
*       Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>
* )} UsePlugin
*   Create a processor based on the input/output of a {@link Plugin plugin}.
*/
/**
* @template {CompileResults | undefined} Result
*   Node type that the transformer yields.
* @typedef {(
*   Result extends Value | undefined ?
*     VFile :
*     VFile & {result: Result}
*   )} VFileWithOutput
*   Type to generate a {@linkcode VFile} corresponding to a compiler result.
*
*   If a result that is not acceptable on a `VFile` is used, that will
*   be stored on the `result` field of {@linkcode VFile}.
*/
var import_extend = /* @__PURE__ */ __toESM(require_extend(), 1);
var own = {}.hasOwnProperty;
/**
* Create a new processor.
*
* @example
*   This example shows how a new processor can be created (from `remark`) and linked
*   to **stdin**(4) and **stdout**(4).
*
*   ```js
*   import process from 'node:process'
*   import concatStream from 'concat-stream'
*   import {remark} from 'remark'
*
*   process.stdin.pipe(
*     concatStream(function (buf) {
*       process.stdout.write(String(remark().processSync(buf)))
*     })
*   )
*   ```
*
* @returns
*   New *unfrozen* processor (`processor`).
*
*   This processor is configured to work the same as its ancestor.
*   When the descendant processor is configured in the future it does not
*   affect the ancestral processor.
*/
var unified = new class Processor extends CallableInstance {
	/**
	* Create a processor.
	*/
	constructor() {
		super("copy");
		/**
		* Compiler to use (deprecated).
		*
		* @deprecated
		*   Use `compiler` instead.
		* @type {(
		*   Compiler<
		*     CompileTree extends undefined ? Node : CompileTree,
		*     CompileResult extends undefined ? CompileResults : CompileResult
		*   > |
		*   undefined
		* )}
		*/
		this.Compiler = void 0;
		/**
		* Parser to use (deprecated).
		*
		* @deprecated
		*   Use `parser` instead.
		* @type {(
		*   Parser<ParseTree extends undefined ? Node : ParseTree> |
		*   undefined
		* )}
		*/
		this.Parser = void 0;
		/**
		* Internal list of configured plugins.
		*
		* @deprecated
		*   This is a private internal property and should not be used.
		* @type {Array<PluginTuple<Array<unknown>>>}
		*/
		this.attachers = [];
		/**
		* Compiler to use.
		*
		* @type {(
		*   Compiler<
		*     CompileTree extends undefined ? Node : CompileTree,
		*     CompileResult extends undefined ? CompileResults : CompileResult
		*   > |
		*   undefined
		* )}
		*/
		this.compiler = void 0;
		/**
		* Internal state to track where we are while freezing.
		*
		* @deprecated
		*   This is a private internal property and should not be used.
		* @type {number}
		*/
		this.freezeIndex = -1;
		/**
		* Internal state to track whether we’re frozen.
		*
		* @deprecated
		*   This is a private internal property and should not be used.
		* @type {boolean | undefined}
		*/
		this.frozen = void 0;
		/**
		* Internal state.
		*
		* @deprecated
		*   This is a private internal property and should not be used.
		* @type {Data}
		*/
		this.namespace = {};
		/**
		* Parser to use.
		*
		* @type {(
		*   Parser<ParseTree extends undefined ? Node : ParseTree> |
		*   undefined
		* )}
		*/
		this.parser = void 0;
		/**
		* Internal list of configured transformers.
		*
		* @deprecated
		*   This is a private internal property and should not be used.
		* @type {Pipeline}
		*/
		this.transformers = trough();
	}
	/**
	* Copy a processor.
	*
	* @deprecated
	*   This is a private internal method and should not be used.
	* @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
	*   New *unfrozen* processor ({@linkcode Processor}) that is
	*   configured to work the same as its ancestor.
	*   When the descendant processor is configured in the future it does not
	*   affect the ancestral processor.
	*/
	copy() {
		const destination = new Processor();
		let index = -1;
		while (++index < this.attachers.length) {
			const attacher = this.attachers[index];
			destination.use(...attacher);
		}
		destination.data((0, import_extend.default)(true, {}, this.namespace));
		return destination;
	}
	/**
	* Configure the processor with info available to all plugins.
	* Information is stored in an object.
	*
	* Typically, options can be given to a specific plugin, but sometimes it
	* makes sense to have information shared with several plugins.
	* For example, a list of HTML elements that are self-closing, which is
	* needed during all phases.
	*
	* > **Note**: setting information cannot occur on *frozen* processors.
	* > Call the processor first to create a new unfrozen processor.
	*
	* > **Note**: to register custom data in TypeScript, augment the
	* > {@linkcode Data} interface.
	*
	* @example
	*   This example show how to get and set info:
	*
	*   ```js
	*   import {unified} from 'unified'
	*
	*   const processor = unified().data('alpha', 'bravo')
	*
	*   processor.data('alpha') // => 'bravo'
	*
	*   processor.data() // => {alpha: 'bravo'}
	*
	*   processor.data({charlie: 'delta'})
	*
	*   processor.data() // => {charlie: 'delta'}
	*   ```
	*
	* @template {keyof Data} Key
	*
	* @overload
	* @returns {Data}
	*
	* @overload
	* @param {Data} dataset
	* @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
	*
	* @overload
	* @param {Key} key
	* @returns {Data[Key]}
	*
	* @overload
	* @param {Key} key
	* @param {Data[Key]} value
	* @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
	*
	* @param {Data | Key} [key]
	*   Key to get or set, or entire dataset to set, or nothing to get the
	*   entire dataset (optional).
	* @param {Data[Key]} [value]
	*   Value to set (optional).
	* @returns {unknown}
	*   The current processor when setting, the value at `key` when getting, or
	*   the entire dataset when getting without key.
	*/
	data(key, value) {
		if (typeof key === "string") {
			if (arguments.length === 2) {
				assertUnfrozen("data", this.frozen);
				this.namespace[key] = value;
				return this;
			}
			return own.call(this.namespace, key) && this.namespace[key] || void 0;
		}
		if (key) {
			assertUnfrozen("data", this.frozen);
			this.namespace = key;
			return this;
		}
		return this.namespace;
	}
	/**
	* Freeze a processor.
	*
	* Frozen processors are meant to be extended and not to be configured
	* directly.
	*
	* When a processor is frozen it cannot be unfrozen.
	* New processors working the same way can be created by calling the
	* processor.
	*
	* It’s possible to freeze processors explicitly by calling `.freeze()`.
	* Processors freeze automatically when `.parse()`, `.run()`, `.runSync()`,
	* `.stringify()`, `.process()`, or `.processSync()` are called.
	*
	* @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
	*   The current processor.
	*/
	freeze() {
		if (this.frozen) return this;
		const self = this;
		while (++this.freezeIndex < this.attachers.length) {
			const [attacher, ...options] = this.attachers[this.freezeIndex];
			if (options[0] === false) continue;
			if (options[0] === true) options[0] = void 0;
			const transformer = attacher.call(self, ...options);
			if (typeof transformer === "function") this.transformers.use(transformer);
		}
		this.frozen = true;
		this.freezeIndex = Number.POSITIVE_INFINITY;
		return this;
	}
	/**
	* Parse text to a syntax tree.
	*
	* > **Note**: `parse` freezes the processor if not already *frozen*.
	*
	* > **Note**: `parse` performs the parse phase, not the run phase or other
	* > phases.
	*
	* @param {Compatible | undefined} [file]
	*   file to parse (optional); typically `string` or `VFile`; any value
	*   accepted as `x` in `new VFile(x)`.
	* @returns {ParseTree extends undefined ? Node : ParseTree}
	*   Syntax tree representing `file`.
	*/
	parse(file) {
		this.freeze();
		const realFile = vfile(file);
		const parser = this.parser || this.Parser;
		assertParser("parse", parser);
		return parser(String(realFile), realFile);
	}
	/**
	* Process the given file as configured on the processor.
	*
	* > **Note**: `process` freezes the processor if not already *frozen*.
	*
	* > **Note**: `process` performs the parse, run, and stringify phases.
	*
	* @overload
	* @param {Compatible | undefined} file
	* @param {ProcessCallback<VFileWithOutput<CompileResult>>} done
	* @returns {undefined}
	*
	* @overload
	* @param {Compatible | undefined} [file]
	* @returns {Promise<VFileWithOutput<CompileResult>>}
	*
	* @param {Compatible | undefined} [file]
	*   File (optional); typically `string` or `VFile`]; any value accepted as
	*   `x` in `new VFile(x)`.
	* @param {ProcessCallback<VFileWithOutput<CompileResult>> | undefined} [done]
	*   Callback (optional).
	* @returns {Promise<VFile> | undefined}
	*   Nothing if `done` is given.
	*   Otherwise a promise, rejected with a fatal error or resolved with the
	*   processed file.
	*
	*   The parsed, transformed, and compiled value is available at
	*   `file.value` (see note).
	*
	*   > **Note**: unified typically compiles by serializing: most
	*   > compilers return `string` (or `Uint8Array`).
	*   > Some compilers, such as the one configured with
	*   > [`rehype-react`][rehype-react], return other values (in this case, a
	*   > React tree).
	*   > If you’re using a compiler that doesn’t serialize, expect different
	*   > result values.
	*   >
	*   > To register custom results in TypeScript, add them to
	*   > {@linkcode CompileResultMap}.
	*
	*   [rehype-react]: https://github.com/rehypejs/rehype-react
	*/
	process(file, done) {
		const self = this;
		this.freeze();
		assertParser("process", this.parser || this.Parser);
		assertCompiler("process", this.compiler || this.Compiler);
		return done ? executor(void 0, done) : new Promise(executor);
		/**
		* @param {((file: VFileWithOutput<CompileResult>) => undefined | void) | undefined} resolve
		* @param {(error: Error | undefined) => undefined | void} reject
		* @returns {undefined}
		*/
		function executor(resolve, reject) {
			const realFile = vfile(file);
			const parseTree = self.parse(realFile);
			self.run(parseTree, realFile, function(error, tree, file) {
				if (error || !tree || !file) return realDone(error);
				const compileTree = tree;
				const compileResult = self.stringify(compileTree, file);
				if (looksLikeAValue(compileResult)) file.value = compileResult;
				else file.result = compileResult;
				realDone(error, file);
			});
			/**
			* @param {Error | undefined} error
			* @param {VFileWithOutput<CompileResult> | undefined} [file]
			* @returns {undefined}
			*/
			function realDone(error, file) {
				if (error || !file) reject(error);
				else if (resolve) resolve(file);
				else done(void 0, file);
			}
		}
	}
	/**
	* Process the given file as configured on the processor.
	*
	* An error is thrown if asynchronous transforms are configured.
	*
	* > **Note**: `processSync` freezes the processor if not already *frozen*.
	*
	* > **Note**: `processSync` performs the parse, run, and stringify phases.
	*
	* @param {Compatible | undefined} [file]
	*   File (optional); typically `string` or `VFile`; any value accepted as
	*   `x` in `new VFile(x)`.
	* @returns {VFileWithOutput<CompileResult>}
	*   The processed file.
	*
	*   The parsed, transformed, and compiled value is available at
	*   `file.value` (see note).
	*
	*   > **Note**: unified typically compiles by serializing: most
	*   > compilers return `string` (or `Uint8Array`).
	*   > Some compilers, such as the one configured with
	*   > [`rehype-react`][rehype-react], return other values (in this case, a
	*   > React tree).
	*   > If you’re using a compiler that doesn’t serialize, expect different
	*   > result values.
	*   >
	*   > To register custom results in TypeScript, add them to
	*   > {@linkcode CompileResultMap}.
	*
	*   [rehype-react]: https://github.com/rehypejs/rehype-react
	*/
	processSync(file) {
		/** @type {boolean} */
		let complete = false;
		/** @type {VFileWithOutput<CompileResult> | undefined} */
		let result;
		this.freeze();
		assertParser("processSync", this.parser || this.Parser);
		assertCompiler("processSync", this.compiler || this.Compiler);
		this.process(file, realDone);
		assertDone("processSync", "process", complete);
		return result;
		/**
		* @type {ProcessCallback<VFileWithOutput<CompileResult>>}
		*/
		function realDone(error, file) {
			complete = true;
			bail(error);
			result = file;
		}
	}
	/**
	* Run *transformers* on a syntax tree.
	*
	* > **Note**: `run` freezes the processor if not already *frozen*.
	*
	* > **Note**: `run` performs the run phase, not other phases.
	*
	* @overload
	* @param {HeadTree extends undefined ? Node : HeadTree} tree
	* @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
	* @returns {undefined}
	*
	* @overload
	* @param {HeadTree extends undefined ? Node : HeadTree} tree
	* @param {Compatible | undefined} file
	* @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
	* @returns {undefined}
	*
	* @overload
	* @param {HeadTree extends undefined ? Node : HeadTree} tree
	* @param {Compatible | undefined} [file]
	* @returns {Promise<TailTree extends undefined ? Node : TailTree>}
	*
	* @param {HeadTree extends undefined ? Node : HeadTree} tree
	*   Tree to transform and inspect.
	* @param {(
	*   RunCallback<TailTree extends undefined ? Node : TailTree> |
	*   Compatible
	* )} [file]
	*   File associated with `node` (optional); any value accepted as `x` in
	*   `new VFile(x)`.
	* @param {RunCallback<TailTree extends undefined ? Node : TailTree>} [done]
	*   Callback (optional).
	* @returns {Promise<TailTree extends undefined ? Node : TailTree> | undefined}
	*   Nothing if `done` is given.
	*   Otherwise, a promise rejected with a fatal error or resolved with the
	*   transformed tree.
	*/
	run(tree, file, done) {
		assertNode(tree);
		this.freeze();
		const transformers = this.transformers;
		if (!done && typeof file === "function") {
			done = file;
			file = void 0;
		}
		return done ? executor(void 0, done) : new Promise(executor);
		/**
		* @param {(
		*   ((tree: TailTree extends undefined ? Node : TailTree) => undefined | void) |
		*   undefined
		* )} resolve
		* @param {(error: Error) => undefined | void} reject
		* @returns {undefined}
		*/
		function executor(resolve, reject) {
			const realFile = vfile(file);
			transformers.run(tree, realFile, realDone);
			/**
			* @param {Error | undefined} error
			* @param {Node} outputTree
			* @param {VFile} file
			* @returns {undefined}
			*/
			function realDone(error, outputTree, file) {
				const resultingTree = outputTree || tree;
				if (error) reject(error);
				else if (resolve) resolve(resultingTree);
				else done(void 0, resultingTree, file);
			}
		}
	}
	/**
	* Run *transformers* on a syntax tree.
	*
	* An error is thrown if asynchronous transforms are configured.
	*
	* > **Note**: `runSync` freezes the processor if not already *frozen*.
	*
	* > **Note**: `runSync` performs the run phase, not other phases.
	*
	* @param {HeadTree extends undefined ? Node : HeadTree} tree
	*   Tree to transform and inspect.
	* @param {Compatible | undefined} [file]
	*   File associated with `node` (optional); any value accepted as `x` in
	*   `new VFile(x)`.
	* @returns {TailTree extends undefined ? Node : TailTree}
	*   Transformed tree.
	*/
	runSync(tree, file) {
		/** @type {boolean} */
		let complete = false;
		/** @type {(TailTree extends undefined ? Node : TailTree) | undefined} */
		let result;
		this.run(tree, file, realDone);
		assertDone("runSync", "run", complete);
		return result;
		/**
		* @type {RunCallback<TailTree extends undefined ? Node : TailTree>}
		*/
		function realDone(error, tree) {
			bail(error);
			result = tree;
			complete = true;
		}
	}
	/**
	* Compile a syntax tree.
	*
	* > **Note**: `stringify` freezes the processor if not already *frozen*.
	*
	* > **Note**: `stringify` performs the stringify phase, not the run phase
	* > or other phases.
	*
	* @param {CompileTree extends undefined ? Node : CompileTree} tree
	*   Tree to compile.
	* @param {Compatible | undefined} [file]
	*   File associated with `node` (optional); any value accepted as `x` in
	*   `new VFile(x)`.
	* @returns {CompileResult extends undefined ? Value : CompileResult}
	*   Textual representation of the tree (see note).
	*
	*   > **Note**: unified typically compiles by serializing: most compilers
	*   > return `string` (or `Uint8Array`).
	*   > Some compilers, such as the one configured with
	*   > [`rehype-react`][rehype-react], return other values (in this case, a
	*   > React tree).
	*   > If you’re using a compiler that doesn’t serialize, expect different
	*   > result values.
	*   >
	*   > To register custom results in TypeScript, add them to
	*   > {@linkcode CompileResultMap}.
	*
	*   [rehype-react]: https://github.com/rehypejs/rehype-react
	*/
	stringify(tree, file) {
		this.freeze();
		const realFile = vfile(file);
		const compiler = this.compiler || this.Compiler;
		assertCompiler("stringify", compiler);
		assertNode(tree);
		return compiler(tree, realFile);
	}
	/**
	* Configure the processor to use a plugin, a list of usable values, or a
	* preset.
	*
	* If the processor is already using a plugin, the previous plugin
	* configuration is changed based on the options that are passed in.
	* In other words, the plugin is not added a second time.
	*
	* > **Note**: `use` cannot be called on *frozen* processors.
	* > Call the processor first to create a new unfrozen processor.
	*
	* @example
	*   There are many ways to pass plugins to `.use()`.
	*   This example gives an overview:
	*
	*   ```js
	*   import {unified} from 'unified'
	*
	*   unified()
	*     // Plugin with options:
	*     .use(pluginA, {x: true, y: true})
	*     // Passing the same plugin again merges configuration (to `{x: true, y: false, z: true}`):
	*     .use(pluginA, {y: false, z: true})
	*     // Plugins:
	*     .use([pluginB, pluginC])
	*     // Two plugins, the second with options:
	*     .use([pluginD, [pluginE, {}]])
	*     // Preset with plugins and settings:
	*     .use({plugins: [pluginF, [pluginG, {}]], settings: {position: false}})
	*     // Settings only:
	*     .use({settings: {position: false}})
	*   ```
	*
	* @template {Array<unknown>} [Parameters=[]]
	* @template {Node | string | undefined} [Input=undefined]
	* @template [Output=Input]
	*
	* @overload
	* @param {Preset | null | undefined} [preset]
	* @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
	*
	* @overload
	* @param {PluggableList} list
	* @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
	*
	* @overload
	* @param {Plugin<Parameters, Input, Output>} plugin
	* @param {...(Parameters | [boolean])} parameters
	* @returns {UsePlugin<ParseTree, HeadTree, TailTree, CompileTree, CompileResult, Input, Output>}
	*
	* @param {PluggableList | Plugin | Preset | null | undefined} value
	*   Usable value.
	* @param {...unknown} parameters
	*   Parameters, when a plugin is given as a usable value.
	* @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
	*   Current processor.
	*/
	use(value, ...parameters) {
		const attachers = this.attachers;
		const namespace = this.namespace;
		assertUnfrozen("use", this.frozen);
		if (value === null || value === void 0) {} else if (typeof value === "function") addPlugin(value, parameters);
		else if (typeof value === "object") {
			if (Array.isArray(value)) addList(value);
			else addPreset(value);
		} else throw new TypeError("Expected usable value, not `" + value + "`");
		return this;
		/**
		* @param {Pluggable} value
		* @returns {undefined}
		*/
		function add(value) {
			if (typeof value === "function") addPlugin(value, []);
			else if (typeof value === "object") {
				if (Array.isArray(value)) {
					const [plugin, ...parameters] = value;
					addPlugin(plugin, parameters);
				} else addPreset(value);
			} else throw new TypeError("Expected usable value, not `" + value + "`");
		}
		/**
		* @param {Preset} result
		* @returns {undefined}
		*/
		function addPreset(result) {
			if (!("plugins" in result) && !("settings" in result)) throw new Error("Expected usable value but received an empty preset, which is probably a mistake: presets typically come with `plugins` and sometimes with `settings`, but this has neither");
			addList(result.plugins);
			if (result.settings) namespace.settings = (0, import_extend.default)(true, namespace.settings, result.settings);
		}
		/**
		* @param {PluggableList | null | undefined} plugins
		* @returns {undefined}
		*/
		function addList(plugins) {
			let index = -1;
			if (plugins === null || plugins === void 0) {} else if (Array.isArray(plugins)) while (++index < plugins.length) {
				const thing = plugins[index];
				add(thing);
			}
			else throw new TypeError("Expected a list of plugins, not `" + plugins + "`");
		}
		/**
		* @param {Plugin} plugin
		* @param {Array<unknown>} parameters
		* @returns {undefined}
		*/
		function addPlugin(plugin, parameters) {
			let index = -1;
			let entryIndex = -1;
			while (++index < attachers.length) if (attachers[index][0] === plugin) {
				entryIndex = index;
				break;
			}
			if (entryIndex === -1) attachers.push([plugin, ...parameters]);
			else if (parameters.length > 0) {
				let [primary, ...rest] = parameters;
				const currentPrimary = attachers[entryIndex][1];
				if (isPlainObject(currentPrimary) && isPlainObject(primary)) primary = (0, import_extend.default)(true, currentPrimary, primary);
				attachers[entryIndex] = [
					plugin,
					primary,
					...rest
				];
			}
		}
	}
}().freeze();
/**
* Assert a parser is available.
*
* @param {string} name
* @param {unknown} value
* @returns {asserts value is Parser}
*/
function assertParser(name, value) {
	if (typeof value !== "function") throw new TypeError("Cannot `" + name + "` without `parser`");
}
/**
* Assert a compiler is available.
*
* @param {string} name
* @param {unknown} value
* @returns {asserts value is Compiler}
*/
function assertCompiler(name, value) {
	if (typeof value !== "function") throw new TypeError("Cannot `" + name + "` without `compiler`");
}
/**
* Assert the processor is not frozen.
*
* @param {string} name
* @param {unknown} frozen
* @returns {asserts frozen is false}
*/
function assertUnfrozen(name, frozen) {
	if (frozen) throw new Error("Cannot call `" + name + "` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`.");
}
/**
* Assert `node` is a unist node.
*
* @param {unknown} node
* @returns {asserts node is Node}
*/
function assertNode(node) {
	if (!isPlainObject(node) || typeof node.type !== "string") throw new TypeError("Expected node, got `" + node + "`");
}
/**
* Assert that `complete` is `true`.
*
* @param {string} name
* @param {string} asyncName
* @param {unknown} complete
* @returns {asserts complete is true}
*/
function assertDone(name, asyncName, complete) {
	if (!complete) throw new Error("`" + name + "` finished async. Use `" + asyncName + "` instead");
}
/**
* @param {Compatible | undefined} [value]
* @returns {VFile}
*/
function vfile(value) {
	return looksLikeAVFile(value) ? value : new VFile(value);
}
/**
* @param {Compatible | undefined} [value]
* @returns {value is VFile}
*/
function looksLikeAVFile(value) {
	return Boolean(value && typeof value === "object" && "message" in value && "messages" in value);
}
/**
* @param {unknown} [value]
* @returns {value is Value}
*/
function looksLikeAValue(value) {
	return typeof value === "string" || isUint8Array(value);
}
/**
* Assert `value` is an `Uint8Array`.
*
* @param {unknown} value
*   thing.
* @returns {value is Uint8Array}
*   Whether `value` is an `Uint8Array`.
*/
function isUint8Array(value) {
	return Boolean(value && typeof value === "object" && "byteLength" in value && "byteOffset" in value);
}
//#endregion
//#region ../../node_modules/react-markdown/lib/index.js
/**
* @import {Element, Nodes, Parents, Root} from 'hast'
* @import {Root as MdastRoot} from 'mdast'
* @import {ComponentType, JSX, ReactElement, ReactNode} from 'react'
* @import {Options as RemarkRehypeOptions} from 'remark-rehype'
* @import {BuildVisitor} from 'unist-util-visit'
* @import {PluggableList, Processor} from 'unified'
*/
/**
* @callback AllowElement
*   Filter elements.
* @param {Readonly<Element>} element
*   Element to check.
* @param {number} index
*   Index of `element` in `parent`.
* @param {Readonly<Parents> | undefined} parent
*   Parent of `element`.
* @returns {boolean | null | undefined}
*   Whether to allow `element` (default: `false`).
*/
/**
* @typedef ExtraProps
*   Extra fields we pass.
* @property {Element | undefined} [node]
*   passed when `passNode` is on.
*/
/**
* @typedef {{
*   [Key in keyof JSX.IntrinsicElements]?: ComponentType<JSX.IntrinsicElements[Key] & ExtraProps> | keyof JSX.IntrinsicElements
* }} Components
*   Map tag names to components.
*/
/**
* @typedef Deprecation
*   Deprecation.
* @property {string} from
*   Old field.
* @property {string} id
*   ID in readme.
* @property {keyof Options} [to]
*   New field.
*/
/**
* @typedef Options
*   Configuration.
* @property {AllowElement | null | undefined} [allowElement]
*   Filter elements (optional);
*   `allowedElements` / `disallowedElements` is used first.
* @property {ReadonlyArray<string> | null | undefined} [allowedElements]
*   Tag names to allow (default: all tag names);
*   cannot combine w/ `disallowedElements`.
* @property {string | null | undefined} [children]
*   Markdown.
* @property {Components | null | undefined} [components]
*   Map tag names to components.
* @property {ReadonlyArray<string> | null | undefined} [disallowedElements]
*   Tag names to disallow (default: `[]`);
*   cannot combine w/ `allowedElements`.
* @property {PluggableList | null | undefined} [rehypePlugins]
*   List of rehype plugins to use.
* @property {PluggableList | null | undefined} [remarkPlugins]
*   List of remark plugins to use.
* @property {Readonly<RemarkRehypeOptions> | null | undefined} [remarkRehypeOptions]
*   Options to pass through to `remark-rehype`.
* @property {boolean | null | undefined} [skipHtml=false]
*   Ignore HTML in markdown completely (default: `false`).
* @property {boolean | null | undefined} [unwrapDisallowed=false]
*   Extract (unwrap) what’s in disallowed elements (default: `false`);
*   normally when say `strong` is not allowed, it and it’s children are dropped,
*   with `unwrapDisallowed` the element itself is replaced by its children.
* @property {UrlTransform | null | undefined} [urlTransform]
*   Change URLs (default: `defaultUrlTransform`)
*/
/**
* @typedef HooksOptionsOnly
*   Configuration specifically for {@linkcode MarkdownHooks}.
* @property {ReactNode | null | undefined} [fallback]
*   Content to render while the processor processing the markdown (optional).
*/
/**
* @typedef {Options & HooksOptionsOnly} HooksOptions
*   Configuration for {@linkcode MarkdownHooks};
*   extends the regular {@linkcode Options} with a `fallback` prop.
*/
/**
* @callback UrlTransform
*   Transform all URLs.
* @param {string} url
*   URL.
* @param {string} key
*   Property name (example: `'href'`).
* @param {Readonly<Element>} node
*   Node.
* @returns {string | null | undefined}
*   Transformed URL (optional).
*/
/** @type {PluggableList} */
var emptyPlugins = [];
/** @type {Readonly<RemarkRehypeOptions>} */
var emptyRemarkRehypeOptions = { allowDangerousHtml: true };
var safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;
/** @type {ReadonlyArray<Readonly<Deprecation>>} */
var deprecations = [
	{
		from: "astPlugins",
		id: "remove-buggy-html-in-markdown-parser"
	},
	{
		from: "allowDangerousHtml",
		id: "remove-buggy-html-in-markdown-parser"
	},
	{
		from: "allowNode",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "allowElement"
	},
	{
		from: "allowedTypes",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "allowedElements"
	},
	{
		from: "className",
		id: "remove-classname"
	},
	{
		from: "disallowedTypes",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "disallowedElements"
	},
	{
		from: "escapeHtml",
		id: "remove-buggy-html-in-markdown-parser"
	},
	{
		from: "includeElementIndex",
		id: "#remove-includeelementindex"
	},
	{
		from: "includeNodeIndex",
		id: "change-includenodeindex-to-includeelementindex"
	},
	{
		from: "linkTarget",
		id: "remove-linktarget"
	},
	{
		from: "plugins",
		id: "change-plugins-to-remarkplugins",
		to: "remarkPlugins"
	},
	{
		from: "rawSourcePos",
		id: "#remove-rawsourcepos"
	},
	{
		from: "renderers",
		id: "change-renderers-to-components",
		to: "components"
	},
	{
		from: "source",
		id: "change-source-to-children",
		to: "children"
	},
	{
		from: "sourcePos",
		id: "#remove-sourcepos"
	},
	{
		from: "transformImageUri",
		id: "#add-urltransform",
		to: "urlTransform"
	},
	{
		from: "transformLinkUri",
		id: "#add-urltransform",
		to: "urlTransform"
	}
];
/**
* Component to render markdown.
*
* This is a synchronous component.
* When using async plugins,
* see {@linkcode MarkdownAsync} or {@linkcode MarkdownHooks}.
*
* @param {Readonly<Options>} options
*   Props.
* @returns {ReactElement}
*   React element.
*/
function Markdown(options) {
	const processor = createProcessor(options);
	const file = createFile(options);
	return post(processor.runSync(processor.parse(file), file), options);
}
/**
* Set up the `unified` processor.
*
* @param {Readonly<Options>} options
*   Props.
* @returns {Processor<MdastRoot, MdastRoot, Root, undefined, undefined>}
*   Result.
*/
function createProcessor(options) {
	const rehypePlugins = options.rehypePlugins || emptyPlugins;
	const remarkPlugins = options.remarkPlugins || emptyPlugins;
	const remarkRehypeOptions = options.remarkRehypeOptions ? {
		...options.remarkRehypeOptions,
		...emptyRemarkRehypeOptions
	} : emptyRemarkRehypeOptions;
	return unified().use(remarkParse).use(remarkPlugins).use(remarkRehype, remarkRehypeOptions).use(rehypePlugins);
}
/**
* Set up the virtual file.
*
* @param {Readonly<Options>} options
*   Props.
* @returns {VFile}
*   Result.
*/
function createFile(options) {
	const children = options.children || "";
	const file = new VFile();
	if (typeof children === "string") file.value = children;
	else "" + children;
	return file;
}
/**
* Process the result from unified some more.
*
* @param {Nodes} tree
*   Tree.
* @param {Readonly<Options>} options
*   Props.
* @returns {ReactElement}
*   React element.
*/
function post(tree, options) {
	const allowedElements = options.allowedElements;
	const allowElement = options.allowElement;
	const components = options.components;
	const disallowedElements = options.disallowedElements;
	const skipHtml = options.skipHtml;
	const unwrapDisallowed = options.unwrapDisallowed;
	const urlTransform = options.urlTransform || defaultUrlTransform;
	for (const deprecation of deprecations) if (Object.hasOwn(options, deprecation.from)) "" + deprecation.from + (deprecation.to ? "use `" + deprecation.to + "` instead" : "remove it") + deprecation.id;
	if (allowedElements && disallowedElements);
	visit(tree, transform);
	return toJsxRuntime(tree, {
		Fragment,
		components,
		ignoreInvalidStyle: true,
		jsx,
		jsxs,
		passKeys: true,
		passNode: true
	});
	/** @type {BuildVisitor<Root>} */
	function transform(node, index, parent) {
		if (node.type === "raw" && parent && typeof index === "number") {
			if (skipHtml) parent.children.splice(index, 1);
			else parent.children[index] = {
				type: "text",
				value: node.value
			};
			return index;
		}
		if (node.type === "element") {
			/** @type {string} */
			let key;
			for (key in urlAttributes) if (Object.hasOwn(urlAttributes, key) && Object.hasOwn(node.properties, key)) {
				const value = node.properties[key];
				const test = urlAttributes[key];
				if (test === null || test.includes(node.tagName)) node.properties[key] = urlTransform(String(value || ""), key, node);
			}
		}
		if (node.type === "element") {
			let remove = allowedElements ? !allowedElements.includes(node.tagName) : disallowedElements ? disallowedElements.includes(node.tagName) : false;
			if (!remove && allowElement && typeof index === "number") remove = !allowElement(node, index, parent);
			if (remove && parent && typeof index === "number") {
				if (unwrapDisallowed && node.children) parent.children.splice(index, 1, ...node.children);
				else parent.children.splice(index, 1);
				return index;
			}
		}
	}
}
/**
* Make a URL safe.
*
* @satisfies {UrlTransform}
* @param {string} value
*   URL.
* @returns {string}
*   Safe URL.
*/
function defaultUrlTransform(value) {
	const colon = value.indexOf(":");
	const questionMark = value.indexOf("?");
	const numberSign = value.indexOf("#");
	const slash = value.indexOf("/");
	if (colon === -1 || slash !== -1 && colon > slash || questionMark !== -1 && colon > questionMark || numberSign !== -1 && colon > numberSign || safeProtocol.test(value.slice(0, colon))) return value;
	return "";
}
//#endregion
//#region ../../node_modules/ccount/index.js
/**
* Count how often a character (or substring) is used in a string.
*
* @param {string} value
*   Value to search in.
* @param {string} character
*   Character (or substring) to look for.
* @return {number}
*   Number of times `character` occurred in `value`.
*/
function ccount(value, character) {
	const source = String(value);
	if (typeof character !== "string") throw new TypeError("Expected character");
	let count = 0;
	let index = source.indexOf(character);
	while (index !== -1) {
		count++;
		index = source.indexOf(character, index + character.length);
	}
	return count;
}
//#endregion
//#region ../../node_modules/mdast-util-find-and-replace/node_modules/escape-string-regexp/index.js
function escapeStringRegexp(string) {
	if (typeof string !== "string") throw new TypeError("Expected a string");
	return string.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
//#endregion
//#region ../../node_modules/mdast-util-find-and-replace/lib/index.js
/**
* @import {Nodes, Parents, PhrasingContent, Root, Text} from 'mdast'
* @import {BuildVisitor, Test, VisitorResult} from 'unist-util-visit-parents'
*/
/**
* @typedef RegExpMatchObject
*   Info on the match.
* @property {number} index
*   The index of the search at which the result was found.
* @property {string} input
*   A copy of the search string in the text node.
* @property {[...Array<Parents>, Text]} stack
*   All ancestors of the text node, where the last node is the text itself.
*
* @typedef {RegExp | string} Find
*   Pattern to find.
*
*   Strings are escaped and then turned into global expressions.
*
* @typedef {Array<FindAndReplaceTuple>} FindAndReplaceList
*   Several find and replaces, in array form.
*
* @typedef {[Find, Replace?]} FindAndReplaceTuple
*   Find and replace in tuple form.
*
* @typedef {ReplaceFunction | string | null | undefined} Replace
*   Thing to replace with.
*
* @callback ReplaceFunction
*   Callback called when a search matches.
* @param {...any} parameters
*   The parameters are the result of corresponding search expression:
*
*   * `value` (`string`) — whole match
*   * `...capture` (`Array<string>`) — matches from regex capture groups
*   * `match` (`RegExpMatchObject`) — info on the match
* @returns {Array<PhrasingContent> | PhrasingContent | string | false | null | undefined}
*   Thing to replace with.
*
*   * when `null`, `undefined`, `''`, remove the match
*   * …or when `false`, do not replace at all
*   * …or when `string`, replace with a text node of that value
*   * …or when `Node` or `Array<Node>`, replace with those nodes
*
* @typedef {[RegExp, ReplaceFunction]} Pair
*   Normalized find and replace.
*
* @typedef {Array<Pair>} Pairs
*   All find and replaced.
*
* @typedef Options
*   Configuration.
* @property {Test | null | undefined} [ignore]
*   Test for which nodes to ignore (optional).
*/
/**
* Find patterns in a tree and replace them.
*
* The algorithm searches the tree in *preorder* for complete values in `Text`
* nodes.
* Partial matches are not supported.
*
* @param {Nodes} tree
*   Tree to change.
* @param {FindAndReplaceList | FindAndReplaceTuple} list
*   Patterns to find.
* @param {Options | null | undefined} [options]
*   Configuration (when `find` is not `Find`).
* @returns {undefined}
*   Nothing.
*/
function findAndReplace(tree, list, options) {
	const ignored = convert((options || {}).ignore || []);
	const pairs = toPairs(list);
	let pairIndex = -1;
	while (++pairIndex < pairs.length) visitParents(tree, "text", visitor);
	/** @type {BuildVisitor<Root, 'text'>} */
	function visitor(node, parents) {
		let index = -1;
		/** @type {Parents | undefined} */
		let grandparent;
		while (++index < parents.length) {
			const parent = parents[index];
			/** @type {Array<Nodes> | undefined} */
			const siblings = grandparent ? grandparent.children : void 0;
			if (ignored(parent, siblings ? siblings.indexOf(parent) : void 0, grandparent)) return;
			grandparent = parent;
		}
		if (grandparent) return handler(node, parents);
	}
	/**
	* Handle a text node which is not in an ignored parent.
	*
	* @param {Text} node
	*   Text node.
	* @param {Array<Parents>} parents
	*   Parents.
	* @returns {VisitorResult}
	*   Result.
	*/
	function handler(node, parents) {
		const parent = parents[parents.length - 1];
		const find = pairs[pairIndex][0];
		const replace = pairs[pairIndex][1];
		let start = 0;
		const index = parent.children.indexOf(node);
		let change = false;
		/** @type {Array<PhrasingContent>} */
		let nodes = [];
		find.lastIndex = 0;
		let match = find.exec(node.value);
		while (match) {
			const position = match.index;
			/** @type {RegExpMatchObject} */
			const matchObject = {
				index: match.index,
				input: match.input,
				stack: [...parents, node]
			};
			let value = replace(...match, matchObject);
			if (typeof value === "string") value = value.length > 0 ? {
				type: "text",
				value
			} : void 0;
			if (value === false) find.lastIndex = position + 1;
			else {
				if (start !== position) nodes.push({
					type: "text",
					value: node.value.slice(start, position)
				});
				if (Array.isArray(value)) nodes.push(...value);
				else if (value) nodes.push(value);
				start = position + match[0].length;
				change = true;
			}
			if (!find.global) break;
			match = find.exec(node.value);
		}
		if (change) {
			if (start < node.value.length) nodes.push({
				type: "text",
				value: node.value.slice(start)
			});
			parent.children.splice(index, 1, ...nodes);
		} else nodes = [node];
		return index + nodes.length;
	}
}
/**
* Turn a tuple or a list of tuples into pairs.
*
* @param {FindAndReplaceList | FindAndReplaceTuple} tupleOrList
*   Schema.
* @returns {Pairs}
*   Clean pairs.
*/
function toPairs(tupleOrList) {
	/** @type {Pairs} */
	const result = [];
	if (!Array.isArray(tupleOrList)) throw new TypeError("Expected find and replace tuple or list of tuples");
	/** @type {FindAndReplaceList} */
	const list = !tupleOrList[0] || Array.isArray(tupleOrList[0]) ? tupleOrList : [tupleOrList];
	let index = -1;
	while (++index < list.length) {
		const tuple = list[index];
		result.push([toExpression(tuple[0]), toFunction(tuple[1])]);
	}
	return result;
}
/**
* Turn a find into an expression.
*
* @param {Find} find
*   Find.
* @returns {RegExp}
*   Expression.
*/
function toExpression(find) {
	return typeof find === "string" ? new RegExp(escapeStringRegexp(find), "g") : find;
}
/**
* Turn a replace into a function.
*
* @param {Replace} replace
*   Replace.
* @returns {ReplaceFunction}
*   Function.
*/
function toFunction(replace) {
	return typeof replace === "function" ? replace : function() {
		return replace;
	};
}
//#endregion
//#region ../../node_modules/mdast-util-gfm-autolink-literal/lib/index.js
/**
* @import {RegExpMatchObject, ReplaceFunction} from 'mdast-util-find-and-replace'
* @import {CompileContext, Extension as FromMarkdownExtension, Handle as FromMarkdownHandle, Transform as FromMarkdownTransform} from 'mdast-util-from-markdown'
* @import {ConstructName, Options as ToMarkdownExtension} from 'mdast-util-to-markdown'
* @import {Link, PhrasingContent} from 'mdast'
*/
/** @type {ConstructName} */
var inConstruct = "phrasing";
/** @type {Array<ConstructName>} */
var notInConstruct = [
	"autolink",
	"link",
	"image",
	"label"
];
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM autolink
* literals in markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-to-markdown` to enable GFM autolink literals.
*/
function gfmAutolinkLiteralFromMarkdown() {
	return {
		transforms: [transformGfmAutolinkLiterals],
		enter: {
			literalAutolink: enterLiteralAutolink,
			literalAutolinkEmail: enterLiteralAutolinkValue,
			literalAutolinkHttp: enterLiteralAutolinkValue,
			literalAutolinkWww: enterLiteralAutolinkValue
		},
		exit: {
			literalAutolink: exitLiteralAutolink,
			literalAutolinkEmail: exitLiteralAutolinkEmail,
			literalAutolinkHttp: exitLiteralAutolinkHttp,
			literalAutolinkWww: exitLiteralAutolinkWww
		}
	};
}
/**
* Create an extension for `mdast-util-to-markdown` to enable GFM autolink
* literals in markdown.
*
* @returns {ToMarkdownExtension}
*   Extension for `mdast-util-to-markdown` to enable GFM autolink literals.
*/
function gfmAutolinkLiteralToMarkdown() {
	return { unsafe: [
		{
			character: "@",
			before: "[+\\-.\\w]",
			after: "[\\-.\\w]",
			inConstruct,
			notInConstruct
		},
		{
			character: ".",
			before: "[Ww]",
			after: "[\\-.\\w]",
			inConstruct,
			notInConstruct
		},
		{
			character: ":",
			before: "[ps]",
			after: "\\/",
			inConstruct,
			notInConstruct
		}
	] };
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterLiteralAutolink(token) {
	this.enter({
		type: "link",
		title: null,
		url: "",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterLiteralAutolinkValue(token) {
	this.config.enter.autolinkProtocol.call(this, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitLiteralAutolinkHttp(token) {
	this.config.exit.autolinkProtocol.call(this, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitLiteralAutolinkWww(token) {
	this.config.exit.data.call(this, token);
	const node = this.stack[this.stack.length - 1];
	node.type;
	node.url = "http://" + this.sliceSerialize(token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitLiteralAutolinkEmail(token) {
	this.config.exit.autolinkEmail.call(this, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitLiteralAutolink(token) {
	this.exit(token);
}
/** @type {FromMarkdownTransform} */
function transformGfmAutolinkLiterals(tree) {
	findAndReplace(tree, [[/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, findUrl], [/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu, findEmail]], { ignore: ["link", "linkReference"] });
}
/**
* @type {ReplaceFunction}
* @param {string} _
* @param {string} protocol
* @param {string} domain
* @param {string} path
* @param {RegExpMatchObject} match
* @returns {Array<PhrasingContent> | Link | false}
*/
function findUrl(_, protocol, domain, path, match) {
	let prefix = "";
	if (!previous(match)) return false;
	if (/^w/i.test(protocol)) {
		domain = protocol + domain;
		protocol = "";
		prefix = "http://";
	}
	if (!isCorrectDomain(domain)) return false;
	const parts = splitUrl(domain + path);
	if (!parts[0]) return false;
	/** @type {Link} */
	const result = {
		type: "link",
		title: null,
		url: prefix + protocol + parts[0],
		children: [{
			type: "text",
			value: protocol + parts[0]
		}]
	};
	if (parts[1]) return [result, {
		type: "text",
		value: parts[1]
	}];
	return result;
}
/**
* @type {ReplaceFunction}
* @param {string} _
* @param {string} atext
* @param {string} label
* @param {RegExpMatchObject} match
* @returns {Link | false}
*/
function findEmail(_, atext, label, match) {
	if (!previous(match, true) || /[-\d_]$/.test(label)) return false;
	return {
		type: "link",
		title: null,
		url: "mailto:" + atext + "@" + label,
		children: [{
			type: "text",
			value: atext + "@" + label
		}]
	};
}
/**
* @param {string} domain
* @returns {boolean}
*/
function isCorrectDomain(domain) {
	const parts = domain.split(".");
	if (parts.length < 2 || parts[parts.length - 1] && (/_/.test(parts[parts.length - 1]) || !/[a-zA-Z\d]/.test(parts[parts.length - 1])) || parts[parts.length - 2] && (/_/.test(parts[parts.length - 2]) || !/[a-zA-Z\d]/.test(parts[parts.length - 2]))) return false;
	return true;
}
/**
* @param {string} url
* @returns {[string, string | undefined]}
*/
function splitUrl(url) {
	const trailExec = /[!"&'),.:;<>?\]}]+$/.exec(url);
	if (!trailExec) return [url, void 0];
	url = url.slice(0, trailExec.index);
	let trail = trailExec[0];
	let closingParenIndex = trail.indexOf(")");
	const openingParens = ccount(url, "(");
	let closingParens = ccount(url, ")");
	while (closingParenIndex !== -1 && openingParens > closingParens) {
		url += trail.slice(0, closingParenIndex + 1);
		trail = trail.slice(closingParenIndex + 1);
		closingParenIndex = trail.indexOf(")");
		closingParens++;
	}
	return [url, trail];
}
/**
* @param {RegExpMatchObject} match
* @param {boolean | null | undefined} [email=false]
* @returns {boolean}
*/
function previous(match, email) {
	const code = match.input.charCodeAt(match.index - 1);
	return (match.index === 0 || unicodeWhitespace(code) || unicodePunctuation(code)) && (!email || code !== 47);
}
//#endregion
//#region ../../node_modules/mdast-util-gfm-footnote/lib/index.js
/**
* @import {
*   CompileContext,
*   Extension as FromMarkdownExtension,
*   Handle as FromMarkdownHandle
* } from 'mdast-util-from-markdown'
* @import {ToMarkdownOptions} from 'mdast-util-gfm-footnote'
* @import {
*   Handle as ToMarkdownHandle,
*   Map,
*   Options as ToMarkdownExtension
* } from 'mdast-util-to-markdown'
* @import {FootnoteDefinition, FootnoteReference} from 'mdast'
*/
footnoteReference.peek = footnoteReferencePeek;
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterFootnoteCallString() {
	this.buffer();
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterFootnoteCall(token) {
	this.enter({
		type: "footnoteReference",
		identifier: "",
		label: ""
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterFootnoteDefinitionLabelString() {
	this.buffer();
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterFootnoteDefinition(token) {
	this.enter({
		type: "footnoteDefinition",
		identifier: "",
		label: "",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitFootnoteCallString(token) {
	const label = this.resume();
	const node = this.stack[this.stack.length - 1];
	node.type;
	node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
	node.label = label;
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitFootnoteCall(token) {
	this.exit(token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitFootnoteDefinitionLabelString(token) {
	const label = this.resume();
	const node = this.stack[this.stack.length - 1];
	node.type;
	node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
	node.label = label;
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitFootnoteDefinition(token) {
	this.exit(token);
}
/** @type {ToMarkdownHandle} */
function footnoteReferencePeek() {
	return "[";
}
/**
* @type {ToMarkdownHandle}
* @param {FootnoteReference} node
*/
function footnoteReference(node, _, state, info) {
	const tracker = state.createTracker(info);
	let value = tracker.move("[^");
	const exit = state.enter("footnoteReference");
	const subexit = state.enter("reference");
	value += tracker.move(state.safe(state.associationId(node), {
		after: "]",
		before: value
	}));
	subexit();
	exit();
	value += tracker.move("]");
	return value;
}
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM footnotes
* in markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown`.
*/
function gfmFootnoteFromMarkdown() {
	return {
		enter: {
			gfmFootnoteCallString: enterFootnoteCallString,
			gfmFootnoteCall: enterFootnoteCall,
			gfmFootnoteDefinitionLabelString: enterFootnoteDefinitionLabelString,
			gfmFootnoteDefinition: enterFootnoteDefinition
		},
		exit: {
			gfmFootnoteCallString: exitFootnoteCallString,
			gfmFootnoteCall: exitFootnoteCall,
			gfmFootnoteDefinitionLabelString: exitFootnoteDefinitionLabelString,
			gfmFootnoteDefinition: exitFootnoteDefinition
		}
	};
}
/**
* Create an extension for `mdast-util-to-markdown` to enable GFM footnotes
* in markdown.
*
* @param {ToMarkdownOptions | null | undefined} [options]
*   Configuration (optional).
* @returns {ToMarkdownExtension}
*   Extension for `mdast-util-to-markdown`.
*/
function gfmFootnoteToMarkdown(options) {
	let firstLineBlank = false;
	if (options && options.firstLineBlank) firstLineBlank = true;
	return {
		handlers: {
			footnoteDefinition,
			footnoteReference
		},
		unsafe: [{
			character: "[",
			inConstruct: [
				"label",
				"phrasing",
				"reference"
			]
		}]
	};
	/**
	* @type {ToMarkdownHandle}
	* @param {FootnoteDefinition} node
	*/
	function footnoteDefinition(node, _, state, info) {
		const tracker = state.createTracker(info);
		let value = tracker.move("[^");
		const exit = state.enter("footnoteDefinition");
		const subexit = state.enter("label");
		value += tracker.move(state.safe(state.associationId(node), {
			before: value,
			after: "]"
		}));
		subexit();
		value += tracker.move("]:");
		if (node.children && node.children.length > 0) {
			tracker.shift(4);
			value += tracker.move((firstLineBlank ? "\n" : " ") + state.indentLines(state.containerFlow(node, tracker.current()), firstLineBlank ? mapAll : mapExceptFirst));
		}
		exit();
		return value;
	}
}
/** @type {Map} */
function mapExceptFirst(line, index, blank) {
	return index === 0 ? line : mapAll(line, index, blank);
}
/** @type {Map} */
function mapAll(line, index, blank) {
	return (blank ? "" : "    ") + line;
}
//#endregion
//#region ../../node_modules/mdast-util-gfm-strikethrough/lib/index.js
/**
* @typedef {import('mdast').Delete} Delete
*
* @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
* @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
* @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
*
* @typedef {import('mdast-util-to-markdown').ConstructName} ConstructName
* @typedef {import('mdast-util-to-markdown').Handle} ToMarkdownHandle
* @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
*/
/**
* List of constructs that occur in phrasing (paragraphs, headings), but cannot
* contain strikethrough.
* So they sort of cancel each other out.
* Note: could use a better name.
*
* Note: keep in sync with: <https://github.com/syntax-tree/mdast-util-to-markdown/blob/8ce8dbf/lib/unsafe.js#L14>
*
* @type {Array<ConstructName>}
*/
var constructsWithoutStrikethrough = [
	"autolink",
	"destinationLiteral",
	"destinationRaw",
	"reference",
	"titleQuote",
	"titleApostrophe"
];
handleDelete.peek = peekDelete;
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM
* strikethrough in markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown` to enable GFM strikethrough.
*/
function gfmStrikethroughFromMarkdown() {
	return {
		canContainEols: ["delete"],
		enter: { strikethrough: enterStrikethrough },
		exit: { strikethrough: exitStrikethrough }
	};
}
/**
* Create an extension for `mdast-util-to-markdown` to enable GFM
* strikethrough in markdown.
*
* @returns {ToMarkdownExtension}
*   Extension for `mdast-util-to-markdown` to enable GFM strikethrough.
*/
function gfmStrikethroughToMarkdown() {
	return {
		unsafe: [{
			character: "~",
			inConstruct: "phrasing",
			notInConstruct: constructsWithoutStrikethrough
		}],
		handlers: { delete: handleDelete }
	};
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterStrikethrough(token) {
	this.enter({
		type: "delete",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitStrikethrough(token) {
	this.exit(token);
}
/**
* @type {ToMarkdownHandle}
* @param {Delete} node
*/
function handleDelete(node, _, state, info) {
	const tracker = state.createTracker(info);
	const exit = state.enter("strikethrough");
	let value = tracker.move("~~");
	value += state.containerPhrasing(node, {
		...tracker.current(),
		before: value,
		after: "~"
	});
	value += tracker.move("~~");
	exit();
	return value;
}
/** @type {ToMarkdownHandle} */
function peekDelete() {
	return "~";
}
//#endregion
//#region ../../node_modules/markdown-table/index.js
/**
* @typedef {Options} MarkdownTableOptions
*   Configuration.
*/
/**
* @typedef Options
*   Configuration.
* @property {boolean | null | undefined} [alignDelimiters=true]
*   Whether to align the delimiters (default: `true`);
*   they are aligned by default:
*
*   ```markdown
*   | Alpha | B     |
*   | ----- | ----- |
*   | C     | Delta |
*   ```
*
*   Pass `false` to make them staggered:
*
*   ```markdown
*   | Alpha | B |
*   | - | - |
*   | C | Delta |
*   ```
* @property {ReadonlyArray<string | null | undefined> | string | null | undefined} [align]
*   How to align columns (default: `''`);
*   one style for all columns or styles for their respective columns;
*   each style is either `'l'` (left), `'r'` (right), or `'c'` (center);
*   other values are treated as `''`, which doesn’t place the colon in the
*   alignment row but does align left;
*   *only the lowercased first character is used, so `Right` is fine.*
* @property {boolean | null | undefined} [delimiterEnd=true]
*   Whether to end each row with the delimiter (default: `true`).
*
*   > 👉 **Note**: please don’t use this: it could create fragile structures
*   > that aren’t understandable to some markdown parsers.
*
*   When `true`, there are ending delimiters:
*
*   ```markdown
*   | Alpha | B     |
*   | ----- | ----- |
*   | C     | Delta |
*   ```
*
*   When `false`, there are no ending delimiters:
*
*   ```markdown
*   | Alpha | B
*   | ----- | -----
*   | C     | Delta
*   ```
* @property {boolean | null | undefined} [delimiterStart=true]
*   Whether to begin each row with the delimiter (default: `true`).
*
*   > 👉 **Note**: please don’t use this: it could create fragile structures
*   > that aren’t understandable to some markdown parsers.
*
*   When `true`, there are starting delimiters:
*
*   ```markdown
*   | Alpha | B     |
*   | ----- | ----- |
*   | C     | Delta |
*   ```
*
*   When `false`, there are no starting delimiters:
*
*   ```markdown
*   Alpha | B     |
*   ----- | ----- |
*   C     | Delta |
*   ```
* @property {boolean | null | undefined} [padding=true]
*   Whether to add a space of padding between delimiters and cells
*   (default: `true`).
*
*   When `true`, there is padding:
*
*   ```markdown
*   | Alpha | B     |
*   | ----- | ----- |
*   | C     | Delta |
*   ```
*
*   When `false`, there is no padding:
*
*   ```markdown
*   |Alpha|B    |
*   |-----|-----|
*   |C    |Delta|
*   ```
* @property {((value: string) => number) | null | undefined} [stringLength]
*   Function to detect the length of table cell content (optional);
*   this is used when aligning the delimiters (`|`) between table cells;
*   full-width characters and emoji mess up delimiter alignment when viewing
*   the markdown source;
*   to fix this, you can pass this function,
*   which receives the cell content and returns its “visible” size;
*   note that what is and isn’t visible depends on where the text is displayed.
*
*   Without such a function, the following:
*
*   ```js
*   markdownTable([
*     ['Alpha', 'Bravo'],
*     ['中文', 'Charlie'],
*     ['👩‍❤️‍👩', 'Delta']
*   ])
*   ```
*
*   Yields:
*
*   ```markdown
*   | Alpha | Bravo |
*   | - | - |
*   | 中文 | Charlie |
*   | 👩‍❤️‍👩 | Delta |
*   ```
*
*   With [`string-width`](https://github.com/sindresorhus/string-width):
*
*   ```js
*   import stringWidth from 'string-width'
*
*   markdownTable(
*     [
*       ['Alpha', 'Bravo'],
*       ['中文', 'Charlie'],
*       ['👩‍❤️‍👩', 'Delta']
*     ],
*     {stringLength: stringWidth}
*   )
*   ```
*
*   Yields:
*
*   ```markdown
*   | Alpha | Bravo   |
*   | ----- | ------- |
*   | 中文  | Charlie |
*   | 👩‍❤️‍👩    | Delta   |
*   ```
*/
/**
* @param {string} value
*   Cell value.
* @returns {number}
*   Cell size.
*/
function defaultStringLength(value) {
	return value.length;
}
/**
* Generate a markdown
* ([GFM](https://docs.github.com/en/github/writing-on-github/working-with-advanced-formatting/organizing-information-with-tables))
* table.
*
* @param {ReadonlyArray<ReadonlyArray<string | null | undefined>>} table
*   Table data (matrix of strings).
* @param {Readonly<Options> | null | undefined} [options]
*   Configuration (optional).
* @returns {string}
*   Result.
*/
function markdownTable(table, options) {
	const settings = options || {};
	const align = (settings.align || []).concat();
	const stringLength = settings.stringLength || defaultStringLength;
	/** @type {Array<number>} Character codes as symbols for alignment per column. */
	const alignments = [];
	/** @type {Array<Array<string>>} Cells per row. */
	const cellMatrix = [];
	/** @type {Array<Array<number>>} Sizes of each cell per row. */
	const sizeMatrix = [];
	/** @type {Array<number>} */
	const longestCellByColumn = [];
	let mostCellsPerRow = 0;
	let rowIndex = -1;
	while (++rowIndex < table.length) {
		/** @type {Array<string>} */
		const row = [];
		/** @type {Array<number>} */
		const sizes = [];
		let columnIndex = -1;
		if (table[rowIndex].length > mostCellsPerRow) mostCellsPerRow = table[rowIndex].length;
		while (++columnIndex < table[rowIndex].length) {
			const cell = serialize(table[rowIndex][columnIndex]);
			if (settings.alignDelimiters !== false) {
				const size = stringLength(cell);
				sizes[columnIndex] = size;
				if (longestCellByColumn[columnIndex] === void 0 || size > longestCellByColumn[columnIndex]) longestCellByColumn[columnIndex] = size;
			}
			row.push(cell);
		}
		cellMatrix[rowIndex] = row;
		sizeMatrix[rowIndex] = sizes;
	}
	let columnIndex = -1;
	if (typeof align === "object" && "length" in align) while (++columnIndex < mostCellsPerRow) alignments[columnIndex] = toAlignment(align[columnIndex]);
	else {
		const code = toAlignment(align);
		while (++columnIndex < mostCellsPerRow) alignments[columnIndex] = code;
	}
	columnIndex = -1;
	/** @type {Array<string>} */
	const row = [];
	/** @type {Array<number>} */
	const sizes = [];
	while (++columnIndex < mostCellsPerRow) {
		const code = alignments[columnIndex];
		let before = "";
		let after = "";
		if (code === 99) {
			before = ":";
			after = ":";
		} else if (code === 108) before = ":";
		else if (code === 114) after = ":";
		let size = settings.alignDelimiters === false ? 1 : Math.max(1, longestCellByColumn[columnIndex] - before.length - after.length);
		const cell = before + "-".repeat(size) + after;
		if (settings.alignDelimiters !== false) {
			size = before.length + size + after.length;
			if (size > longestCellByColumn[columnIndex]) longestCellByColumn[columnIndex] = size;
			sizes[columnIndex] = size;
		}
		row[columnIndex] = cell;
	}
	cellMatrix.splice(1, 0, row);
	sizeMatrix.splice(1, 0, sizes);
	rowIndex = -1;
	/** @type {Array<string>} */
	const lines = [];
	while (++rowIndex < cellMatrix.length) {
		const row = cellMatrix[rowIndex];
		const sizes = sizeMatrix[rowIndex];
		columnIndex = -1;
		/** @type {Array<string>} */
		const line = [];
		while (++columnIndex < mostCellsPerRow) {
			const cell = row[columnIndex] || "";
			let before = "";
			let after = "";
			if (settings.alignDelimiters !== false) {
				const size = longestCellByColumn[columnIndex] - (sizes[columnIndex] || 0);
				const code = alignments[columnIndex];
				if (code === 114) before = " ".repeat(size);
				else if (code === 99) {
					if (size % 2) {
						before = " ".repeat(size / 2 + .5);
						after = " ".repeat(size / 2 - .5);
					} else {
						before = " ".repeat(size / 2);
						after = before;
					}
				} else after = " ".repeat(size);
			}
			if (settings.delimiterStart !== false && !columnIndex) line.push("|");
			if (settings.padding !== false && !(settings.alignDelimiters === false && cell === "") && (settings.delimiterStart !== false || columnIndex)) line.push(" ");
			if (settings.alignDelimiters !== false) line.push(before);
			line.push(cell);
			if (settings.alignDelimiters !== false) line.push(after);
			if (settings.padding !== false) line.push(" ");
			if (settings.delimiterEnd !== false || columnIndex !== mostCellsPerRow - 1) line.push("|");
		}
		lines.push(settings.delimiterEnd === false ? line.join("").replace(/ +$/, "") : line.join(""));
	}
	return lines.join("\n");
}
/**
* @param {string | null | undefined} [value]
*   Value to serialize.
* @returns {string}
*   Result.
*/
function serialize(value) {
	return value === null || value === void 0 ? "" : String(value);
}
/**
* @param {string | null | undefined} value
*   Value.
* @returns {number}
*   Alignment.
*/
function toAlignment(value) {
	const code = typeof value === "string" ? value.codePointAt(0) : 0;
	return code === 67 || code === 99 ? 99 : code === 76 || code === 108 ? 108 : code === 82 || code === 114 ? 114 : 0;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/blockquote.js
/**
* @import {Blockquote, Parents} from 'mdast'
* @import {Info, Map, State} from 'mdast-util-to-markdown'
*/
/**
* @param {Blockquote} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function blockquote(node, _, state, info) {
	const exit = state.enter("blockquote");
	const tracker = state.createTracker(info);
	tracker.move("> ");
	tracker.shift(2);
	const value = state.indentLines(state.containerFlow(node, tracker.current()), map$1);
	exit();
	return value;
}
/** @type {Map} */
function map$1(line, _, blank) {
	return ">" + (blank ? "" : " ") + line;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/pattern-in-scope.js
/**
* @import {ConstructName, Unsafe} from 'mdast-util-to-markdown'
*/
/**
* @param {Array<ConstructName>} stack
* @param {Unsafe} pattern
* @returns {boolean}
*/
function patternInScope(stack, pattern) {
	return listInScope(stack, pattern.inConstruct, true) && !listInScope(stack, pattern.notInConstruct, false);
}
/**
* @param {Array<ConstructName>} stack
* @param {Unsafe['inConstruct']} list
* @param {boolean} none
* @returns {boolean}
*/
function listInScope(stack, list, none) {
	if (typeof list === "string") list = [list];
	if (!list || list.length === 0) return none;
	let index = -1;
	while (++index < list.length) if (stack.includes(list[index])) return true;
	return false;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/break.js
/**
* @import {Break, Parents} from 'mdast'
* @import {Info, State} from 'mdast-util-to-markdown'
*/
/**
* @param {Break} _
* @param {Parents | undefined} _1
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function hardBreak(_, _1, state, info) {
	let index = -1;
	while (++index < state.unsafe.length) if (state.unsafe[index].character === "\n" && patternInScope(state.stack, state.unsafe[index])) return /[ \t]/.test(info.before) ? "" : " ";
	return "\\\n";
}
//#endregion
//#region ../../node_modules/longest-streak/index.js
/**
* Get the count of the longest repeating streak of `substring` in `value`.
*
* @param {string} value
*   Content to search in.
* @param {string} substring
*   Substring to look for, typically one character.
* @returns {number}
*   Count of most frequent adjacent `substring`s in `value`.
*/
function longestStreak(value, substring) {
	const source = String(value);
	let index = source.indexOf(substring);
	let expected = index;
	let count = 0;
	let max = 0;
	if (typeof substring !== "string") throw new TypeError("Expected substring");
	while (index !== -1) {
		if (index === expected) {
			if (++count > max) max = count;
		} else count = 1;
		expected = index + substring.length;
		index = source.indexOf(substring, expected);
	}
	return max;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/format-code-as-indented.js
/**
* @import {State} from 'mdast-util-to-markdown'
* @import {Code} from 'mdast'
*/
/**
* @param {Code} node
* @param {State} state
* @returns {boolean}
*/
function formatCodeAsIndented(node, state) {
	return Boolean(state.options.fences === false && node.value && !node.lang && /[^ \r\n]/.test(node.value) && !/^[\t ]*(?:[\r\n]|$)|(?:^|[\r\n])[\t ]*$/.test(node.value));
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-fence.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['fence'], null | undefined>}
*/
function checkFence(state) {
	const marker = state.options.fence || "`";
	if (marker !== "`" && marker !== "~") throw new Error("Cannot serialize code with `" + marker + "` for `options.fence`, expected `` ` `` or `~`");
	return marker;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/code.js
/**
* @import {Info, Map, State} from 'mdast-util-to-markdown'
* @import {Code, Parents} from 'mdast'
*/
/**
* @param {Code} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function code$1(node, _, state, info) {
	const marker = checkFence(state);
	const raw = node.value || "";
	const suffix = marker === "`" ? "GraveAccent" : "Tilde";
	if (formatCodeAsIndented(node, state)) {
		const exit = state.enter("codeIndented");
		const value = state.indentLines(raw, map);
		exit();
		return value;
	}
	const tracker = state.createTracker(info);
	const sequence = marker.repeat(Math.max(longestStreak(raw, marker) + 1, 3));
	const exit = state.enter("codeFenced");
	let value = tracker.move(sequence);
	if (node.lang) {
		const subexit = state.enter(`codeFencedLang${suffix}`);
		value += tracker.move(state.safe(node.lang, {
			before: value,
			after: " ",
			encode: ["`"],
			...tracker.current()
		}));
		subexit();
	}
	if (node.lang && node.meta) {
		const subexit = state.enter(`codeFencedMeta${suffix}`);
		value += tracker.move(" ");
		value += tracker.move(state.safe(node.meta, {
			before: value,
			after: "\n",
			encode: ["`"],
			...tracker.current()
		}));
		subexit();
	}
	value += tracker.move("\n");
	if (raw) value += tracker.move(raw + "\n");
	value += tracker.move(sequence);
	exit();
	return value;
}
/** @type {Map} */
function map(line, _, blank) {
	return (blank ? "" : "    ") + line;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-quote.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['quote'], null | undefined>}
*/
function checkQuote(state) {
	const marker = state.options.quote || "\"";
	if (marker !== "\"" && marker !== "'") throw new Error("Cannot serialize title with `" + marker + "` for `options.quote`, expected `\"`, or `'`");
	return marker;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/definition.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Definition, Parents} from 'mdast'
*/
/**
* @param {Definition} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function definition(node, _, state, info) {
	const quote = checkQuote(state);
	const suffix = quote === "\"" ? "Quote" : "Apostrophe";
	const exit = state.enter("definition");
	let subexit = state.enter("label");
	const tracker = state.createTracker(info);
	let value = tracker.move("[");
	value += tracker.move(state.safe(state.associationId(node), {
		before: value,
		after: "]",
		...tracker.current()
	}));
	value += tracker.move("]: ");
	subexit();
	if (!node.url || /[\0- \u007F]/.test(node.url)) {
		subexit = state.enter("destinationLiteral");
		value += tracker.move("<");
		value += tracker.move(state.safe(node.url, {
			before: value,
			after: ">",
			...tracker.current()
		}));
		value += tracker.move(">");
	} else {
		subexit = state.enter("destinationRaw");
		value += tracker.move(state.safe(node.url, {
			before: value,
			after: node.title ? " " : "\n",
			...tracker.current()
		}));
	}
	subexit();
	if (node.title) {
		subexit = state.enter(`title${suffix}`);
		value += tracker.move(" " + quote);
		value += tracker.move(state.safe(node.title, {
			before: value,
			after: quote,
			...tracker.current()
		}));
		value += tracker.move(quote);
		subexit();
	}
	exit();
	return value;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-emphasis.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['emphasis'], null | undefined>}
*/
function checkEmphasis(state) {
	const marker = state.options.emphasis || "*";
	if (marker !== "*" && marker !== "_") throw new Error("Cannot serialize emphasis with `" + marker + "` for `options.emphasis`, expected `*`, or `_`");
	return marker;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/encode-character-reference.js
/**
* Encode a code point as a character reference.
*
* @param {number} code
*   Code point to encode.
* @returns {string}
*   Encoded character reference.
*/
function encodeCharacterReference(code) {
	return "&#x" + code.toString(16).toUpperCase() + ";";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/encode-info.js
/**
* @import {EncodeSides} from '../types.js'
*/
/**
* Check whether to encode (as a character reference) the characters
* surrounding an attention run.
*
* Which characters are around an attention run influence whether it works or
* not.
*
* See <https://github.com/orgs/syntax-tree/discussions/60> for more info.
* See this markdown in a particular renderer to see what works:
*
* ```markdown
* |                         | A (letter inside) | B (punctuation inside) | C (whitespace inside) | D (nothing inside) |
* | ----------------------- | ----------------- | ---------------------- | --------------------- | ------------------ |
* | 1 (letter outside)      | x*y*z             | x*.*z                  | x* *z                 | x**z               |
* | 2 (punctuation outside) | .*y*.             | .*.*.                  | .* *.                 | .**.               |
* | 3 (whitespace outside)  | x *y* z           | x *.* z                | x * * z               | x ** z             |
* | 4 (nothing outside)     | *x*               | *.*                    | * *                   | **                 |
* ```
*
* @param {number} outside
*   Code point on the outer side of the run.
* @param {number} inside
*   Code point on the inner side of the run.
* @param {'*' | '_'} marker
*   Marker of the run.
*   Underscores are handled more strictly (they form less often) than
*   asterisks.
* @returns {EncodeSides}
*   Whether to encode characters.
*/
function encodeInfo(outside, inside, marker) {
	const outsideKind = classifyCharacter(outside);
	const insideKind = classifyCharacter(inside);
	if (outsideKind === void 0) return insideKind === void 0 ? marker === "_" ? {
		inside: true,
		outside: true
	} : {
		inside: false,
		outside: false
	} : insideKind === 1 ? {
		inside: true,
		outside: true
	} : {
		inside: false,
		outside: true
	};
	if (outsideKind === 1) return insideKind === void 0 ? {
		inside: false,
		outside: false
	} : insideKind === 1 ? {
		inside: true,
		outside: true
	} : {
		inside: false,
		outside: false
	};
	return insideKind === void 0 ? {
		inside: false,
		outside: false
	} : insideKind === 1 ? {
		inside: true,
		outside: false
	} : {
		inside: false,
		outside: false
	};
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/emphasis.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Emphasis, Parents} from 'mdast'
*/
emphasis.peek = emphasisPeek;
/**
* @param {Emphasis} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function emphasis(node, _, state, info) {
	const marker = checkEmphasis(state);
	const exit = state.enter("emphasis");
	const tracker = state.createTracker(info);
	const before = tracker.move(marker);
	let between = tracker.move(state.containerPhrasing(node, {
		after: marker,
		before,
		...tracker.current()
	}));
	const betweenHead = between.charCodeAt(0);
	const open = encodeInfo(info.before.charCodeAt(info.before.length - 1), betweenHead, marker);
	if (open.inside) between = encodeCharacterReference(betweenHead) + between.slice(1);
	const betweenTail = between.charCodeAt(between.length - 1);
	const close = encodeInfo(info.after.charCodeAt(0), betweenTail, marker);
	if (close.inside) between = between.slice(0, -1) + encodeCharacterReference(betweenTail);
	const after = tracker.move(marker);
	exit();
	state.attentionEncodeSurroundingInfo = {
		after: close.outside,
		before: open.outside
	};
	return before + between + after;
}
/**
* @param {Emphasis} _
* @param {Parents | undefined} _1
* @param {State} state
* @returns {string}
*/
function emphasisPeek(_, _1, state) {
	return state.options.emphasis || "*";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/format-heading-as-setext.js
/**
* @import {State} from 'mdast-util-to-markdown'
* @import {Heading} from 'mdast'
*/
/**
* @param {Heading} node
* @param {State} state
* @returns {boolean}
*/
function formatHeadingAsSetext(node, state) {
	let literalWithBreak = false;
	visit(node, function(node) {
		if ("value" in node && /\r?\n|\r/.test(node.value) || node.type === "break") {
			literalWithBreak = true;
			return false;
		}
	});
	return Boolean((!node.depth || node.depth < 3) && toString$1(node) && (state.options.setext || literalWithBreak));
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/heading.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Heading, Parents} from 'mdast'
*/
/**
* @param {Heading} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function heading(node, _, state, info) {
	const rank = Math.max(Math.min(6, node.depth || 1), 1);
	const tracker = state.createTracker(info);
	if (formatHeadingAsSetext(node, state)) {
		const exit = state.enter("headingSetext");
		const subexit = state.enter("phrasing");
		const value = state.containerPhrasing(node, {
			...tracker.current(),
			before: "\n",
			after: "\n"
		});
		subexit();
		exit();
		return value + "\n" + (rank === 1 ? "=" : "-").repeat(value.length - (Math.max(value.lastIndexOf("\r"), value.lastIndexOf("\n")) + 1));
	}
	const sequence = "#".repeat(rank);
	const exit = state.enter("headingAtx");
	const subexit = state.enter("phrasing");
	tracker.move(sequence + " ");
	let value = state.containerPhrasing(node, {
		before: "# ",
		after: "\n",
		...tracker.current()
	});
	if (/^[\t ]/.test(value)) value = encodeCharacterReference(value.charCodeAt(0)) + value.slice(1);
	value = value ? sequence + " " + value : sequence;
	if (state.options.closeAtx) value += " " + sequence;
	subexit();
	exit();
	return value;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/html.js
/**
* @import {Html} from 'mdast'
*/
html.peek = htmlPeek;
/**
* @param {Html} node
* @returns {string}
*/
function html(node) {
	return node.value || "";
}
/**
* @returns {string}
*/
function htmlPeek() {
	return "<";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/image.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Image, Parents} from 'mdast'
*/
image.peek = imagePeek;
/**
* @param {Image} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function image(node, _, state, info) {
	const quote = checkQuote(state);
	const suffix = quote === "\"" ? "Quote" : "Apostrophe";
	const exit = state.enter("image");
	let subexit = state.enter("label");
	const tracker = state.createTracker(info);
	let value = tracker.move("![");
	value += tracker.move(state.safe(node.alt, {
		before: value,
		after: "]",
		...tracker.current()
	}));
	value += tracker.move("](");
	subexit();
	if (!node.url && node.title || /[\0- \u007F]/.test(node.url)) {
		subexit = state.enter("destinationLiteral");
		value += tracker.move("<");
		value += tracker.move(state.safe(node.url, {
			before: value,
			after: ">",
			...tracker.current()
		}));
		value += tracker.move(">");
	} else {
		subexit = state.enter("destinationRaw");
		value += tracker.move(state.safe(node.url, {
			before: value,
			after: node.title ? " " : ")",
			...tracker.current()
		}));
	}
	subexit();
	if (node.title) {
		subexit = state.enter(`title${suffix}`);
		value += tracker.move(" " + quote);
		value += tracker.move(state.safe(node.title, {
			before: value,
			after: quote,
			...tracker.current()
		}));
		value += tracker.move(quote);
		subexit();
	}
	value += tracker.move(")");
	exit();
	return value;
}
/**
* @returns {string}
*/
function imagePeek() {
	return "!";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/image-reference.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {ImageReference, Parents} from 'mdast'
*/
imageReference.peek = imageReferencePeek;
/**
* @param {ImageReference} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function imageReference(node, _, state, info) {
	const type = node.referenceType;
	const exit = state.enter("imageReference");
	let subexit = state.enter("label");
	const tracker = state.createTracker(info);
	let value = tracker.move("![");
	const alt = state.safe(node.alt, {
		before: value,
		after: "]",
		...tracker.current()
	});
	value += tracker.move(alt + "][");
	subexit();
	const stack = state.stack;
	state.stack = [];
	subexit = state.enter("reference");
	const reference = state.safe(state.associationId(node), {
		before: value,
		after: "]",
		...tracker.current()
	});
	subexit();
	state.stack = stack;
	exit();
	if (type === "full" || !alt || alt !== reference) value += tracker.move(reference + "]");
	else if (type === "shortcut") value = value.slice(0, -1);
	else value += tracker.move("]");
	return value;
}
/**
* @returns {string}
*/
function imageReferencePeek() {
	return "!";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/inline-code.js
/**
* @import {State} from 'mdast-util-to-markdown'
* @import {InlineCode, Parents} from 'mdast'
*/
inlineCode.peek = inlineCodePeek;
/**
* @param {InlineCode} node
* @param {Parents | undefined} _
* @param {State} state
* @returns {string}
*/
function inlineCode(node, _, state) {
	let value = node.value || "";
	let sequence = "`";
	let index = -1;
	while (new RegExp("(^|[^`])" + sequence + "([^`]|$)").test(value)) sequence += "`";
	if (/[^ \r\n]/.test(value) && (/^[ \r\n]/.test(value) && /[ \r\n]$/.test(value) || /^`|`$/.test(value))) value = " " + value + " ";
	while (++index < state.unsafe.length) {
		const pattern = state.unsafe[index];
		const expression = state.compilePattern(pattern);
		/** @type {RegExpExecArray | null} */
		let match;
		if (!pattern.atBreak) continue;
		while (match = expression.exec(value)) {
			let position = match.index;
			if (value.charCodeAt(position) === 10 && value.charCodeAt(position - 1) === 13) position--;
			value = value.slice(0, position) + " " + value.slice(match.index + 1);
		}
	}
	return sequence + value + sequence;
}
/**
* @returns {string}
*/
function inlineCodePeek() {
	return "`";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/format-link-as-autolink.js
/**
* @import {State} from 'mdast-util-to-markdown'
* @import {Link} from 'mdast'
*/
/**
* @param {Link} node
* @param {State} state
* @returns {boolean}
*/
function formatLinkAsAutolink(node, state) {
	const raw = toString$1(node);
	return Boolean(!state.options.resourceLink && node.url && !node.title && node.children && node.children.length === 1 && node.children[0].type === "text" && (raw === node.url || "mailto:" + raw === node.url) && /^[a-z][a-z+.-]+:/i.test(node.url) && !/[\0- <>\u007F]/.test(node.url));
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/link.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Link, Parents} from 'mdast'
* @import {Exit} from '../types.js'
*/
link.peek = linkPeek;
/**
* @param {Link} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function link(node, _, state, info) {
	const quote = checkQuote(state);
	const suffix = quote === "\"" ? "Quote" : "Apostrophe";
	const tracker = state.createTracker(info);
	/** @type {Exit} */
	let exit;
	/** @type {Exit} */
	let subexit;
	if (formatLinkAsAutolink(node, state)) {
		const stack = state.stack;
		state.stack = [];
		exit = state.enter("autolink");
		let value = tracker.move("<");
		value += tracker.move(state.containerPhrasing(node, {
			before: value,
			after: ">",
			...tracker.current()
		}));
		value += tracker.move(">");
		exit();
		state.stack = stack;
		return value;
	}
	exit = state.enter("link");
	subexit = state.enter("label");
	let value = tracker.move("[");
	value += tracker.move(state.containerPhrasing(node, {
		before: value,
		after: "](",
		...tracker.current()
	}));
	value += tracker.move("](");
	subexit();
	if (!node.url && node.title || /[\0- \u007F]/.test(node.url)) {
		subexit = state.enter("destinationLiteral");
		value += tracker.move("<");
		value += tracker.move(state.safe(node.url, {
			before: value,
			after: ">",
			...tracker.current()
		}));
		value += tracker.move(">");
	} else {
		subexit = state.enter("destinationRaw");
		value += tracker.move(state.safe(node.url, {
			before: value,
			after: node.title ? " " : ")",
			...tracker.current()
		}));
	}
	subexit();
	if (node.title) {
		subexit = state.enter(`title${suffix}`);
		value += tracker.move(" " + quote);
		value += tracker.move(state.safe(node.title, {
			before: value,
			after: quote,
			...tracker.current()
		}));
		value += tracker.move(quote);
		subexit();
	}
	value += tracker.move(")");
	exit();
	return value;
}
/**
* @param {Link} node
* @param {Parents | undefined} _
* @param {State} state
* @returns {string}
*/
function linkPeek(node, _, state) {
	return formatLinkAsAutolink(node, state) ? "<" : "[";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/link-reference.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {LinkReference, Parents} from 'mdast'
*/
linkReference.peek = linkReferencePeek;
/**
* @param {LinkReference} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function linkReference(node, _, state, info) {
	const type = node.referenceType;
	const exit = state.enter("linkReference");
	let subexit = state.enter("label");
	const tracker = state.createTracker(info);
	let value = tracker.move("[");
	const text = state.containerPhrasing(node, {
		before: value,
		after: "]",
		...tracker.current()
	});
	value += tracker.move(text + "][");
	subexit();
	const stack = state.stack;
	state.stack = [];
	subexit = state.enter("reference");
	const reference = state.safe(state.associationId(node), {
		before: value,
		after: "]",
		...tracker.current()
	});
	subexit();
	state.stack = stack;
	exit();
	if (type === "full" || !text || text !== reference) value += tracker.move(reference + "]");
	else if (type === "shortcut") value = value.slice(0, -1);
	else value += tracker.move("]");
	return value;
}
/**
* @returns {string}
*/
function linkReferencePeek() {
	return "[";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-bullet.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['bullet'], null | undefined>}
*/
function checkBullet(state) {
	const marker = state.options.bullet || "*";
	if (marker !== "*" && marker !== "+" && marker !== "-") throw new Error("Cannot serialize items with `" + marker + "` for `options.bullet`, expected `*`, `+`, or `-`");
	return marker;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-bullet-other.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['bullet'], null | undefined>}
*/
function checkBulletOther(state) {
	const bullet = checkBullet(state);
	const bulletOther = state.options.bulletOther;
	if (!bulletOther) return bullet === "*" ? "-" : "*";
	if (bulletOther !== "*" && bulletOther !== "+" && bulletOther !== "-") throw new Error("Cannot serialize items with `" + bulletOther + "` for `options.bulletOther`, expected `*`, `+`, or `-`");
	if (bulletOther === bullet) throw new Error("Expected `bullet` (`" + bullet + "`) and `bulletOther` (`" + bulletOther + "`) to be different");
	return bulletOther;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-bullet-ordered.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['bulletOrdered'], null | undefined>}
*/
function checkBulletOrdered(state) {
	const marker = state.options.bulletOrdered || ".";
	if (marker !== "." && marker !== ")") throw new Error("Cannot serialize items with `" + marker + "` for `options.bulletOrdered`, expected `.` or `)`");
	return marker;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-rule.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['rule'], null | undefined>}
*/
function checkRule(state) {
	const marker = state.options.rule || "*";
	if (marker !== "*" && marker !== "-" && marker !== "_") throw new Error("Cannot serialize rules with `" + marker + "` for `options.rule`, expected `*`, `-`, or `_`");
	return marker;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/list.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {List, Parents} from 'mdast'
*/
/**
* @param {List} node
* @param {Parents | undefined} parent
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function list(node, parent, state, info) {
	const exit = state.enter("list");
	const bulletCurrent = state.bulletCurrent;
	/** @type {string} */
	let bullet = node.ordered ? checkBulletOrdered(state) : checkBullet(state);
	/** @type {string} */
	const bulletOther = node.ordered ? bullet === "." ? ")" : "." : checkBulletOther(state);
	let useDifferentMarker = parent && state.bulletLastUsed ? bullet === state.bulletLastUsed : false;
	if (!node.ordered) {
		const firstListItem = node.children ? node.children[0] : void 0;
		if ((bullet === "*" || bullet === "-") && firstListItem && (!firstListItem.children || !firstListItem.children[0]) && state.stack[state.stack.length - 1] === "list" && state.stack[state.stack.length - 2] === "listItem" && state.stack[state.stack.length - 3] === "list" && state.stack[state.stack.length - 4] === "listItem" && state.indexStack[state.indexStack.length - 1] === 0 && state.indexStack[state.indexStack.length - 2] === 0 && state.indexStack[state.indexStack.length - 3] === 0) useDifferentMarker = true;
		if (checkRule(state) === bullet && firstListItem) {
			let index = -1;
			while (++index < node.children.length) {
				const item = node.children[index];
				if (item && item.type === "listItem" && item.children && item.children[0] && item.children[0].type === "thematicBreak") {
					useDifferentMarker = true;
					break;
				}
			}
		}
	}
	if (useDifferentMarker) bullet = bulletOther;
	state.bulletCurrent = bullet;
	const value = state.containerFlow(node, info);
	state.bulletLastUsed = bullet;
	state.bulletCurrent = bulletCurrent;
	exit();
	return value;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-list-item-indent.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['listItemIndent'], null | undefined>}
*/
function checkListItemIndent(state) {
	const style = state.options.listItemIndent || "one";
	if (style !== "tab" && style !== "one" && style !== "mixed") throw new Error("Cannot serialize items with `" + style + "` for `options.listItemIndent`, expected `tab`, `one`, or `mixed`");
	return style;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/list-item.js
/**
* @import {Info, Map, State} from 'mdast-util-to-markdown'
* @import {ListItem, Parents} from 'mdast'
*/
/**
* @param {ListItem} node
* @param {Parents | undefined} parent
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function listItem(node, parent, state, info) {
	const listItemIndent = checkListItemIndent(state);
	let bullet = state.bulletCurrent || checkBullet(state);
	if (parent && parent.type === "list" && parent.ordered) bullet = (typeof parent.start === "number" && parent.start > -1 ? parent.start : 1) + (state.options.incrementListMarker === false ? 0 : parent.children.indexOf(node)) + bullet;
	let size = bullet.length + 1;
	if (listItemIndent === "tab" || listItemIndent === "mixed" && (parent && parent.type === "list" && parent.spread || node.spread)) size = Math.ceil(size / 4) * 4;
	const tracker = state.createTracker(info);
	tracker.move(bullet + " ".repeat(size - bullet.length));
	tracker.shift(size);
	const exit = state.enter("listItem");
	const value = state.indentLines(state.containerFlow(node, tracker.current()), map);
	exit();
	return value;
	/** @type {Map} */
	function map(line, index, blank) {
		if (index) return (blank ? "" : " ".repeat(size)) + line;
		return (blank ? bullet : bullet + " ".repeat(size - bullet.length)) + line;
	}
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/paragraph.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Paragraph, Parents} from 'mdast'
*/
/**
* @param {Paragraph} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function paragraph(node, _, state, info) {
	const exit = state.enter("paragraph");
	const subexit = state.enter("phrasing");
	const value = state.containerPhrasing(node, info);
	subexit();
	exit();
	return value;
}
//#endregion
//#region ../../node_modules/mdast-util-phrasing/lib/index.js
/**
* @typedef {import('mdast').Html} Html
* @typedef {import('mdast').PhrasingContent} PhrasingContent
*/
/**
* Check if the given value is *phrasing content*.
*
* > 👉 **Note**: Excludes `html`, which can be both phrasing or flow.
*
* @param node
*   Thing to check, typically `Node`.
* @returns
*   Whether `value` is phrasing content.
*/
var phrasing = convert([
	"break",
	"delete",
	"emphasis",
	"footnote",
	"footnoteReference",
	"image",
	"imageReference",
	"inlineCode",
	"inlineMath",
	"link",
	"linkReference",
	"mdxJsxTextElement",
	"mdxTextExpression",
	"strong",
	"text",
	"textDirective"
]);
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/root.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Parents, Root} from 'mdast'
*/
/**
* @param {Root} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function root(node, _, state, info) {
	return (node.children.some(function(d) {
		return phrasing(d);
	}) ? state.containerPhrasing : state.containerFlow).call(state, node, info);
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-strong.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['strong'], null | undefined>}
*/
function checkStrong(state) {
	const marker = state.options.strong || "*";
	if (marker !== "*" && marker !== "_") throw new Error("Cannot serialize strong with `" + marker + "` for `options.strong`, expected `*`, or `_`");
	return marker;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/strong.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Parents, Strong} from 'mdast'
*/
strong.peek = strongPeek;
/**
* @param {Strong} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function strong(node, _, state, info) {
	const marker = checkStrong(state);
	const exit = state.enter("strong");
	const tracker = state.createTracker(info);
	const before = tracker.move(marker + marker);
	let between = tracker.move(state.containerPhrasing(node, {
		after: marker,
		before,
		...tracker.current()
	}));
	const betweenHead = between.charCodeAt(0);
	const open = encodeInfo(info.before.charCodeAt(info.before.length - 1), betweenHead, marker);
	if (open.inside) between = encodeCharacterReference(betweenHead) + between.slice(1);
	const betweenTail = between.charCodeAt(between.length - 1);
	const close = encodeInfo(info.after.charCodeAt(0), betweenTail, marker);
	if (close.inside) between = between.slice(0, -1) + encodeCharacterReference(betweenTail);
	const after = tracker.move(marker + marker);
	exit();
	state.attentionEncodeSurroundingInfo = {
		after: close.outside,
		before: open.outside
	};
	return before + between + after;
}
/**
* @param {Strong} _
* @param {Parents | undefined} _1
* @param {State} state
* @returns {string}
*/
function strongPeek(_, _1, state) {
	return state.options.strong || "*";
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/text.js
/**
* @import {Info, State} from 'mdast-util-to-markdown'
* @import {Parents, Text} from 'mdast'
*/
/**
* @param {Text} node
* @param {Parents | undefined} _
* @param {State} state
* @param {Info} info
* @returns {string}
*/
function text$1(node, _, state, info) {
	return state.safe(node.value, info);
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/util/check-rule-repetition.js
/**
* @import {Options, State} from 'mdast-util-to-markdown'
*/
/**
* @param {State} state
* @returns {Exclude<Options['ruleRepetition'], null | undefined>}
*/
function checkRuleRepetition(state) {
	const repetition = state.options.ruleRepetition || 3;
	if (repetition < 3) throw new Error("Cannot serialize rules with repetition `" + repetition + "` for `options.ruleRepetition`, expected `3` or more");
	return repetition;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/thematic-break.js
/**
* @import {State} from 'mdast-util-to-markdown'
* @import {Parents, ThematicBreak} from 'mdast'
*/
/**
* @param {ThematicBreak} _
* @param {Parents | undefined} _1
* @param {State} state
* @returns {string}
*/
function thematicBreak(_, _1, state) {
	const value = (checkRule(state) + (state.options.ruleSpaces ? " " : "")).repeat(checkRuleRepetition(state));
	return state.options.ruleSpaces ? value.slice(0, -1) : value;
}
//#endregion
//#region ../../node_modules/mdast-util-to-markdown/lib/handle/index.js
/**
* Default (CommonMark) handlers.
*/
var handle = {
	blockquote,
	break: hardBreak,
	code: code$1,
	definition,
	emphasis,
	hardBreak,
	heading,
	html,
	image,
	imageReference,
	inlineCode,
	link,
	linkReference,
	list,
	listItem,
	paragraph,
	root,
	strong,
	text: text$1,
	thematicBreak
};
//#endregion
//#region ../../node_modules/mdast-util-gfm-table/lib/index.js
/**
* @typedef {import('mdast').InlineCode} InlineCode
* @typedef {import('mdast').Table} Table
* @typedef {import('mdast').TableCell} TableCell
* @typedef {import('mdast').TableRow} TableRow
*
* @typedef {import('markdown-table').Options} MarkdownTableOptions
*
* @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
* @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
* @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
*
* @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
* @typedef {import('mdast-util-to-markdown').Handle} ToMarkdownHandle
* @typedef {import('mdast-util-to-markdown').State} State
* @typedef {import('mdast-util-to-markdown').Info} Info
*/
/**
* @typedef Options
*   Configuration.
* @property {boolean | null | undefined} [tableCellPadding=true]
*   Whether to add a space of padding between delimiters and cells (default:
*   `true`).
* @property {boolean | null | undefined} [tablePipeAlign=true]
*   Whether to align the delimiters (default: `true`).
* @property {MarkdownTableOptions['stringLength'] | null | undefined} [stringLength]
*   Function to detect the length of table cell content, used when aligning
*   the delimiters between cells (optional).
*/
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM tables in
* markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown` to enable GFM tables.
*/
function gfmTableFromMarkdown() {
	return {
		enter: {
			table: enterTable,
			tableData: enterCell,
			tableHeader: enterCell,
			tableRow: enterRow
		},
		exit: {
			codeText: exitCodeText,
			table: exitTable,
			tableData: exit,
			tableHeader: exit,
			tableRow: exit
		}
	};
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterTable(token) {
	const align = token._align;
	this.enter({
		type: "table",
		align: align.map(function(d) {
			return d === "none" ? null : d;
		}),
		children: []
	}, token);
	this.data.inTable = true;
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitTable(token) {
	this.exit(token);
	this.data.inTable = void 0;
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterRow(token) {
	this.enter({
		type: "tableRow",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exit(token) {
	this.exit(token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterCell(token) {
	this.enter({
		type: "tableCell",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitCodeText(token) {
	let value = this.resume();
	if (this.data.inTable) value = value.replace(/\\([\\|])/g, replace);
	const node = this.stack[this.stack.length - 1];
	node.type;
	node.value = value;
	this.exit(token);
}
/**
* @param {string} $0
* @param {string} $1
* @returns {string}
*/
function replace($0, $1) {
	return $1 === "|" ? $1 : $0;
}
/**
* Create an extension for `mdast-util-to-markdown` to enable GFM tables in
* markdown.
*
* @param {Options | null | undefined} [options]
*   Configuration.
* @returns {ToMarkdownExtension}
*   Extension for `mdast-util-to-markdown` to enable GFM tables.
*/
function gfmTableToMarkdown(options) {
	const settings = options || {};
	const padding = settings.tableCellPadding;
	const alignDelimiters = settings.tablePipeAlign;
	const stringLength = settings.stringLength;
	const around = padding ? " " : "|";
	return {
		unsafe: [
			{
				character: "\r",
				inConstruct: "tableCell"
			},
			{
				character: "\n",
				inConstruct: "tableCell"
			},
			{
				atBreak: true,
				character: "|",
				after: "[	 :-]"
			},
			{
				character: "|",
				inConstruct: "tableCell"
			},
			{
				atBreak: true,
				character: ":",
				after: "-"
			},
			{
				atBreak: true,
				character: "-",
				after: "[:|-]"
			}
		],
		handlers: {
			inlineCode: inlineCodeWithTable,
			table: handleTable,
			tableCell: handleTableCell,
			tableRow: handleTableRow
		}
	};
	/**
	* @type {ToMarkdownHandle}
	* @param {Table} node
	*/
	function handleTable(node, _, state, info) {
		return serializeData(handleTableAsData(node, state, info), node.align);
	}
	/**
	* This function isn’t really used normally, because we handle rows at the
	* table level.
	* But, if someone passes in a table row, this ensures we make somewhat sense.
	*
	* @type {ToMarkdownHandle}
	* @param {TableRow} node
	*/
	function handleTableRow(node, _, state, info) {
		const value = serializeData([handleTableRowAsData(node, state, info)]);
		return value.slice(0, value.indexOf("\n"));
	}
	/**
	* @type {ToMarkdownHandle}
	* @param {TableCell} node
	*/
	function handleTableCell(node, _, state, info) {
		const exit = state.enter("tableCell");
		const subexit = state.enter("phrasing");
		const value = state.containerPhrasing(node, {
			...info,
			before: around,
			after: around
		});
		subexit();
		exit();
		return value;
	}
	/**
	* @param {Array<Array<string>>} matrix
	* @param {Array<string | null | undefined> | null | undefined} [align]
	*/
	function serializeData(matrix, align) {
		return markdownTable(matrix, {
			align,
			alignDelimiters,
			padding,
			stringLength
		});
	}
	/**
	* @param {Table} node
	* @param {State} state
	* @param {Info} info
	*/
	function handleTableAsData(node, state, info) {
		const children = node.children;
		let index = -1;
		/** @type {Array<Array<string>>} */
		const result = [];
		const subexit = state.enter("table");
		while (++index < children.length) result[index] = handleTableRowAsData(children[index], state, info);
		subexit();
		return result;
	}
	/**
	* @param {TableRow} node
	* @param {State} state
	* @param {Info} info
	*/
	function handleTableRowAsData(node, state, info) {
		const children = node.children;
		let index = -1;
		/** @type {Array<string>} */
		const result = [];
		const subexit = state.enter("tableRow");
		while (++index < children.length) result[index] = handleTableCell(children[index], node, state, info);
		subexit();
		return result;
	}
	/**
	* @type {ToMarkdownHandle}
	* @param {InlineCode} node
	*/
	function inlineCodeWithTable(node, parent, state) {
		let value = handle.inlineCode(node, parent, state);
		if (state.stack.includes("tableCell")) value = value.replace(/\|/g, "\\$&");
		return value;
	}
}
//#endregion
//#region ../../node_modules/mdast-util-gfm-task-list-item/lib/index.js
/**
* @typedef {import('mdast').ListItem} ListItem
* @typedef {import('mdast').Paragraph} Paragraph
* @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
* @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
* @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
* @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
* @typedef {import('mdast-util-to-markdown').Handle} ToMarkdownHandle
*/
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM task
* list items in markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown` to enable GFM task list items.
*/
function gfmTaskListItemFromMarkdown() {
	return { exit: {
		taskListCheckValueChecked: exitCheck,
		taskListCheckValueUnchecked: exitCheck,
		paragraph: exitParagraphWithTaskListItem
	} };
}
/**
* Create an extension for `mdast-util-to-markdown` to enable GFM task list
* items in markdown.
*
* @returns {ToMarkdownExtension}
*   Extension for `mdast-util-to-markdown` to enable GFM task list items.
*/
function gfmTaskListItemToMarkdown() {
	return {
		unsafe: [{
			atBreak: true,
			character: "-",
			after: "[:|-]"
		}],
		handlers: { listItem: listItemWithTaskListItem }
	};
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitCheck(token) {
	const node = this.stack[this.stack.length - 2];
	node.type;
	node.checked = token.type === "taskListCheckValueChecked";
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitParagraphWithTaskListItem(token) {
	const parent = this.stack[this.stack.length - 2];
	if (parent && parent.type === "listItem" && typeof parent.checked === "boolean") {
		const node = this.stack[this.stack.length - 1];
		node.type;
		const head = node.children[0];
		if (head && head.type === "text") {
			const siblings = parent.children;
			let index = -1;
			/** @type {Paragraph | undefined} */
			let firstParaghraph;
			while (++index < siblings.length) {
				const sibling = siblings[index];
				if (sibling.type === "paragraph") {
					firstParaghraph = sibling;
					break;
				}
			}
			if (firstParaghraph === node) {
				head.value = head.value.slice(1);
				if (head.value.length === 0) node.children.shift();
				else if (node.position && head.position && typeof head.position.start.offset === "number") {
					head.position.start.column++;
					head.position.start.offset++;
					node.position.start = Object.assign({}, head.position.start);
				}
			}
		}
	}
	this.exit(token);
}
/**
* @type {ToMarkdownHandle}
* @param {ListItem} node
*/
function listItemWithTaskListItem(node, parent, state, info) {
	const head = node.children[0];
	const checkable = typeof node.checked === "boolean" && head && head.type === "paragraph";
	const checkbox = "[" + (node.checked ? "x" : " ") + "] ";
	const tracker = state.createTracker(info);
	if (checkable) tracker.move(checkbox);
	let value = handle.listItem(node, parent, state, {
		...info,
		...tracker.current()
	});
	if (checkable) value = value.replace(/^(?:[*+-]|\d+\.)([\r\n]| {1,3})/, check);
	return value;
	/**
	* @param {string} $0
	* @returns {string}
	*/
	function check($0) {
		return $0 + checkbox;
	}
}
//#endregion
//#region ../../node_modules/mdast-util-gfm/lib/index.js
/**
* @import {Extension as FromMarkdownExtension} from 'mdast-util-from-markdown'
* @import {Options} from 'mdast-util-gfm'
* @import {Options as ToMarkdownExtension} from 'mdast-util-to-markdown'
*/
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM (autolink
* literals, footnotes, strikethrough, tables, tasklists).
*
* @returns {Array<FromMarkdownExtension>}
*   Extension for `mdast-util-from-markdown` to enable GFM (autolink literals,
*   footnotes, strikethrough, tables, tasklists).
*/
function gfmFromMarkdown() {
	return [
		gfmAutolinkLiteralFromMarkdown(),
		gfmFootnoteFromMarkdown(),
		gfmStrikethroughFromMarkdown(),
		gfmTableFromMarkdown(),
		gfmTaskListItemFromMarkdown()
	];
}
/**
* Create an extension for `mdast-util-to-markdown` to enable GFM (autolink
* literals, footnotes, strikethrough, tables, tasklists).
*
* @param {Options | null | undefined} [options]
*   Configuration (optional).
* @returns {ToMarkdownExtension}
*   Extension for `mdast-util-to-markdown` to enable GFM (autolink literals,
*   footnotes, strikethrough, tables, tasklists).
*/
function gfmToMarkdown(options) {
	return { extensions: [
		gfmAutolinkLiteralToMarkdown(),
		gfmFootnoteToMarkdown(options),
		gfmStrikethroughToMarkdown(),
		gfmTableToMarkdown(options),
		gfmTaskListItemToMarkdown()
	] };
}
//#endregion
//#region ../../node_modules/micromark-extension-gfm-autolink-literal/lib/syntax.js
/**
* @import {Code, ConstructRecord, Event, Extension, Previous, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
var wwwPrefix = {
	tokenize: tokenizeWwwPrefix,
	partial: true
};
var domain = {
	tokenize: tokenizeDomain,
	partial: true
};
var path = {
	tokenize: tokenizePath,
	partial: true
};
var trail = {
	tokenize: tokenizeTrail,
	partial: true
};
var emailDomainDotTrail = {
	tokenize: tokenizeEmailDomainDotTrail,
	partial: true
};
var wwwAutolink = {
	name: "wwwAutolink",
	tokenize: tokenizeWwwAutolink,
	previous: previousWww
};
var protocolAutolink = {
	name: "protocolAutolink",
	tokenize: tokenizeProtocolAutolink,
	previous: previousProtocol
};
var emailAutolink = {
	name: "emailAutolink",
	tokenize: tokenizeEmailAutolink,
	previous: previousEmail
};
/** @type {ConstructRecord} */
var text = {};
/**
* Create an extension for `micromark` to support GitHub autolink literal
* syntax.
*
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions` to enable GFM
*   autolink literal syntax.
*/
function gfmAutolinkLiteral() {
	return { text };
}
/** @type {Code} */
var code = 48;
while (code < 123) {
	text[code] = emailAutolink;
	code++;
	if (code === 58) code = 65;
	else if (code === 91) code = 97;
}
text[43] = emailAutolink;
text[45] = emailAutolink;
text[46] = emailAutolink;
text[95] = emailAutolink;
text[72] = [emailAutolink, protocolAutolink];
text[104] = [emailAutolink, protocolAutolink];
text[87] = [emailAutolink, wwwAutolink];
text[119] = [emailAutolink, wwwAutolink];
/**
* Email autolink literal.
*
* ```markdown
* > | a contact@example.org b
*       ^^^^^^^^^^^^^^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeEmailAutolink(effects, ok, nok) {
	const self = this;
	/** @type {boolean | undefined} */
	let dot;
	/** @type {boolean} */
	let data;
	return start;
	/**
	* Start of email autolink literal.
	*
	* ```markdown
	* > | a contact@example.org b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (!gfmAtext(code) || !previousEmail.call(self, self.previous) || previousUnbalanced(self.events)) return nok(code);
		effects.enter("literalAutolink");
		effects.enter("literalAutolinkEmail");
		return atext(code);
	}
	/**
	* In email atext.
	*
	* ```markdown
	* > | a contact@example.org b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function atext(code) {
		if (gfmAtext(code)) {
			effects.consume(code);
			return atext;
		}
		if (code === 64) {
			effects.consume(code);
			return emailDomain;
		}
		return nok(code);
	}
	/**
	* In email domain.
	*
	* The reference code is a bit overly complex as it handles the `@`, of which
	* there may be just one.
	* Source: <https://github.com/github/cmark-gfm/blob/ef1cfcb/extensions/autolink.c#L318>
	*
	* ```markdown
	* > | a contact@example.org b
	*               ^
	* ```
	*
	* @type {State}
	*/
	function emailDomain(code) {
		if (code === 46) return effects.check(emailDomainDotTrail, emailDomainAfter, emailDomainDot)(code);
		if (code === 45 || code === 95 || asciiAlphanumeric(code)) {
			data = true;
			effects.consume(code);
			return emailDomain;
		}
		return emailDomainAfter(code);
	}
	/**
	* In email domain, on dot that is not a trail.
	*
	* ```markdown
	* > | a contact@example.org b
	*                      ^
	* ```
	*
	* @type {State}
	*/
	function emailDomainDot(code) {
		effects.consume(code);
		dot = true;
		return emailDomain;
	}
	/**
	* After email domain.
	*
	* ```markdown
	* > | a contact@example.org b
	*                          ^
	* ```
	*
	* @type {State}
	*/
	function emailDomainAfter(code) {
		if (data && dot && asciiAlpha(self.previous)) {
			effects.exit("literalAutolinkEmail");
			effects.exit("literalAutolink");
			return ok(code);
		}
		return nok(code);
	}
}
/**
* `www` autolink literal.
*
* ```markdown
* > | a www.example.org b
*       ^^^^^^^^^^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeWwwAutolink(effects, ok, nok) {
	const self = this;
	return wwwStart;
	/**
	* Start of www autolink literal.
	*
	* ```markdown
	* > | www.example.com/a?b#c
	*     ^
	* ```
	*
	* @type {State}
	*/
	function wwwStart(code) {
		if (code !== 87 && code !== 119 || !previousWww.call(self, self.previous) || previousUnbalanced(self.events)) return nok(code);
		effects.enter("literalAutolink");
		effects.enter("literalAutolinkWww");
		return effects.check(wwwPrefix, effects.attempt(domain, effects.attempt(path, wwwAfter), nok), nok)(code);
	}
	/**
	* After a www autolink literal.
	*
	* ```markdown
	* > | www.example.com/a?b#c
	*                          ^
	* ```
	*
	* @type {State}
	*/
	function wwwAfter(code) {
		effects.exit("literalAutolinkWww");
		effects.exit("literalAutolink");
		return ok(code);
	}
}
/**
* Protocol autolink literal.
*
* ```markdown
* > | a https://example.org b
*       ^^^^^^^^^^^^^^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeProtocolAutolink(effects, ok, nok) {
	const self = this;
	let buffer = "";
	let seen = false;
	return protocolStart;
	/**
	* Start of protocol autolink literal.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*     ^
	* ```
	*
	* @type {State}
	*/
	function protocolStart(code) {
		if ((code === 72 || code === 104) && previousProtocol.call(self, self.previous) && !previousUnbalanced(self.events)) {
			effects.enter("literalAutolink");
			effects.enter("literalAutolinkHttp");
			buffer += String.fromCodePoint(code);
			effects.consume(code);
			return protocolPrefixInside;
		}
		return nok(code);
	}
	/**
	* In protocol.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*     ^^^^^
	* ```
	*
	* @type {State}
	*/
	function protocolPrefixInside(code) {
		if (asciiAlpha(code) && buffer.length < 5) {
			buffer += String.fromCodePoint(code);
			effects.consume(code);
			return protocolPrefixInside;
		}
		if (code === 58) {
			const protocol = buffer.toLowerCase();
			if (protocol === "http" || protocol === "https") {
				effects.consume(code);
				return protocolSlashesInside;
			}
		}
		return nok(code);
	}
	/**
	* In slashes.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*           ^^
	* ```
	*
	* @type {State}
	*/
	function protocolSlashesInside(code) {
		if (code === 47) {
			effects.consume(code);
			if (seen) return afterProtocol;
			seen = true;
			return protocolSlashesInside;
		}
		return nok(code);
	}
	/**
	* After protocol, before domain.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*             ^
	* ```
	*
	* @type {State}
	*/
	function afterProtocol(code) {
		return code === null || asciiControl(code) || markdownLineEndingOrSpace(code) || unicodeWhitespace(code) || unicodePunctuation(code) ? nok(code) : effects.attempt(domain, effects.attempt(path, protocolAfter), nok)(code);
	}
	/**
	* After a protocol autolink literal.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*                              ^
	* ```
	*
	* @type {State}
	*/
	function protocolAfter(code) {
		effects.exit("literalAutolinkHttp");
		effects.exit("literalAutolink");
		return ok(code);
	}
}
/**
* `www` prefix.
*
* ```markdown
* > | a www.example.org b
*       ^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeWwwPrefix(effects, ok, nok) {
	let size = 0;
	return wwwPrefixInside;
	/**
	* In www prefix.
	*
	* ```markdown
	* > | www.example.com
	*     ^^^^
	* ```
	*
	* @type {State}
	*/
	function wwwPrefixInside(code) {
		if ((code === 87 || code === 119) && size < 3) {
			size++;
			effects.consume(code);
			return wwwPrefixInside;
		}
		if (code === 46 && size === 3) {
			effects.consume(code);
			return wwwPrefixAfter;
		}
		return nok(code);
	}
	/**
	* After www prefix.
	*
	* ```markdown
	* > | www.example.com
	*         ^
	* ```
	*
	* @type {State}
	*/
	function wwwPrefixAfter(code) {
		return code === null ? nok(code) : ok(code);
	}
}
/**
* Domain.
*
* ```markdown
* > | a https://example.org b
*               ^^^^^^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeDomain(effects, ok, nok) {
	/** @type {boolean | undefined} */
	let underscoreInLastSegment;
	/** @type {boolean | undefined} */
	let underscoreInLastLastSegment;
	/** @type {boolean | undefined} */
	let seen;
	return domainInside;
	/**
	* In domain.
	*
	* ```markdown
	* > | https://example.com/a
	*             ^^^^^^^^^^^
	* ```
	*
	* @type {State}
	*/
	function domainInside(code) {
		if (code === 46 || code === 95) return effects.check(trail, domainAfter, domainAtPunctuation)(code);
		if (code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code) || code !== 45 && unicodePunctuation(code)) return domainAfter(code);
		seen = true;
		effects.consume(code);
		return domainInside;
	}
	/**
	* In domain, at potential trailing punctuation, that was not trailing.
	*
	* ```markdown
	* > | https://example.com
	*                    ^
	* ```
	*
	* @type {State}
	*/
	function domainAtPunctuation(code) {
		if (code === 95) underscoreInLastSegment = true;
		else {
			underscoreInLastLastSegment = underscoreInLastSegment;
			underscoreInLastSegment = void 0;
		}
		effects.consume(code);
		return domainInside;
	}
	/**
	* After domain.
	*
	* ```markdown
	* > | https://example.com/a
	*                        ^
	* ```
	*
	* @type {State} */
	function domainAfter(code) {
		if (underscoreInLastLastSegment || underscoreInLastSegment || !seen) return nok(code);
		return ok(code);
	}
}
/**
* Path.
*
* ```markdown
* > | a https://example.org/stuff b
*                          ^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizePath(effects, ok) {
	let sizeOpen = 0;
	let sizeClose = 0;
	return pathInside;
	/**
	* In path.
	*
	* ```markdown
	* > | https://example.com/a
	*                        ^^
	* ```
	*
	* @type {State}
	*/
	function pathInside(code) {
		if (code === 40) {
			sizeOpen++;
			effects.consume(code);
			return pathInside;
		}
		if (code === 41 && sizeClose < sizeOpen) return pathAtPunctuation(code);
		if (code === 33 || code === 34 || code === 38 || code === 39 || code === 41 || code === 42 || code === 44 || code === 46 || code === 58 || code === 59 || code === 60 || code === 63 || code === 93 || code === 95 || code === 126) return effects.check(trail, ok, pathAtPunctuation)(code);
		if (code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return ok(code);
		effects.consume(code);
		return pathInside;
	}
	/**
	* In path, at potential trailing punctuation, that was not trailing.
	*
	* ```markdown
	* > | https://example.com/a"b
	*                          ^
	* ```
	*
	* @type {State}
	*/
	function pathAtPunctuation(code) {
		if (code === 41) sizeClose++;
		effects.consume(code);
		return pathInside;
	}
}
/**
* Trail.
*
* This calls `ok` if this *is* the trail, followed by an end, which means
* the entire trail is not part of the link.
* It calls `nok` if this *is* part of the link.
*
* ```markdown
* > | https://example.com").
*                        ^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeTrail(effects, ok, nok) {
	return trail;
	/**
	* In trail of domain or path.
	*
	* ```markdown
	* > | https://example.com").
	*                        ^
	* ```
	*
	* @type {State}
	*/
	function trail(code) {
		if (code === 33 || code === 34 || code === 39 || code === 41 || code === 42 || code === 44 || code === 46 || code === 58 || code === 59 || code === 63 || code === 95 || code === 126) {
			effects.consume(code);
			return trail;
		}
		if (code === 38) {
			effects.consume(code);
			return trailCharacterReferenceStart;
		}
		if (code === 93) {
			effects.consume(code);
			return trailBracketAfter;
		}
		if (code === 60 || code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return ok(code);
		return nok(code);
	}
	/**
	* In trail, after `]`.
	*
	* > 👉 **Note**: this deviates from `cmark-gfm` to fix a bug.
	* > See end of <https://github.com/github/cmark-gfm/issues/278> for more.
	*
	* ```markdown
	* > | https://example.com](
	*                         ^
	* ```
	*
	* @type {State}
	*/
	function trailBracketAfter(code) {
		if (code === null || code === 40 || code === 91 || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return ok(code);
		return trail(code);
	}
	/**
	* In character-reference like trail, after `&`.
	*
	* ```markdown
	* > | https://example.com&amp;).
	*                         ^
	* ```
	*
	* @type {State}
	*/
	function trailCharacterReferenceStart(code) {
		return asciiAlpha(code) ? trailCharacterReferenceInside(code) : nok(code);
	}
	/**
	* In character-reference like trail.
	*
	* ```markdown
	* > | https://example.com&amp;).
	*                         ^
	* ```
	*
	* @type {State}
	*/
	function trailCharacterReferenceInside(code) {
		if (code === 59) {
			effects.consume(code);
			return trail;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			return trailCharacterReferenceInside;
		}
		return nok(code);
	}
}
/**
* Dot in email domain trail.
*
* This calls `ok` if this *is* the trail, followed by an end, which means
* the trail is not part of the link.
* It calls `nok` if this *is* part of the link.
*
* ```markdown
* > | contact@example.org.
*                        ^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeEmailDomainDotTrail(effects, ok, nok) {
	return start;
	/**
	* Dot.
	*
	* ```markdown
	* > | contact@example.org.
	*                    ^   ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.consume(code);
		return after;
	}
	/**
	* After dot.
	*
	* ```markdown
	* > | contact@example.org.
	*                     ^   ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return asciiAlphanumeric(code) ? nok(code) : ok(code);
	}
}
/**
* See:
* <https://github.com/github/cmark-gfm/blob/ef1cfcb/extensions/autolink.c#L156>.
*
* @type {Previous}
*/
function previousWww(code) {
	return code === null || code === 40 || code === 42 || code === 95 || code === 91 || code === 93 || code === 126 || markdownLineEndingOrSpace(code);
}
/**
* See:
* <https://github.com/github/cmark-gfm/blob/ef1cfcb/extensions/autolink.c#L214>.
*
* @type {Previous}
*/
function previousProtocol(code) {
	return !asciiAlpha(code);
}
/**
* @this {TokenizeContext}
* @type {Previous}
*/
function previousEmail(code) {
	return !(code === 47 || gfmAtext(code));
}
/**
* @param {Code} code
* @returns {boolean}
*/
function gfmAtext(code) {
	return code === 43 || code === 45 || code === 46 || code === 95 || asciiAlphanumeric(code);
}
/**
* @param {Array<Event>} events
* @returns {boolean}
*/
function previousUnbalanced(events) {
	let index = events.length;
	let result = false;
	while (index--) {
		const token = events[index][1];
		if ((token.type === "labelLink" || token.type === "labelImage") && !token._balanced) {
			result = true;
			break;
		}
		if (token._gfmAutolinkLiteralWalkedInto) {
			result = false;
			break;
		}
	}
	if (events.length > 0 && !result) events[events.length - 1][1]._gfmAutolinkLiteralWalkedInto = true;
	return result;
}
//#endregion
//#region ../../node_modules/micromark-extension-gfm-footnote/lib/syntax.js
/**
* @import {Event, Exiter, Extension, Resolver, State, Token, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
var indent = {
	tokenize: tokenizeIndent,
	partial: true
};
/**
* Create an extension for `micromark` to enable GFM footnote syntax.
*
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions` to
*   enable GFM footnote syntax.
*/
function gfmFootnote() {
	/** @type {Extension} */
	return {
		document: { [91]: {
			name: "gfmFootnoteDefinition",
			tokenize: tokenizeDefinitionStart,
			continuation: { tokenize: tokenizeDefinitionContinuation },
			exit: gfmFootnoteDefinitionEnd
		} },
		text: {
			[91]: {
				name: "gfmFootnoteCall",
				tokenize: tokenizeGfmFootnoteCall
			},
			[93]: {
				name: "gfmPotentialFootnoteCall",
				add: "after",
				tokenize: tokenizePotentialGfmFootnoteCall,
				resolveTo: resolveToPotentialGfmFootnoteCall
			}
		}
	};
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizePotentialGfmFootnoteCall(effects, ok, nok) {
	const self = this;
	let index = self.events.length;
	const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
	/** @type {Token} */
	let labelStart;
	while (index--) {
		const token = self.events[index][1];
		if (token.type === "labelImage") {
			labelStart = token;
			break;
		}
		if (token.type === "gfmFootnoteCall" || token.type === "labelLink" || token.type === "label" || token.type === "image" || token.type === "link") break;
	}
	return start;
	/**
	* @type {State}
	*/
	function start(code) {
		if (!labelStart || !labelStart._balanced) return nok(code);
		const id = normalizeIdentifier(self.sliceSerialize({
			start: labelStart.end,
			end: self.now()
		}));
		if (id.codePointAt(0) !== 94 || !defined.includes(id.slice(1))) return nok(code);
		effects.enter("gfmFootnoteCallLabelMarker");
		effects.consume(code);
		effects.exit("gfmFootnoteCallLabelMarker");
		return ok(code);
	}
}
/** @type {Resolver} */
function resolveToPotentialGfmFootnoteCall(events, context) {
	let index = events.length;
	while (index--) if (events[index][1].type === "labelImage" && events[index][0] === "enter") {
		events[index][1];
		break;
	}
	events[index + 1][1].type = "data";
	events[index + 3][1].type = "gfmFootnoteCallLabelMarker";
	/** @type {Token} */
	const call = {
		type: "gfmFootnoteCall",
		start: Object.assign({}, events[index + 3][1].start),
		end: Object.assign({}, events[events.length - 1][1].end)
	};
	/** @type {Token} */
	const marker = {
		type: "gfmFootnoteCallMarker",
		start: Object.assign({}, events[index + 3][1].end),
		end: Object.assign({}, events[index + 3][1].end)
	};
	marker.end.column++;
	marker.end.offset++;
	marker.end._bufferIndex++;
	/** @type {Token} */
	const string = {
		type: "gfmFootnoteCallString",
		start: Object.assign({}, marker.end),
		end: Object.assign({}, events[events.length - 1][1].start)
	};
	/** @type {Token} */
	const chunk = {
		type: "chunkString",
		contentType: "string",
		start: Object.assign({}, string.start),
		end: Object.assign({}, string.end)
	};
	/** @type {Array<Event>} */
	const replacement = [
		events[index + 1],
		events[index + 2],
		[
			"enter",
			call,
			context
		],
		events[index + 3],
		events[index + 4],
		[
			"enter",
			marker,
			context
		],
		[
			"exit",
			marker,
			context
		],
		[
			"enter",
			string,
			context
		],
		[
			"enter",
			chunk,
			context
		],
		[
			"exit",
			chunk,
			context
		],
		[
			"exit",
			string,
			context
		],
		events[events.length - 2],
		events[events.length - 1],
		[
			"exit",
			call,
			context
		]
	];
	events.splice(index, events.length - index + 1, ...replacement);
	return events;
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeGfmFootnoteCall(effects, ok, nok) {
	const self = this;
	const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
	let size = 0;
	/** @type {boolean} */
	let data;
	return start;
	/**
	* Start of footnote label.
	*
	* ```markdown
	* > | a [^b] c
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("gfmFootnoteCall");
		effects.enter("gfmFootnoteCallLabelMarker");
		effects.consume(code);
		effects.exit("gfmFootnoteCallLabelMarker");
		return callStart;
	}
	/**
	* After `[`, at `^`.
	*
	* ```markdown
	* > | a [^b] c
	*        ^
	* ```
	*
	* @type {State}
	*/
	function callStart(code) {
		if (code !== 94) return nok(code);
		effects.enter("gfmFootnoteCallMarker");
		effects.consume(code);
		effects.exit("gfmFootnoteCallMarker");
		effects.enter("gfmFootnoteCallString");
		effects.enter("chunkString").contentType = "string";
		return callData;
	}
	/**
	* In label.
	*
	* ```markdown
	* > | a [^b] c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function callData(code) {
		if (size > 999 || code === 93 && !data || code === null || code === 91 || markdownLineEndingOrSpace(code)) return nok(code);
		if (code === 93) {
			effects.exit("chunkString");
			const token = effects.exit("gfmFootnoteCallString");
			if (!defined.includes(normalizeIdentifier(self.sliceSerialize(token)))) return nok(code);
			effects.enter("gfmFootnoteCallLabelMarker");
			effects.consume(code);
			effects.exit("gfmFootnoteCallLabelMarker");
			effects.exit("gfmFootnoteCall");
			return ok;
		}
		if (!markdownLineEndingOrSpace(code)) data = true;
		size++;
		effects.consume(code);
		return code === 92 ? callEscape : callData;
	}
	/**
	* On character after escape.
	*
	* ```markdown
	* > | a [^b\c] d
	*           ^
	* ```
	*
	* @type {State}
	*/
	function callEscape(code) {
		if (code === 91 || code === 92 || code === 93) {
			effects.consume(code);
			size++;
			return callData;
		}
		return callData(code);
	}
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeDefinitionStart(effects, ok, nok) {
	const self = this;
	const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
	/** @type {string} */
	let identifier;
	let size = 0;
	/** @type {boolean | undefined} */
	let data;
	return start;
	/**
	* Start of GFM footnote definition.
	*
	* ```markdown
	* > | [^a]: b
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("gfmFootnoteDefinition")._container = true;
		effects.enter("gfmFootnoteDefinitionLabel");
		effects.enter("gfmFootnoteDefinitionLabelMarker");
		effects.consume(code);
		effects.exit("gfmFootnoteDefinitionLabelMarker");
		return labelAtMarker;
	}
	/**
	* In label, at caret.
	*
	* ```markdown
	* > | [^a]: b
	*      ^
	* ```
	*
	* @type {State}
	*/
	function labelAtMarker(code) {
		if (code === 94) {
			effects.enter("gfmFootnoteDefinitionMarker");
			effects.consume(code);
			effects.exit("gfmFootnoteDefinitionMarker");
			effects.enter("gfmFootnoteDefinitionLabelString");
			effects.enter("chunkString").contentType = "string";
			return labelInside;
		}
		return nok(code);
	}
	/**
	* In label.
	*
	* > 👉 **Note**: `cmark-gfm` prevents whitespace from occurring in footnote
	* > definition labels.
	*
	* ```markdown
	* > | [^a]: b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function labelInside(code) {
		if (size > 999 || code === 93 && !data || code === null || code === 91 || markdownLineEndingOrSpace(code)) return nok(code);
		if (code === 93) {
			effects.exit("chunkString");
			const token = effects.exit("gfmFootnoteDefinitionLabelString");
			identifier = normalizeIdentifier(self.sliceSerialize(token));
			effects.enter("gfmFootnoteDefinitionLabelMarker");
			effects.consume(code);
			effects.exit("gfmFootnoteDefinitionLabelMarker");
			effects.exit("gfmFootnoteDefinitionLabel");
			return labelAfter;
		}
		if (!markdownLineEndingOrSpace(code)) data = true;
		size++;
		effects.consume(code);
		return code === 92 ? labelEscape : labelInside;
	}
	/**
	* After `\`, at a special character.
	*
	* > 👉 **Note**: `cmark-gfm` currently does not support escaped brackets:
	* > <https://github.com/github/cmark-gfm/issues/240>
	*
	* ```markdown
	* > | [^a\*b]: c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function labelEscape(code) {
		if (code === 91 || code === 92 || code === 93) {
			effects.consume(code);
			size++;
			return labelInside;
		}
		return labelInside(code);
	}
	/**
	* After definition label.
	*
	* ```markdown
	* > | [^a]: b
	*         ^
	* ```
	*
	* @type {State}
	*/
	function labelAfter(code) {
		if (code === 58) {
			effects.enter("definitionMarker");
			effects.consume(code);
			effects.exit("definitionMarker");
			if (!defined.includes(identifier)) defined.push(identifier);
			return factorySpace(effects, whitespaceAfter, "gfmFootnoteDefinitionWhitespace");
		}
		return nok(code);
	}
	/**
	* After definition prefix.
	*
	* ```markdown
	* > | [^a]: b
	*           ^
	* ```
	*
	* @type {State}
	*/
	function whitespaceAfter(code) {
		return ok(code);
	}
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeDefinitionContinuation(effects, ok, nok) {
	return effects.check(blankLine, ok, effects.attempt(indent, ok, nok));
}
/** @type {Exiter} */
function gfmFootnoteDefinitionEnd(effects) {
	effects.exit("gfmFootnoteDefinition");
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeIndent(effects, ok, nok) {
	const self = this;
	return factorySpace(effects, afterPrefix, "gfmFootnoteDefinitionIndent", 5);
	/**
	* @type {State}
	*/
	function afterPrefix(code) {
		const tail = self.events[self.events.length - 1];
		return tail && tail[1].type === "gfmFootnoteDefinitionIndent" && tail[2].sliceSerialize(tail[1], true).length === 4 ? ok(code) : nok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-extension-gfm-strikethrough/lib/syntax.js
/**
* @import {Options} from 'micromark-extension-gfm-strikethrough'
* @import {Event, Extension, Resolver, State, Token, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
/**
* Create an extension for `micromark` to enable GFM strikethrough syntax.
*
* @param {Options | null | undefined} [options={}]
*   Configuration.
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions`, to
*   enable GFM strikethrough syntax.
*/
function gfmStrikethrough(options) {
	let single = (options || {}).singleTilde;
	const tokenizer = {
		name: "strikethrough",
		tokenize: tokenizeStrikethrough,
		resolveAll: resolveAllStrikethrough
	};
	if (single === null || single === void 0) single = true;
	return {
		text: { [126]: tokenizer },
		insideSpan: { null: [tokenizer] },
		attentionMarkers: { null: [126] }
	};
	/**
	* Take events and resolve strikethrough.
	*
	* @type {Resolver}
	*/
	function resolveAllStrikethrough(events, context) {
		let index = -1;
		while (++index < events.length) if (events[index][0] === "enter" && events[index][1].type === "strikethroughSequenceTemporary" && events[index][1]._close) {
			let open = index;
			while (open--) if (events[open][0] === "exit" && events[open][1].type === "strikethroughSequenceTemporary" && events[open][1]._open && events[index][1].end.offset - events[index][1].start.offset === events[open][1].end.offset - events[open][1].start.offset) {
				events[index][1].type = "strikethroughSequence";
				events[open][1].type = "strikethroughSequence";
				/** @type {Token} */
				const strikethrough = {
					type: "strikethrough",
					start: Object.assign({}, events[open][1].start),
					end: Object.assign({}, events[index][1].end)
				};
				/** @type {Token} */
				const text = {
					type: "strikethroughText",
					start: Object.assign({}, events[open][1].end),
					end: Object.assign({}, events[index][1].start)
				};
				/** @type {Array<Event>} */
				const nextEvents = [
					[
						"enter",
						strikethrough,
						context
					],
					[
						"enter",
						events[open][1],
						context
					],
					[
						"exit",
						events[open][1],
						context
					],
					[
						"enter",
						text,
						context
					]
				];
				const insideSpan = context.parser.constructs.insideSpan.null;
				if (insideSpan) splice(nextEvents, nextEvents.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context));
				splice(nextEvents, nextEvents.length, 0, [
					[
						"exit",
						text,
						context
					],
					[
						"enter",
						events[index][1],
						context
					],
					[
						"exit",
						events[index][1],
						context
					],
					[
						"exit",
						strikethrough,
						context
					]
				]);
				splice(events, open - 1, index - open + 3, nextEvents);
				index = open + nextEvents.length - 2;
				break;
			}
		}
		index = -1;
		while (++index < events.length) if (events[index][1].type === "strikethroughSequenceTemporary") events[index][1].type = "data";
		return events;
	}
	/**
	* @this {TokenizeContext}
	* @type {Tokenizer}
	*/
	function tokenizeStrikethrough(effects, ok, nok) {
		const previous = this.previous;
		const events = this.events;
		let size = 0;
		return start;
		/** @type {State} */
		function start(code) {
			if (previous === 126 && events[events.length - 1][1].type !== "characterEscape") return nok(code);
			effects.enter("strikethroughSequenceTemporary");
			return more(code);
		}
		/** @type {State} */
		function more(code) {
			const before = classifyCharacter(previous);
			if (code === 126) {
				if (size > 1) return nok(code);
				effects.consume(code);
				size++;
				return more;
			}
			if (size < 2 && !single) return nok(code);
			const token = effects.exit("strikethroughSequenceTemporary");
			const after = classifyCharacter(code);
			token._open = !after || after === 2 && Boolean(before);
			token._close = !before || before === 2 && Boolean(after);
			return ok(code);
		}
	}
}
//#endregion
//#region ../../node_modules/micromark-extension-gfm-table/lib/edit-map.js
/**
* @import {Event} from 'micromark-util-types'
*/
/**
* @typedef {[number, number, Array<Event>]} Change
* @typedef {[number, number, number]} Jump
*/
/**
* Tracks a bunch of edits.
*/
var EditMap = class {
	/**
	* Create a new edit map.
	*/
	constructor() {
		/**
		* Record of changes.
		*
		* @type {Array<Change>}
		*/
		this.map = [];
	}
	/**
	* Create an edit: a remove and/or add at a certain place.
	*
	* @param {number} index
	* @param {number} remove
	* @param {Array<Event>} add
	* @returns {undefined}
	*/
	add(index, remove, add) {
		addImplementation(this, index, remove, add);
	}
	/**
	* Done, change the events.
	*
	* @param {Array<Event>} events
	* @returns {undefined}
	*/
	consume(events) {
		this.map.sort(function(a, b) {
			return a[0] - b[0];
		});
		/* c8 ignore next 3 -- `resolve` is never called without tables, so without edits. */
		if (this.map.length === 0) return;
		let index = this.map.length;
		/** @type {Array<Array<Event>>} */
		const vecs = [];
		while (index > 0) {
			index -= 1;
			vecs.push(events.slice(this.map[index][0] + this.map[index][1]), this.map[index][2]);
			events.length = this.map[index][0];
		}
		vecs.push(events.slice());
		events.length = 0;
		let slice = vecs.pop();
		while (slice) {
			for (const element of slice) events.push(element);
			slice = vecs.pop();
		}
		this.map.length = 0;
	}
};
/**
* Create an edit.
*
* @param {EditMap} editMap
* @param {number} at
* @param {number} remove
* @param {Array<Event>} add
* @returns {undefined}
*/
function addImplementation(editMap, at, remove, add) {
	let index = 0;
	/* c8 ignore next 3 -- `resolve` is never called without tables, so without edits. */
	if (remove === 0 && add.length === 0) return;
	while (index < editMap.map.length) {
		if (editMap.map[index][0] === at) {
			editMap.map[index][1] += remove;
			editMap.map[index][2].push(...add);
			return;
		}
		index += 1;
	}
	editMap.map.push([
		at,
		remove,
		add
	]);
}
//#endregion
//#region ../../node_modules/micromark-extension-gfm-table/lib/infer.js
/**
* @import {Event} from 'micromark-util-types'
*/
/**
* @typedef {'center' | 'left' | 'none' | 'right'} Align
*/
/**
* Figure out the alignment of a GFM table.
*
* @param {Readonly<Array<Event>>} events
*   List of events.
* @param {number} index
*   Table enter event.
* @returns {Array<Align>}
*   List of aligns.
*/
function gfmTableAlign(events, index) {
	let inDelimiterRow = false;
	/** @type {Array<Align>} */
	const align = [];
	while (index < events.length) {
		const event = events[index];
		if (inDelimiterRow) {
			if (event[0] === "enter") {
				if (event[1].type === "tableContent") align.push(events[index + 1][1].type === "tableDelimiterMarker" ? "left" : "none");
			} else if (event[1].type === "tableContent") {
				if (events[index - 1][1].type === "tableDelimiterMarker") {
					const alignIndex = align.length - 1;
					align[alignIndex] = align[alignIndex] === "left" ? "center" : "right";
				}
			} else if (event[1].type === "tableDelimiterRow") break;
		} else if (event[0] === "enter" && event[1].type === "tableDelimiterRow") inDelimiterRow = true;
		index += 1;
	}
	return align;
}
//#endregion
//#region ../../node_modules/micromark-extension-gfm-table/lib/syntax.js
/**
* @import {Event, Extension, Point, Resolver, State, Token, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
/**
* @typedef {[number, number, number, number]} Range
*   Cell info.
*
* @typedef {0 | 1 | 2 | 3} RowKind
*   Where we are: `1` for head row, `2` for delimiter row, `3` for body row.
*/
/**
* Create an HTML extension for `micromark` to support GitHub tables syntax.
*
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions` to enable GFM
*   table syntax.
*/
function gfmTable() {
	return { flow: { null: {
		name: "table",
		tokenize: tokenizeTable,
		resolveAll: resolveTable
	} } };
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeTable(effects, ok, nok) {
	const self = this;
	let size = 0;
	let sizeB = 0;
	/** @type {boolean | undefined} */
	let seen;
	return start;
	/**
	* Start of a GFM table.
	*
	* If there is a valid table row or table head before, then we try to parse
	* another row.
	* Otherwise, we try to parse a head.
	*
	* ```markdown
	* > | | a |
	*     ^
	*   | | - |
	* > | | b |
	*     ^
	* ```
	* @type {State}
	*/
	function start(code) {
		let index = self.events.length - 1;
		while (index > -1) {
			const type = self.events[index][1].type;
			if (type === "lineEnding" || type === "linePrefix") index--;
			else break;
		}
		const tail = index > -1 ? self.events[index][1].type : null;
		const next = tail === "tableHead" || tail === "tableRow" ? bodyRowStart : headRowBefore;
		if (next === bodyRowStart && self.parser.lazy[self.now().line]) return nok(code);
		return next(code);
	}
	/**
	* Before table head row.
	*
	* ```markdown
	* > | | a |
	*     ^
	*   | | - |
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headRowBefore(code) {
		effects.enter("tableHead");
		effects.enter("tableRow");
		return headRowStart(code);
	}
	/**
	* Before table head row, after whitespace.
	*
	* ```markdown
	* > | | a |
	*     ^
	*   | | - |
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headRowStart(code) {
		if (code === 124) return headRowBreak(code);
		seen = true;
		sizeB += 1;
		return headRowBreak(code);
	}
	/**
	* At break in table head row.
	*
	* ```markdown
	* > | | a |
	*     ^
	*       ^
	*         ^
	*   | | - |
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headRowBreak(code) {
		if (code === null) return nok(code);
		if (markdownLineEnding(code)) {
			if (sizeB > 1) {
				sizeB = 0;
				self.interrupt = true;
				effects.exit("tableRow");
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return headDelimiterStart;
			}
			return nok(code);
		}
		if (markdownSpace(code)) return factorySpace(effects, headRowBreak, "whitespace")(code);
		sizeB += 1;
		if (seen) {
			seen = false;
			size += 1;
		}
		if (code === 124) {
			effects.enter("tableCellDivider");
			effects.consume(code);
			effects.exit("tableCellDivider");
			seen = true;
			return headRowBreak;
		}
		effects.enter("data");
		return headRowData(code);
	}
	/**
	* In table head row data.
	*
	* ```markdown
	* > | | a |
	*       ^
	*   | | - |
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headRowData(code) {
		if (code === null || code === 124 || markdownLineEndingOrSpace(code)) {
			effects.exit("data");
			return headRowBreak(code);
		}
		effects.consume(code);
		return code === 92 ? headRowEscape : headRowData;
	}
	/**
	* In table head row escape.
	*
	* ```markdown
	* > | | a\-b |
	*         ^
	*   | | ---- |
	*   | | c    |
	* ```
	*
	* @type {State}
	*/
	function headRowEscape(code) {
		if (code === 92 || code === 124) {
			effects.consume(code);
			return headRowData;
		}
		return headRowData(code);
	}
	/**
	* Before delimiter row.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*     ^
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headDelimiterStart(code) {
		self.interrupt = false;
		if (self.parser.lazy[self.now().line]) return nok(code);
		effects.enter("tableDelimiterRow");
		seen = false;
		if (markdownSpace(code)) return factorySpace(effects, headDelimiterBefore, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code);
		return headDelimiterBefore(code);
	}
	/**
	* Before delimiter row, after optional whitespace.
	*
	* Reused when a `|` is found later, to parse another cell.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*     ^
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headDelimiterBefore(code) {
		if (code === 45 || code === 58) return headDelimiterValueBefore(code);
		if (code === 124) {
			seen = true;
			effects.enter("tableCellDivider");
			effects.consume(code);
			effects.exit("tableCellDivider");
			return headDelimiterCellBefore;
		}
		return headDelimiterNok(code);
	}
	/**
	* After `|`, before delimiter cell.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*      ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterCellBefore(code) {
		if (markdownSpace(code)) return factorySpace(effects, headDelimiterValueBefore, "whitespace")(code);
		return headDelimiterValueBefore(code);
	}
	/**
	* Before delimiter cell value.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*       ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterValueBefore(code) {
		if (code === 58) {
			sizeB += 1;
			seen = true;
			effects.enter("tableDelimiterMarker");
			effects.consume(code);
			effects.exit("tableDelimiterMarker");
			return headDelimiterLeftAlignmentAfter;
		}
		if (code === 45) {
			sizeB += 1;
			return headDelimiterLeftAlignmentAfter(code);
		}
		if (code === null || markdownLineEnding(code)) return headDelimiterCellAfter(code);
		return headDelimiterNok(code);
	}
	/**
	* After delimiter cell left alignment marker.
	*
	* ```markdown
	*   | | a  |
	* > | | :- |
	*        ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterLeftAlignmentAfter(code) {
		if (code === 45) {
			effects.enter("tableDelimiterFiller");
			return headDelimiterFiller(code);
		}
		return headDelimiterNok(code);
	}
	/**
	* In delimiter cell filler.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*       ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterFiller(code) {
		if (code === 45) {
			effects.consume(code);
			return headDelimiterFiller;
		}
		if (code === 58) {
			seen = true;
			effects.exit("tableDelimiterFiller");
			effects.enter("tableDelimiterMarker");
			effects.consume(code);
			effects.exit("tableDelimiterMarker");
			return headDelimiterRightAlignmentAfter;
		}
		effects.exit("tableDelimiterFiller");
		return headDelimiterRightAlignmentAfter(code);
	}
	/**
	* After delimiter cell right alignment marker.
	*
	* ```markdown
	*   | |  a |
	* > | | -: |
	*         ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterRightAlignmentAfter(code) {
		if (markdownSpace(code)) return factorySpace(effects, headDelimiterCellAfter, "whitespace")(code);
		return headDelimiterCellAfter(code);
	}
	/**
	* After delimiter cell.
	*
	* ```markdown
	*   | |  a |
	* > | | -: |
	*          ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterCellAfter(code) {
		if (code === 124) return headDelimiterBefore(code);
		if (code === null || markdownLineEnding(code)) {
			if (!seen || size !== sizeB) return headDelimiterNok(code);
			effects.exit("tableDelimiterRow");
			effects.exit("tableHead");
			return ok(code);
		}
		return headDelimiterNok(code);
	}
	/**
	* In delimiter row, at a disallowed byte.
	*
	* ```markdown
	*   | | a |
	* > | | x |
	*       ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterNok(code) {
		return nok(code);
	}
	/**
	* Before table body row.
	*
	* ```markdown
	*   | | a |
	*   | | - |
	* > | | b |
	*     ^
	* ```
	*
	* @type {State}
	*/
	function bodyRowStart(code) {
		effects.enter("tableRow");
		return bodyRowBreak(code);
	}
	/**
	* At break in table body row.
	*
	* ```markdown
	*   | | a |
	*   | | - |
	* > | | b |
	*     ^
	*       ^
	*         ^
	* ```
	*
	* @type {State}
	*/
	function bodyRowBreak(code) {
		if (code === 124) {
			effects.enter("tableCellDivider");
			effects.consume(code);
			effects.exit("tableCellDivider");
			return bodyRowBreak;
		}
		if (code === null || markdownLineEnding(code)) {
			effects.exit("tableRow");
			return ok(code);
		}
		if (markdownSpace(code)) return factorySpace(effects, bodyRowBreak, "whitespace")(code);
		effects.enter("data");
		return bodyRowData(code);
	}
	/**
	* In table body row data.
	*
	* ```markdown
	*   | | a |
	*   | | - |
	* > | | b |
	*       ^
	* ```
	*
	* @type {State}
	*/
	function bodyRowData(code) {
		if (code === null || code === 124 || markdownLineEndingOrSpace(code)) {
			effects.exit("data");
			return bodyRowBreak(code);
		}
		effects.consume(code);
		return code === 92 ? bodyRowEscape : bodyRowData;
	}
	/**
	* In table body row escape.
	*
	* ```markdown
	*   | | a    |
	*   | | ---- |
	* > | | b\-c |
	*         ^
	* ```
	*
	* @type {State}
	*/
	function bodyRowEscape(code) {
		if (code === 92 || code === 124) {
			effects.consume(code);
			return bodyRowData;
		}
		return bodyRowData(code);
	}
}
/** @type {Resolver} */
function resolveTable(events, context) {
	let index = -1;
	let inFirstCellAwaitingPipe = true;
	/** @type {RowKind} */
	let rowKind = 0;
	/** @type {Range} */
	let lastCell = [
		0,
		0,
		0,
		0
	];
	/** @type {Range} */
	let cell = [
		0,
		0,
		0,
		0
	];
	let afterHeadAwaitingFirstBodyRow = false;
	let lastTableEnd = 0;
	/** @type {Token | undefined} */
	let currentTable;
	/** @type {Token | undefined} */
	let currentBody;
	/** @type {Token | undefined} */
	let currentCell;
	const map = new EditMap();
	while (++index < events.length) {
		const event = events[index];
		const token = event[1];
		if (event[0] === "enter") {
			if (token.type === "tableHead") {
				afterHeadAwaitingFirstBodyRow = false;
				if (lastTableEnd !== 0) {
					flushTableEnd(map, context, lastTableEnd, currentTable, currentBody);
					currentBody = void 0;
					lastTableEnd = 0;
				}
				currentTable = {
					type: "table",
					start: Object.assign({}, token.start),
					end: Object.assign({}, token.end)
				};
				map.add(index, 0, [[
					"enter",
					currentTable,
					context
				]]);
			} else if (token.type === "tableRow" || token.type === "tableDelimiterRow") {
				inFirstCellAwaitingPipe = true;
				currentCell = void 0;
				lastCell = [
					0,
					0,
					0,
					0
				];
				cell = [
					0,
					index + 1,
					0,
					0
				];
				if (afterHeadAwaitingFirstBodyRow) {
					afterHeadAwaitingFirstBodyRow = false;
					currentBody = {
						type: "tableBody",
						start: Object.assign({}, token.start),
						end: Object.assign({}, token.end)
					};
					map.add(index, 0, [[
						"enter",
						currentBody,
						context
					]]);
				}
				rowKind = token.type === "tableDelimiterRow" ? 2 : currentBody ? 3 : 1;
			} else if (rowKind && (token.type === "data" || token.type === "tableDelimiterMarker" || token.type === "tableDelimiterFiller")) {
				inFirstCellAwaitingPipe = false;
				if (cell[2] === 0) {
					if (lastCell[1] !== 0) {
						cell[0] = cell[1];
						currentCell = flushCell(map, context, lastCell, rowKind, void 0, currentCell);
						lastCell = [
							0,
							0,
							0,
							0
						];
					}
					cell[2] = index;
				}
			} else if (token.type === "tableCellDivider") {
				if (inFirstCellAwaitingPipe) inFirstCellAwaitingPipe = false;
				else {
					if (lastCell[1] !== 0) {
						cell[0] = cell[1];
						currentCell = flushCell(map, context, lastCell, rowKind, void 0, currentCell);
					}
					lastCell = cell;
					cell = [
						lastCell[1],
						index,
						0,
						0
					];
				}
			}
		} else if (token.type === "tableHead") {
			afterHeadAwaitingFirstBodyRow = true;
			lastTableEnd = index;
		} else if (token.type === "tableRow" || token.type === "tableDelimiterRow") {
			lastTableEnd = index;
			if (lastCell[1] !== 0) {
				cell[0] = cell[1];
				currentCell = flushCell(map, context, lastCell, rowKind, index, currentCell);
			} else if (cell[1] !== 0) currentCell = flushCell(map, context, cell, rowKind, index, currentCell);
			rowKind = 0;
		} else if (rowKind && (token.type === "data" || token.type === "tableDelimiterMarker" || token.type === "tableDelimiterFiller")) cell[3] = index;
	}
	if (lastTableEnd !== 0) flushTableEnd(map, context, lastTableEnd, currentTable, currentBody);
	map.consume(context.events);
	index = -1;
	while (++index < context.events.length) {
		const event = context.events[index];
		if (event[0] === "enter" && event[1].type === "table") event[1]._align = gfmTableAlign(context.events, index);
	}
	return events;
}
/**
* Generate a cell.
*
* @param {EditMap} map
* @param {Readonly<TokenizeContext>} context
* @param {Readonly<Range>} range
* @param {RowKind} rowKind
* @param {number | undefined} rowEnd
* @param {Token | undefined} previousCell
* @returns {Token | undefined}
*/
function flushCell(map, context, range, rowKind, rowEnd, previousCell) {
	const groupName = rowKind === 1 ? "tableHeader" : rowKind === 2 ? "tableDelimiter" : "tableData";
	const valueName = "tableContent";
	if (range[0] !== 0) {
		previousCell.end = Object.assign({}, getPoint(context.events, range[0]));
		map.add(range[0], 0, [[
			"exit",
			previousCell,
			context
		]]);
	}
	const now = getPoint(context.events, range[1]);
	previousCell = {
		type: groupName,
		start: Object.assign({}, now),
		end: Object.assign({}, now)
	};
	map.add(range[1], 0, [[
		"enter",
		previousCell,
		context
	]]);
	if (range[2] !== 0) {
		const relatedStart = getPoint(context.events, range[2]);
		const relatedEnd = getPoint(context.events, range[3]);
		/** @type {Token} */
		const valueToken = {
			type: valueName,
			start: Object.assign({}, relatedStart),
			end: Object.assign({}, relatedEnd)
		};
		map.add(range[2], 0, [[
			"enter",
			valueToken,
			context
		]]);
		if (rowKind !== 2) {
			const start = context.events[range[2]];
			const end = context.events[range[3]];
			start[1].end = Object.assign({}, end[1].end);
			start[1].type = "chunkText";
			start[1].contentType = "text";
			if (range[3] > range[2] + 1) {
				const a = range[2] + 1;
				const b = range[3] - range[2] - 1;
				map.add(a, b, []);
			}
		}
		map.add(range[3] + 1, 0, [[
			"exit",
			valueToken,
			context
		]]);
	}
	if (rowEnd !== void 0) {
		previousCell.end = Object.assign({}, getPoint(context.events, rowEnd));
		map.add(rowEnd, 0, [[
			"exit",
			previousCell,
			context
		]]);
		previousCell = void 0;
	}
	return previousCell;
}
/**
* Generate table end (and table body end).
*
* @param {Readonly<EditMap>} map
* @param {Readonly<TokenizeContext>} context
* @param {number} index
* @param {Token} table
* @param {Token | undefined} tableBody
*/
function flushTableEnd(map, context, index, table, tableBody) {
	/** @type {Array<Event>} */
	const exits = [];
	const related = getPoint(context.events, index);
	if (tableBody) {
		tableBody.end = Object.assign({}, related);
		exits.push([
			"exit",
			tableBody,
			context
		]);
	}
	table.end = Object.assign({}, related);
	exits.push([
		"exit",
		table,
		context
	]);
	map.add(index + 1, 0, exits);
}
/**
* @param {Readonly<Array<Event>>} events
* @param {number} index
* @returns {Readonly<Point>}
*/
function getPoint(events, index) {
	const event = events[index];
	const side = event[0] === "enter" ? "start" : "end";
	return event[1][side];
}
//#endregion
//#region ../../node_modules/micromark-extension-gfm-task-list-item/lib/syntax.js
/**
* @import {Extension, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
var tasklistCheck = {
	name: "tasklistCheck",
	tokenize: tokenizeTasklistCheck
};
/**
* Create an HTML extension for `micromark` to support GFM task list items
* syntax.
*
* @returns {Extension}
*   Extension for `micromark` that can be passed in `htmlExtensions` to
*   support GFM task list items when serializing to HTML.
*/
function gfmTaskListItem() {
	return { text: { [91]: tasklistCheck } };
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeTasklistCheck(effects, ok, nok) {
	const self = this;
	return open;
	/**
	* At start of task list item check.
	*
	* ```markdown
	* > | * [x] y.
	*       ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (self.previous !== null || !self._gfmTasklistFirstContentOfListItem) return nok(code);
		effects.enter("taskListCheck");
		effects.enter("taskListCheckMarker");
		effects.consume(code);
		effects.exit("taskListCheckMarker");
		return inside;
	}
	/**
	* In task list item check.
	*
	* ```markdown
	* > | * [x] y.
	*        ^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (markdownLineEndingOrSpace(code)) {
			effects.enter("taskListCheckValueUnchecked");
			effects.consume(code);
			effects.exit("taskListCheckValueUnchecked");
			return close;
		}
		if (code === 88 || code === 120) {
			effects.enter("taskListCheckValueChecked");
			effects.consume(code);
			effects.exit("taskListCheckValueChecked");
			return close;
		}
		return nok(code);
	}
	/**
	* At close of task list item check.
	*
	* ```markdown
	* > | * [x] y.
	*         ^
	* ```
	*
	* @type {State}
	*/
	function close(code) {
		if (code === 93) {
			effects.enter("taskListCheckMarker");
			effects.consume(code);
			effects.exit("taskListCheckMarker");
			effects.exit("taskListCheck");
			return after;
		}
		return nok(code);
	}
	/**
	* @type {State}
	*/
	function after(code) {
		if (markdownLineEnding(code)) return ok(code);
		if (markdownSpace(code)) return effects.check({ tokenize: spaceThenNonSpace }, ok, nok)(code);
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function spaceThenNonSpace(effects, ok, nok) {
	return factorySpace(effects, after, "whitespace");
	/**
	* After whitespace, after task list item check.
	*
	* ```markdown
	* > | * [x] y.
	*           ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return code === null ? nok(code) : ok(code);
	}
}
//#endregion
//#region ../../node_modules/micromark-extension-gfm/index.js
/**
* @typedef {import('micromark-extension-gfm-footnote').HtmlOptions} HtmlOptions
* @typedef {import('micromark-extension-gfm-strikethrough').Options} Options
* @typedef {import('micromark-util-types').Extension} Extension
* @typedef {import('micromark-util-types').HtmlExtension} HtmlExtension
*/
/**
* Create an extension for `micromark` to enable GFM syntax.
*
* @param {Options | null | undefined} [options]
*   Configuration (optional).
*
*   Passed to `micromark-extens-gfm-strikethrough`.
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions` to enable GFM
*   syntax.
*/
function gfm(options) {
	return combineExtensions([
		gfmAutolinkLiteral(),
		gfmFootnote(),
		gfmStrikethrough(options),
		gfmTable(),
		gfmTaskListItem()
	]);
}
//#endregion
//#region ../../node_modules/remark-gfm/lib/index.js
/**
* @import {Root} from 'mdast'
* @import {Options} from 'remark-gfm'
* @import {} from 'remark-parse'
* @import {} from 'remark-stringify'
* @import {Processor} from 'unified'
*/
/** @type {Options} */
var emptyOptions = {};
/**
* Add support GFM (autolink literals, footnotes, strikethrough, tables,
* tasklists).
*
* @param {Options | null | undefined} [options]
*   Configuration (optional).
* @returns {undefined}
*   Nothing.
*/
function remarkGfm(options) {
	const self = this;
	const settings = options || emptyOptions;
	const data = self.data();
	const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = []);
	const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = []);
	const toMarkdownExtensions = data.toMarkdownExtensions || (data.toMarkdownExtensions = []);
	micromarkExtensions.push(gfm(settings));
	fromMarkdownExtensions.push(gfmFromMarkdown());
	toMarkdownExtensions.push(gfmToMarkdown(settings));
}
//#endregion
//#region ../../packages/extension-sdk/src/helpers.ts
function unwrapBareFence(text) {
	const lines = text.split(/\r?\n/);
	const fenceRe = /^```[a-zA-Z0-9_-]*\s*$/;
	let openLine = -1;
	let closeLine = -1;
	for (let i = 0; i < lines.length; i++) if (fenceRe.test(lines[i])) {
		if (openLine === -1) openLine = i;
		closeLine = i;
	}
	if (openLine === -1 || closeLine === -1 || openLine === closeLine) return text;
	for (let i = closeLine + 1; i < lines.length; i++) if (lines[i].trim().length > 0) return text;
	const head = lines.slice(0, openLine).join("\n").trimEnd();
	if (/(^|\n)\s*(#{1,6} |[-*] |\d+\. |\| |-{3,}\s*$|={3,}\s*$)/.test(head)) return text;
	const inner = lines.slice(openLine + 1, closeLine).filter((l) => !fenceRe.test(l)).join("\n");
	if (!/(^|\n)(#{1,6} |[-*] |\| .* \||\*\*[^*]+\*\*)/.test(inner)) return text;
	return head ? `${head}\n\n${inner}` : inner;
}
//#endregion
//#region src/renderer/Markdown.tsx
/**
* In-extension markdown renderer for the zana-tickets bundle.
*
* The extension renderer is a self-contained blob-imported bundle — it cannot
* reach into core's `MarkdownContent` (that pulls in mermaid, highlight.js and
* the core util pipeline, none of which cross the extension boundary). So the
* modal renders ticket descriptions / result summaries / artifact bodies /
* comments through this lean local component instead.
*
* Styling: the panel mounts into the HOST document, so core's `global.css`
* cascades in. We reuse the shared `inbox-md` typography (headings, lists,
* code, links, tables, blockquotes, hr, strong/em) plus the `zana-md`
* size override and the `zana-md-table-wrap` scroller — the exact classes the
* pre-extraction renderer used. (An earlier version wrapped output in a bare
* `.zana-markdown` class that has NO CSS anywhere, so GFM rendered unstyled;
* see the shared-CSS coupling note in CLAUDE.md — do not delete these defs.)
*
* `react-markdown` + `remark-gfm` are BUNDLED into the extension artifact (the
* host does not inject them). `unwrapBareFence` comes from the extension SDK's
* dependency-free `helpers` module and bundles too. React itself resolves
* through the shimmed `react` alias, so there is still exactly one React
* instance.
*/
function MarkdownContent({ text }) {
	const body = unwrapBareFence(text);
	return /* @__PURE__ */ jsx("div", {
		className: "inbox-md zana-md",
		children: /* @__PURE__ */ jsx(Markdown, {
			remarkPlugins: [remarkGfm],
			components: {
				a: (props) => /* @__PURE__ */ jsx("a", {
					...props,
					target: "_blank",
					rel: "noreferrer"
				}),
				table: (props) => /* @__PURE__ */ jsx("div", {
					className: "zana-md-table-wrap",
					children: /* @__PURE__ */ jsx("table", { ...props })
				})
			},
			children: body
		})
	});
}
//#endregion
//#region src/renderer/TicketDetailModal.tsx
/**
* Detail modal for a single Zana ticket OR artifact OR profile. Opens when a
* card is clicked. A ticket renders its facts (status/priority/labels/assignee/
* sprint/blockedBy), description, result summary and comments from the
* already-loaded snapshot record — tickets are small, so the first paint is the
* lean snapshot, then it enriches with the full on-disk detail. An artifact
* lazy-loads its full markdown `content` and a profile lazy-loads its full
* detail; both soft-fail to the snapshot on error.
*
* Follows the app's modal convention (`palette-backdrop` + stop-propagation +
* Escape to close), matching GusDetailModal / ShortcutsHelp.
*
* Part of the zana-tickets DISK extension. Ticket / artifact / profile DATA is
* fetched through the `ticketsApi` seam (which reaches the `zana` built-in main
* module over the module bus); the injected `ModuleHost` supplies the shell
* affordances — `host.toast`, `host.launchSession`, and `host.getActiveProject()`
* / `host.listProjects()` for resolving the launch target. Markdown renders
* through the bundle-local {@link MarkdownContent}.
*
* Rule 5 (no per-mount IPC storm): `profileMap` is supplied by the parent (no
*   per-mount profile fetch); the lazy `getTicket`/`getArtifact`/`getProfile`
*   are single-shot on open, guarded by the `live` flag.
*/
/** Shape the modal's `{ projectPath, useGlobal }` props into a B2 `TicketSource`. */
function ticketSource(projectPath, useGlobal) {
	return useGlobal ? { kind: "global" } : {
		kind: "project",
		projectPath: projectPath ?? ""
	};
}
function fmtDateTime$1(iso) {
	if (!iso) return "";
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return "";
	return new Date(ms).toLocaleString(void 0, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit"
	});
}
function shortId(id) {
	return id.length > 8 ? id.slice(0, 8) : id;
}
function initials(name) {
	return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}
function TicketDetailModal({ host, selection, sprints, tickets, profiles, profileMap, projectPath, useGlobal, onAssign, onClose }) {
	useEffect(() => {
		const onKey = (e) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return /* @__PURE__ */ jsx("div", {
		className: "palette-backdrop",
		onMouseDown: onClose,
		children: /* @__PURE__ */ jsx("div", {
			className: "gus-modal zana-modal",
			role: "dialog",
			"aria-modal": "true",
			"aria-label": selection.kind === "ticket" ? selection.ticket.title : selection.kind === "artifact" ? selection.artifact.title : selection.profile.displayName,
			onMouseDown: (e) => e.stopPropagation(),
			children: selection.kind === "ticket" ? /* @__PURE__ */ jsx(TicketDetail, {
				host,
				ticket: selection.ticket,
				sprints,
				tickets,
				profiles,
				profileMap,
				projectPath,
				useGlobal,
				onAssign,
				onClose
			}) : selection.kind === "artifact" ? /* @__PURE__ */ jsx(ArtifactDetail, {
				artifact: selection.artifact,
				projectPath,
				useGlobal,
				onClose
			}) : /* @__PURE__ */ jsx(ProfileDetail, {
				profile: selection.profile,
				tickets,
				onClose
			})
		})
	});
}
/** Coerce an unknown detail value to a short, displayable string. */
function detailValue(v) {
	if (v == null) return "";
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}
/**
* Human rendering of an audit entry's `details`, with nice special-cases for
* the common actions and a generic key/value pill fallback for everything else.
*/
function AuditDetail({ entry }) {
	const d = entry.details ?? {};
	const action = entry.action;
	if (action === "status_changed" && ("from" in d || "to" in d)) return /* @__PURE__ */ jsxs("div", {
		className: "zana-timeline-detail",
		children: [
			d.from != null && /* @__PURE__ */ jsx("span", {
				className: "zana-status-from",
				children: detailValue(d.from)
			}),
			/* @__PURE__ */ jsx(ArrowRight, {
				size: 11,
				className: "zana-status-arrow",
				"aria-hidden": true
			}),
			/* @__PURE__ */ jsx("span", {
				className: "zana-status-to",
				children: detailValue(d.to)
			})
		]
	});
	if (action === "claimed" && "agentName" in d) return /* @__PURE__ */ jsxs("div", {
		className: "zana-timeline-detail",
		children: ["claimed by ", /* @__PURE__ */ jsx("strong", { children: detailValue(d.agentName) })]
	});
	if (action === "assigned") return /* @__PURE__ */ jsxs("div", {
		className: "zana-timeline-detail",
		children: [
			"assigned to ",
			/* @__PURE__ */ jsx("strong", { children: (d.assigneeName != null ? detailValue(d.assigneeName) : detailValue(d.profileId)) || "someone" }),
			d.from != null && detailValue(d.from) && /* @__PURE__ */ jsxs("span", {
				className: "zana-detail-pill",
				children: [/* @__PURE__ */ jsx("span", {
					className: "zana-detail-key",
					children: "from"
				}), detailValue(d.from)]
			})
		]
	});
	if (action === "unassigned") return /* @__PURE__ */ jsxs("div", {
		className: "zana-timeline-detail",
		children: ["unassigned", d.from != null && detailValue(d.from) && /* @__PURE__ */ jsxs("span", {
			className: "zana-detail-pill",
			children: [/* @__PURE__ */ jsx("span", {
				className: "zana-detail-key",
				children: "was"
			}), detailValue(d.from)]
		})]
	});
	if (action === "created") return /* @__PURE__ */ jsxs("div", {
		className: "zana-timeline-detail",
		children: ["created", d.priority != null && /* @__PURE__ */ jsx("span", {
			className: `zana-prio zana-prio--${detailValue(d.priority).toLowerCase()}`,
			children: detailValue(d.priority)
		})]
	});
	const keys = Object.keys(d);
	if (keys.length === 0) return null;
	return /* @__PURE__ */ jsx("div", {
		className: "zana-timeline-detail",
		children: keys.map((k) => /* @__PURE__ */ jsxs("span", {
			className: "zana-detail-pill",
			children: [/* @__PURE__ */ jsx("span", {
				className: "zana-detail-key",
				children: k
			}), detailValue(d[k])]
		}, k))
	});
}
/**
* Build the `claude` CLI `extraArgs` that turn a ticket + its assigned profile
* into a launchable agent session. Profile flags map 1:1 onto args the pty
* layer already understands (`pty.ts`); they're appended last so they win over
* global / project defaults. The final positional element becomes Claude's
* opening prompt (same mechanism the scheduler uses to seed a run).
*/
function buildLaunchArgs(profile, ticket) {
	const args = [];
	if (profile.model) args.push("--model", profile.model);
	if (profile.systemPrompt) args.push("--append-system-prompt", profile.systemPrompt);
	if ((profile.allowedTools ?? []).length > 0) args.push("--allowedTools", profile.allowedTools.join(","));
	if ((profile.disallowedTools ?? []).length > 0) args.push("--disallowedTools", profile.disallowedTools.join(","));
	if (profile.permissionMode) args.push("--permission-mode", profile.permissionMode);
	const who = profile.displayName || profile.id;
	const desc = ticket.description ? `\n\n${ticket.description}` : "";
	const prompt = `Work Zana ticket ${shortId(ticket.id)}: ${ticket.title}${desc}\n\nYou are acting as the "${who}" profile. Begin work on this ticket now.`;
	args.push(prompt);
	return args;
}
function TicketDetail({ host, ticket, sprints, tickets, profiles, profileMap, projectPath, useGlobal, onAssign, onClose }) {
	const toast = (msg, kind) => host.toast(msg, kind);
	const [detail, setDetail] = useState({
		...ticket,
		audit: []
	});
	const [loading, setLoading] = useState(true);
	const [assignOpen, setAssignOpen] = useState(false);
	const [localAssignee, setLocalAssignee] = useState(null);
	const [launching, setLaunching] = useState(false);
	useEffect(() => {
		let live = true;
		setLoading(true);
		ticketsApi.getTicket(ticketSource(projectPath, useGlobal), ticket.id).then((full) => {
			if (live && full) setDetail({
				...ticket,
				...full,
				audit: full.audit ?? []
			});
		}).catch(() => {}).finally(() => {
			if (live) setLoading(false);
		});
		return () => {
			live = false;
		};
	}, [
		ticket,
		projectPath,
		useGlobal
	]);
	const sprintLabel = (detail.sprintId ? sprints.find((s) => s.id === detail.sprintId) : void 0)?.name ?? (detail.sprintId ? shortId(detail.sprintId) : void 0);
	const assigneeName = localAssignee ? localAssignee.assigneeName : detail.assigneeName;
	const assigneeProfileId = localAssignee ? localAssignee.assigneeProfileId : detail.assigneeProfileId;
	const prof = profileLabel(assigneeProfileId, profileMap);
	const shownFacts = [
		["Status", detail.status],
		["Priority", detail.priority],
		["Type", detail.type],
		["Created by", detail.createdBy],
		["Sprint", sprintLabel],
		["Review phase", detail.reviewPhase],
		["Rework count", detail.reworkCount && detail.reworkCount > 0 ? String(detail.reworkCount) : void 0],
		["Created", fmtDateTime$1(detail.createdAt) || void 0],
		["Updated", fmtDateTime$1(detail.updatedAt) || void 0],
		["Closed", fmtDateTime$1(detail.closedAt) || void 0]
	].filter(([, v]) => v);
	const handleAssign = (choice) => {
		setAssignOpen(false);
		if (choice.kind === "clear") setLocalAssignee({
			assigneeName: void 0,
			assigneeProfileId: void 0
		});
		else if (choice.kind === "profile") setLocalAssignee({
			assigneeName: choice.displayName,
			assigneeProfileId: choice.profileId
		});
		else setLocalAssignee({
			assigneeName: choice.assigneeName,
			assigneeProfileId: void 0
		});
		onAssign(choice);
	};
	const targetProject = (() => {
		if (projectPath) return host.listProjects().find((p) => p.path === projectPath) ?? null;
		return host.getActiveProject();
	})();
	const canStart = !!assigneeProfileId && !!prof && !!targetProject && !loading && !launching;
	const startTitle = !assigneeProfileId ? "Assign this ticket to a profile to start it." : !prof ? "The assigned profile is unavailable." : !targetProject ? "Open this ticket's project to start it." : loading ? "Loading ticket…" : `Start with ${prof.displayName}`;
	const handleStart = async () => {
		if (!assigneeProfileId || !targetProject) return;
		setLaunching(true);
		try {
			const full = await ticketsApi.getProfile(assigneeProfileId).catch(() => null);
			if (!full) {
				toast(`Couldn't load the “${prof?.displayName ?? assigneeProfileId}” profile — not started`, "error");
				return;
			}
			const extraArgs = buildLaunchArgs(full, detail);
			if (await host.launchSession({
				projectId: targetProject.id,
				cwd: targetProject.path,
				extraArgs,
				title: `Zana: ${detail.title.slice(0, 40)}`
			})) {
				toast(`Started “${detail.title}” with ${full.displayName}`);
				onClose();
			} else toast("Couldn't start session", "error");
		} catch (err) {
			toast(`Couldn't start session — ${err instanceof Error ? err.message : String(err)}`, "error");
		} finally {
			setLaunching(false);
		}
	};
	const comments = detail.comments ?? [];
	const audit = [...detail.audit].reverse();
	const ticketTitleById = (id) => tickets.find((t) => t.id === id)?.title;
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("header", {
		className: "gus-modal-header",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "gus-modal-title",
			children: [
				/* @__PURE__ */ jsxs("span", {
					className: "gus-card-type",
					children: [/* @__PURE__ */ jsx(Ticket, {
						size: 14,
						"aria-hidden": true
					}), /* @__PURE__ */ jsx("span", { children: shortId(detail.id) })]
				}),
				detail.priority && /* @__PURE__ */ jsx("span", {
					className: `zana-prio zana-prio--${detail.priority.toLowerCase()}`,
					children: detail.priority
				}),
				detail.blockedBy.length > 0 && /* @__PURE__ */ jsxs("span", {
					className: "zana-blocked-tag",
					title: `Blocked by ${detail.blockedBy.length}`,
					children: [/* @__PURE__ */ jsx(Ban, {
						size: 11,
						"aria-hidden": true
					}), " Blocked"]
				})
			]
		}), /* @__PURE__ */ jsx("div", {
			className: "gus-modal-header-actions",
			children: /* @__PURE__ */ jsx("button", {
				type: "button",
				className: "icon-btn",
				"aria-label": "Close",
				onClick: onClose,
				children: /* @__PURE__ */ jsx(X, { size: 14 })
			})
		})]
	}), /* @__PURE__ */ jsxs("div", {
		className: "gus-modal-body",
		children: [
			/* @__PURE__ */ jsx("h3", {
				className: "gus-modal-subject",
				children: detail.title
			}),
			/* @__PURE__ */ jsx("dl", {
				className: "gus-facts",
				children: shownFacts.map(([k, v]) => /* @__PURE__ */ jsxs("div", {
					className: "gus-fact",
					children: [/* @__PURE__ */ jsx("dt", { children: k }), /* @__PURE__ */ jsx("dd", { children: v })]
				}, k))
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-action-bar",
				children: [/* @__PURE__ */ jsx("div", {
					className: "zana-action-assignee",
					children: assigneeName ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("span", {
						className: "zana-action-avatar",
						"aria-hidden": true,
						children: prof ? prof.icon : initials(assigneeName)
					}), /* @__PURE__ */ jsxs("span", {
						className: "zana-action-assignee-text",
						children: [/* @__PURE__ */ jsx("span", {
							className: "zana-action-assignee-name",
							children: assigneeName
						}), prof && /* @__PURE__ */ jsx("span", {
							className: "zana-action-assignee-sub",
							children: prof.displayName
						})]
					})] }) : /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("span", {
						className: "zana-action-avatar zana-action-avatar--empty",
						"aria-hidden": true,
						children: /* @__PURE__ */ jsx(User, { size: 13 })
					}), /* @__PURE__ */ jsx("span", {
						className: "zana-card-unassigned",
						children: "Unassigned"
					})] })
				}), /* @__PURE__ */ jsxs("div", {
					className: "zana-action-controls",
					children: [assigneeProfileId && /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: "zana-start-btn",
						onClick: handleStart,
						disabled: !canStart,
						title: startTitle,
						children: [launching ? /* @__PURE__ */ jsx(LoaderCircle, {
							size: 14,
							className: "gus-spin",
							"aria-hidden": true
						}) : /* @__PURE__ */ jsx(Play, {
							size: 14,
							"aria-hidden": true
						}), launching ? "Starting…" : "Start"]
					}), /* @__PURE__ */ jsxs("span", {
						className: "zana-assign-row-control",
						children: [/* @__PURE__ */ jsxs("button", {
							type: "button",
							className: `zana-assign-dropdown-btn ${assigneeName ? "zana-assign-dropdown-btn--secondary" : ""}`,
							onClick: (e) => {
								e.stopPropagation();
								setAssignOpen((o) => !o);
							},
							"aria-haspopup": "menu",
							"aria-expanded": assignOpen,
							children: [assigneeName ? "Reassign" : "Assign", /* @__PURE__ */ jsx(ChevronDown, {
								size: 12,
								"aria-hidden": true
							})]
						}), assignOpen && /* @__PURE__ */ jsx(AssignMenu, {
							profiles,
							onPick: handleAssign,
							onClose: () => setAssignOpen(false),
							align: "right"
						})]
					})]
				})]
			}),
			detail.labels.length > 0 && /* @__PURE__ */ jsx("div", {
				className: "zana-modal-labels",
				children: detail.labels.map((l) => /* @__PURE__ */ jsxs("span", {
					className: "zana-label-chip",
					children: [
						/* @__PURE__ */ jsx(Tag, {
							size: 10,
							"aria-hidden": true
						}),
						" ",
						l
					]
				}, l))
			}),
			detail.blockedBy.length > 0 && /* @__PURE__ */ jsxs("div", {
				className: "zana-modal-section",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "gus-modal-section-label",
					children: [/* @__PURE__ */ jsx(Ban, {
						size: 12,
						"aria-hidden": true
					}), " Blocked by"]
				}), /* @__PURE__ */ jsx("div", {
					className: "zana-modal-blocked-ids",
					children: detail.blockedBy.map((id) => {
						const title = ticketTitleById(id);
						return /* @__PURE__ */ jsxs("span", {
							className: "gus-chip zana-blocker-chip",
							title: id,
							children: [title ?? shortId(id), title && /* @__PURE__ */ jsx("span", {
								className: "zana-blocker-id",
								children: shortId(id)
							})]
						}, id);
					})
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-modal-section",
				children: [/* @__PURE__ */ jsx("div", {
					className: "gus-modal-section-label",
					children: "Description"
				}), detail.description ? /* @__PURE__ */ jsx(MarkdownContent, { text: detail.description }) : /* @__PURE__ */ jsx("div", {
					className: "gus-modal-empty",
					children: "No description."
				})]
			}),
			detail.resultSummary && /* @__PURE__ */ jsxs("div", {
				className: "zana-modal-section",
				children: [/* @__PURE__ */ jsx("div", {
					className: "gus-modal-section-label",
					children: "Result summary"
				}), /* @__PURE__ */ jsx(MarkdownContent, { text: detail.resultSummary })]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-modal-section gus-modal-chatter",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "gus-modal-section-label",
					children: [
						/* @__PURE__ */ jsx(MessageSquare, {
							size: 12,
							"aria-hidden": true
						}),
						" Comments",
						comments.length > 0 && /* @__PURE__ */ jsx("span", {
							className: "gus-chatter-count",
							children: comments.length
						})
					]
				}), comments.length === 0 ? /* @__PURE__ */ jsx("div", {
					className: "gus-modal-empty",
					children: "No comments."
				}) : /* @__PURE__ */ jsx("ul", {
					className: "gus-chatter-list",
					children: comments.map((c, i) => /* @__PURE__ */ jsxs("li", {
						className: "gus-chatter-post",
						children: [/* @__PURE__ */ jsx("div", {
							className: "gus-chatter-avatar",
							"aria-hidden": true,
							children: initials(c.author ?? "?")
						}), /* @__PURE__ */ jsxs("div", {
							className: "gus-chatter-main",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "gus-chatter-head",
								children: [/* @__PURE__ */ jsx("span", {
									className: "gus-chatter-author",
									children: c.author ?? "Unknown"
								}), /* @__PURE__ */ jsx("span", {
									className: "gus-chatter-time",
									children: fmtDateTime$1(c.createdAt)
								})]
							}), /* @__PURE__ */ jsx("div", {
								className: "gus-chatter-body",
								children: /* @__PURE__ */ jsx(MarkdownContent, { text: c.body })
							})]
						})]
					}, i))
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-modal-section",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "gus-modal-section-label",
					children: [
						/* @__PURE__ */ jsx(RotateCcwClock, {
							size: 12,
							"aria-hidden": true
						}),
						" Activity",
						audit.length > 0 && /* @__PURE__ */ jsx("span", {
							className: "gus-chatter-count",
							children: audit.length
						}),
						loading && /* @__PURE__ */ jsx(LoaderCircle, {
							size: 12,
							className: "gus-spin zana-timeline-spinner",
							"aria-label": "Loading activity"
						})
					]
				}), audit.length === 0 ? /* @__PURE__ */ jsx("div", {
					className: "gus-modal-empty",
					children: loading ? "Loading activity…" : "No activity recorded."
				}) : /* @__PURE__ */ jsx("ol", {
					className: "zana-timeline",
					children: audit.map((entry, i) => /* @__PURE__ */ jsxs("li", {
						className: "zana-timeline-item",
						children: [/* @__PURE__ */ jsx("span", {
							className: "zana-timeline-dot",
							"aria-hidden": true
						}), /* @__PURE__ */ jsxs("div", {
							className: "zana-timeline-main",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "zana-timeline-head",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "zana-timeline-action",
										children: entry.action || "event"
									}),
									entry.actor && /* @__PURE__ */ jsx("span", {
										className: "zana-timeline-actor",
										children: entry.actor
									}),
									entry.timestamp && /* @__PURE__ */ jsx("span", {
										className: "zana-timeline-time",
										children: fmtDateTime$1(entry.timestamp)
									})
								]
							}), /* @__PURE__ */ jsx(AuditDetail, { entry })]
						})]
					}, entry.id ?? i))
				})]
			})
		]
	})] });
}
function ArtifactDetail({ artifact, projectPath, useGlobal, onClose }) {
	const [content, setContent] = useState(artifact.content);
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		let live = true;
		setLoading(true);
		ticketsApi.getArtifact(ticketSource(projectPath, useGlobal), artifact.id).then((full) => {
			if (live && full && typeof full.content === "string") setContent(full.content);
		}).catch(() => {}).finally(() => {
			if (live) setLoading(false);
		});
		return () => {
			live = false;
		};
	}, [
		artifact.id,
		projectPath,
		useGlobal
	]);
	const shownFacts = [
		["Type", artifact.type],
		["Created by", artifact.createdBy],
		["Created", fmtDateTime$1(artifact.createdAt) || void 0],
		["Linked tickets", artifact.linkedTickets.length ? String(artifact.linkedTickets.length) : void 0]
	].filter(([, v]) => v);
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("header", {
		className: "gus-modal-header",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "gus-modal-title",
			children: [/* @__PURE__ */ jsxs("span", {
				className: "gus-card-type",
				children: [/* @__PURE__ */ jsx(FileText, {
					size: 14,
					"aria-hidden": true
				}), /* @__PURE__ */ jsx("span", { children: "Doc" })]
			}), artifact.type && /* @__PURE__ */ jsx("span", {
				className: "zana-type-badge",
				children: artifact.type
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: "gus-modal-header-actions",
			children: /* @__PURE__ */ jsx("button", {
				type: "button",
				className: "icon-btn",
				"aria-label": "Close",
				onClick: onClose,
				children: /* @__PURE__ */ jsx(X, { size: 14 })
			})
		})]
	}), /* @__PURE__ */ jsxs("div", {
		className: "gus-modal-body",
		children: [
			/* @__PURE__ */ jsx("h3", {
				className: "gus-modal-subject",
				children: artifact.title
			}),
			shownFacts.length > 0 && /* @__PURE__ */ jsx("dl", {
				className: "gus-facts",
				children: shownFacts.map(([k, v]) => /* @__PURE__ */ jsxs("div", {
					className: "gus-fact",
					children: [/* @__PURE__ */ jsx("dt", { children: k }), /* @__PURE__ */ jsx("dd", { children: v })]
				}, k))
			}),
			artifact.tags.length > 0 && /* @__PURE__ */ jsx("div", {
				className: "zana-modal-labels",
				children: artifact.tags.map((t) => /* @__PURE__ */ jsxs("span", {
					className: "zana-label-chip",
					children: [
						/* @__PURE__ */ jsx(Tag, {
							size: 10,
							"aria-hidden": true
						}),
						" ",
						t
					]
				}, t))
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-modal-section",
				children: [/* @__PURE__ */ jsx("div", {
					className: "gus-modal-section-label",
					children: "Content"
				}), loading && !content ? /* @__PURE__ */ jsxs("div", {
					className: "gus-modal-loading",
					children: [/* @__PURE__ */ jsx(LoaderCircle, {
						size: 14,
						className: "gus-spin"
					}), " Loading content…"]
				}) : content ? /* @__PURE__ */ jsx("div", {
					className: "zana-doc-reader",
					children: /* @__PURE__ */ jsx(MarkdownContent, { text: content })
				}) : /* @__PURE__ */ jsx("div", {
					className: "gus-modal-empty",
					children: "No content."
				})]
			})
		]
	})] });
}
/**
* Detail for one agent profile. Starts from the lean list profile (icon, name,
* origin, category, model, tool lists) so it renders instantly, then lazy-loads
* the full `ZanaProfileDetail` (system prompt, permission mode, effort level)
* via `getProfile`. Soft-fails to the lean profile on error. Also surfaces how
* many of the loaded tickets are assigned to this profile — tying the profile
* back to the board. Read-only.
*/
function ProfileDetail({ profile, tickets, onClose }) {
	const [detail, setDetail] = useState({ ...profile });
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		let live = true;
		setLoading(true);
		setDetail({ ...profile });
		ticketsApi.getProfile(profile.id).then((full) => {
			if (live && full) setDetail({
				...profile,
				...full
			});
		}).catch(() => {}).finally(() => {
			if (live) setLoading(false);
		});
		return () => {
			live = false;
		};
	}, [profile]);
	const assignedCount = tickets.filter((t) => t.assigneeProfileId === profile.id).length;
	const allowed = detail.allowedTools ?? [];
	const disallowed = detail.disallowedTools ?? [];
	const shownFacts = [
		["Origin", detail.origin === "workspace" ? "Workspace" : "Built-in"],
		["Category", detail.category],
		["Model", detail.model],
		["Permission mode", detail.permissionMode],
		["Effort", detail.effortLevel],
		["Tickets assigned", assignedCount > 0 ? String(assignedCount) : void 0]
	].filter(([, v]) => v);
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("header", {
		className: "gus-modal-header",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "gus-modal-title",
			children: [
				/* @__PURE__ */ jsx("span", {
					className: "zana-profile-modal-icon",
					"aria-hidden": true,
					children: detail.icon ?? "🤖"
				}),
				/* @__PURE__ */ jsx("span", {
					className: `zana-profile-origin zana-profile-origin--${detail.origin}`,
					title: detail.origin === "workspace" ? "Workspace profile" : "Zana built-in profile",
					children: detail.origin === "workspace" ? "Workspace" : "Built-in"
				}),
				detail.model && /* @__PURE__ */ jsxs("span", {
					className: "zana-type-badge zana-profile-model",
					children: [
						/* @__PURE__ */ jsx(Cpu, {
							size: 11,
							"aria-hidden": true
						}),
						" ",
						detail.model
					]
				})
			]
		}), /* @__PURE__ */ jsx("div", {
			className: "gus-modal-header-actions",
			children: /* @__PURE__ */ jsx("button", {
				type: "button",
				className: "icon-btn",
				"aria-label": "Close",
				onClick: onClose,
				children: /* @__PURE__ */ jsx(X, { size: 14 })
			})
		})]
	}), /* @__PURE__ */ jsxs("div", {
		className: "gus-modal-body",
		children: [
			/* @__PURE__ */ jsx("h3", {
				className: "gus-modal-subject",
				children: detail.displayName
			}),
			detail.description && /* @__PURE__ */ jsx("p", {
				className: "zana-profile-desc",
				children: detail.description
			}),
			shownFacts.length > 0 && /* @__PURE__ */ jsx("dl", {
				className: "gus-facts",
				children: shownFacts.map(([k, v]) => /* @__PURE__ */ jsxs("div", {
					className: "gus-fact",
					children: [/* @__PURE__ */ jsx("dt", { children: k }), /* @__PURE__ */ jsx("dd", { children: v })]
				}, k))
			}),
			(allowed.length > 0 || disallowed.length > 0) && /* @__PURE__ */ jsxs("div", {
				className: "zana-modal-section",
				children: [
					/* @__PURE__ */ jsx("div", {
						className: "gus-modal-section-label",
						children: "Tools"
					}),
					allowed.length > 0 && /* @__PURE__ */ jsxs("div", {
						className: "zana-profile-tools",
						children: [/* @__PURE__ */ jsxs("span", {
							className: "zana-profile-tools-label",
							children: [/* @__PURE__ */ jsx(CircleCheck, {
								size: 12,
								"aria-hidden": true
							}), " Allowed"]
						}), /* @__PURE__ */ jsx("div", {
							className: "zana-profile-tool-chips",
							children: allowed.map((t) => /* @__PURE__ */ jsx("span", {
								className: "zana-label-chip zana-tool-chip zana-tool-chip--allow",
								children: t
							}, t))
						})]
					}),
					disallowed.length > 0 && /* @__PURE__ */ jsxs("div", {
						className: "zana-profile-tools",
						children: [/* @__PURE__ */ jsxs("span", {
							className: "zana-profile-tools-label",
							children: [/* @__PURE__ */ jsx(CircleX, {
								size: 12,
								"aria-hidden": true
							}), " Denied"]
						}), /* @__PURE__ */ jsx("div", {
							className: "zana-profile-tool-chips",
							children: disallowed.map((t) => /* @__PURE__ */ jsx("span", {
								className: "zana-label-chip zana-tool-chip zana-tool-chip--deny",
								children: t
							}, t))
						})]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-modal-section",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "gus-modal-section-label",
					children: ["System prompt", loading && /* @__PURE__ */ jsx(LoaderCircle, {
						size: 12,
						className: "gus-spin zana-timeline-spinner",
						"aria-label": "Loading system prompt"
					})]
				}), detail.systemPrompt ? /* @__PURE__ */ jsx("pre", {
					className: "zana-profile-prompt",
					children: detail.systemPrompt
				}) : /* @__PURE__ */ jsx("div", {
					className: "gus-modal-empty",
					children: loading ? "Loading system prompt…" : "No system prompt."
				})]
			})
		]
	})] });
}
//#endregion
//#region src/renderer/ProfilesView.tsx
/**
* ProfilesView — the agent-profiles gallery for the Tickets view's Profiles
* sub-tab (C5). A count summary (total · built-in · workspace) above a gallery
* of profile cards, grouped by category with section headers. The backend
* returns ALL profiles (workspace + built-in) already sorted, so we keep that
* order and just bucket by category for the headers. Clicking (or Enter/Space
* on) a card opens the profile detail. Read-only.
*
* Profiles are deliberately GLOBAL (`~/.zana/profiles` + Zana's built-ins,
* resolved by `listProfiles` with NO project arg). They are the single
* legitimately-global surface inside the otherwise strictly per-project Tickets
* view; the assigned-count badge, by contrast, is scoped to the CURRENT
* project's tickets — so it reads "N assigned in THIS project."
*
* Pure presentational: data arrives via props from the B3 `useTickets` store
* (the global `profiles` slice + this project's `tickets`). This component calls
* NO `ticketsApi`, fires NO `useEffect` fetch, and holds NO local profiles
* `useState` — the store owns the single fetch (Rule 5 / IPC-storm guard).
*
* Rule 6: imports core shared types ONLY — no `getHost`, no `window.cc.modules`,
*   no `'zana'` module-id literal. (The `zana-profile-*` CSS class names and the
*   `~/.zana/profiles/` empty-state path string contain the substring `zana`
*   legitimately — they are styling / user-facing copy, not a module-id in logic.)
*
* Ported verbatim from `plugins/zana/renderer/ZanaPanel.tsx` (ProfilesView +
* ProfileCard) into CORE; the live source rail / global-source toggle is NOT
* carried over (the product decision drops the per-project Global rail).
*/
/**
* Card-activation keyboard handler: Enter/Space activate (and suppress the
* default scroll/submit), every other key is ignored. Exported so the card's
* keyboard behaviour is unit-testable without a DOM harness (this repo ships
* none); the card's `onClick` is the trivial direct call to `onOpen`.
*/
function activateOnKey(e, onActivate) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		onActivate();
	}
}
function ProfilesView({ profiles, tickets, onOpen }) {
	const assignedByProfile = useMemo(() => {
		const m = /* @__PURE__ */ new Map();
		for (const t of tickets) if (t.assigneeProfileId) m.set(t.assigneeProfileId, (m.get(t.assigneeProfileId) ?? 0) + 1);
		return m;
	}, [tickets]);
	const builtinCount = profiles.filter((p) => p.origin === "builtin").length;
	const workspaceCount = profiles.filter((p) => p.origin === "workspace").length;
	const groups = useMemo(() => {
		const map = /* @__PURE__ */ new Map();
		for (const p of profiles) {
			const key = p.category && p.category.trim() ? p.category : "Uncategorized";
			(map.get(key) ?? map.set(key, []).get(key)).push(p);
		}
		return [...map.entries()];
	}, [profiles]);
	if (profiles.length === 0) return /* @__PURE__ */ jsx("div", {
		className: "zana-profiles-view",
		children: /* @__PURE__ */ jsxs("div", {
			className: "gus-column-empty",
			children: [
				"No profiles found. Profiles live in ",
				/* @__PURE__ */ jsx("code", { children: "~/.zana/profiles/" }),
				" plus Zana's built-ins."
			]
		})
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "zana-profiles-view",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "zana-profiles-summary",
			children: [
				/* @__PURE__ */ jsx("strong", { children: profiles.length }),
				" ",
				profiles.length === 1 ? "profile" : "profiles",
				builtinCount > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
					" · ",
					builtinCount,
					" built-in"
				] }),
				workspaceCount > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [" · ", /* @__PURE__ */ jsxs("span", {
					className: "zana-profiles-summary-ws",
					children: [workspaceCount, " workspace"]
				})] })
			]
		}), groups.map(([category, items]) => /* @__PURE__ */ jsxs("section", {
			className: "zana-profile-group",
			children: [groups.length > 1 && /* @__PURE__ */ jsxs("div", {
				className: "zana-profile-group-head",
				children: [/* @__PURE__ */ jsx("span", {
					className: "zana-profile-group-title",
					children: category
				}), /* @__PURE__ */ jsx("span", {
					className: "zana-profile-group-count",
					children: items.length
				})]
			}), /* @__PURE__ */ jsx("div", {
				className: "zana-profile-grid",
				children: items.map((p) => /* @__PURE__ */ jsx(ProfileCard, {
					profile: p,
					assignedCount: assignedByProfile.get(p.id) ?? 0,
					onOpen: () => onOpen(p)
				}, p.id))
			})]
		}, category))]
	});
}
/** One profile card in the gallery: icon, name, category chip, origin badge, clamped description. */
function ProfileCard({ profile, assignedCount, onOpen }) {
	const isWorkspace = profile.origin === "workspace";
	return /* @__PURE__ */ jsxs("article", {
		className: "zana-profile-card",
		onClick: onOpen,
		role: "button",
		tabIndex: 0,
		onKeyDown: (e) => activateOnKey(e, onOpen),
		title: `${profile.displayName} — click for details`,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "zana-profile-card-top",
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "zana-profile-card-icon",
						"aria-hidden": true,
						children: profile.icon ?? "🤖"
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "zana-profile-card-id",
						children: [/* @__PURE__ */ jsx("h3", {
							className: "zana-profile-card-name",
							children: profile.displayName
						}), profile.category && /* @__PURE__ */ jsx("span", {
							className: "zana-profile-cat",
							children: profile.category
						})]
					}),
					/* @__PURE__ */ jsx("span", {
						className: `zana-profile-origin zana-profile-origin--${profile.origin}`,
						title: isWorkspace ? "Workspace profile" : "Zana built-in profile",
						children: isWorkspace ? "Workspace" : "Built-in"
					})
				]
			}),
			profile.description && /* @__PURE__ */ jsx("p", {
				className: "zana-profile-card-desc",
				children: profile.description
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-profile-card-meta",
				children: [profile.model && /* @__PURE__ */ jsx("span", {
					className: "zana-label-chip",
					children: profile.model
				}), assignedCount > 0 && /* @__PURE__ */ jsxs("span", {
					className: "gus-chip",
					title: "Tickets assigned to this profile",
					children: [assignedCount, " assigned"]
				})]
			})
		]
	});
}
//#endregion
//#region src/renderer/format.ts
/**
* Doc-metadata date formatting (created/updated dates in the Docs reading-list).
* Mirrors the legacy panel's doc formatter (`ZanaPanel.tsx:126-135`): a compact
* `Mon D, YYYY` form with no time component. Empty string for missing/invalid.
*/
function fmtDateTime(iso) {
	if (!iso) return "";
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return "";
	return new Date(ms).toLocaleString(void 0, {
		month: "short",
		day: "numeric",
		year: "numeric"
	});
}
/**
* Derive a short plain-text preview from a markdown doc body: strip the common
* markdown syntax (headings, emphasis, code fences/spans, link syntax, images,
* blockquotes, list bullets), collapse whitespace, and clip to ~180 chars. This
* is intentionally lightweight — it gives docs a readable excerpt, not a faithful
* render (the modal does the real rendering). Lifted from `ZanaPanel.tsx:144-166`.
*/
function excerptFromMarkdown(md, max = 180) {
	if (!md) return "";
	let text = md;
	text = text.replace(/```[\s\S]*?```/g, " ");
	text = text.replace(/~~~[\s\S]*?~~~/g, " ");
	text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
	text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	text = text.replace(/[`*_~]+/g, "");
	text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
	text = text.replace(/^[ \t]*>[ \t]?/gm, "");
	text = text.replace(/^[ \t]*[-*+][ \t]+/gm, "");
	text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, "");
	text = text.replace(/\|/g, " ");
	text = text.replace(/\s+/g, " ").trim();
	if (text.length <= max) return text;
	return `${text.slice(0, max).trimEnd()}…`;
}
//#endregion
//#region src/renderer/SprintsList.tsx
/**
* SprintsList (C3) — the Sprints sub-tab. Lifted from `ZanaPanel.tsx:923-952`.
* Prop-driven + testable: the view does the `useTickets((s) => s.sprints)` read
* and passes `sprints`; the row click forwards to `onOpenSprint(s.id)` instead of
* inlining the legacy `setSprintFilter + selectTab` pair (the view binds that to
* the store's `openSprint` action).
*
* Sprint label is the RAW `s.name ?? shortId(s.id)` — deliberately NOT routed
* through `resolveSprintName` (that synthetic-`Sprint <hash>` suppression is a
* ticket-CARD concern; the Sprints list shows the raw name).
*
* Rule 6: B1 shared types + the pure `shortId` helper only — no host / module
*   bus / `'zana'` literal. Rule 5: renders store-resident `sprints`; no fetch.
*/
function SprintsList({ sprints, onOpenSprint }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "zana-list",
		children: [sprints.length === 0 && /* @__PURE__ */ jsx("div", {
			className: "gus-column-empty",
			children: "No sprints."
		}), sprints.map((s) => /* @__PURE__ */ jsxs("button", {
			type: "button",
			className: "zana-sprint-row",
			onClick: () => onOpenSprint(s.id),
			title: "View this sprint's tickets",
			children: [/* @__PURE__ */ jsxs("div", {
				className: "zana-sprint-main",
				children: [/* @__PURE__ */ jsx("span", {
					className: "zana-sprint-name",
					children: s.name ?? shortId$1(s.id)
				}), s.status && /* @__PURE__ */ jsx("span", {
					className: "gus-chip",
					children: s.status
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "zana-sprint-counts",
				children: [/* @__PURE__ */ jsxs("span", {
					className: "zana-sprint-count",
					children: [
						/* @__PURE__ */ jsx(CircleDot, {
							size: 12,
							"aria-hidden": true
						}),
						" ",
						s.openCount ?? 0,
						" open"
					]
				}), /* @__PURE__ */ jsxs("span", {
					className: "zana-sprint-count",
					children: [s.ticketCount ?? 0, " total"]
				})]
			})]
		}, s.id))]
	});
}
//#endregion
//#region src/renderer/ArtifactCard.tsx
/**
* ArtifactCard (C3) — a document reading-list entry for the Docs sub-tab.
*
* Lifted verbatim from `ZanaPanel.tsx:1200-1259`. Unlike the ticket kanban card,
* this reads like a library item: a doc icon + prominent wrapping title, a type
* label, a plain-text excerpt derived from the markdown body, and a metadata row
* (created date · author · linked-ticket count). Tags trail as subtle chips.
*
* Rule 6: imports only B1 shared types + pure `format` helpers — no module bus,
*   no host accessor, no `'zana'` literal. `onOpen` is a plain
*   `(a: ZanaArtifact) => void`; the `{ kind: 'artifact' }` `ZanaSelection`
*   literal is constructed by the view (C2 shell), never here — this keeps the
*   C4-owned selection union out of C3 and avoids a C3↔C4 import cycle.
*/
function ArtifactCard({ artifact, onOpen }) {
	const created = fmtDateTime(artifact.createdAt);
	const excerpt = excerptFromMarkdown(artifact.content);
	const linked = artifact.linkedTickets.length;
	return /* @__PURE__ */ jsxs("article", {
		className: "zana-doc-item",
		onClick: () => onOpen(artifact),
		role: "button",
		tabIndex: 0,
		onKeyDown: (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onOpen(artifact);
			}
		},
		title: `${artifact.title} — click to read`,
		children: [/* @__PURE__ */ jsx("div", {
			className: "zana-doc-icon",
			"aria-hidden": true,
			children: /* @__PURE__ */ jsx(BookOpen, { size: 18 })
		}), /* @__PURE__ */ jsxs("div", {
			className: "zana-doc-body",
			children: [
				/* @__PURE__ */ jsxs("div", {
					className: "zana-doc-head",
					children: [/* @__PURE__ */ jsx("h3", {
						className: "zana-doc-title",
						children: artifact.title
					}), artifact.type && /* @__PURE__ */ jsx("span", {
						className: "zana-doc-type",
						children: artifact.type
					})]
				}),
				excerpt && /* @__PURE__ */ jsx("p", {
					className: "zana-doc-excerpt",
					children: excerpt
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "zana-doc-meta",
					children: [
						created && /* @__PURE__ */ jsxs("span", {
							className: "zana-doc-meta-item",
							children: [
								/* @__PURE__ */ jsx(CalendarRange, {
									size: 11,
									"aria-hidden": true
								}),
								" ",
								created
							]
						}),
						artifact.createdBy && /* @__PURE__ */ jsxs("span", {
							className: "zana-doc-meta-item",
							children: [
								/* @__PURE__ */ jsx(User, {
									size: 11,
									"aria-hidden": true
								}),
								" ",
								artifact.createdBy
							]
						}),
						linked > 0 && /* @__PURE__ */ jsxs("span", {
							className: "zana-doc-meta-item zana-doc-linked",
							title: "Linked tickets",
							children: [
								/* @__PURE__ */ jsx(Link2, {
									size: 11,
									"aria-hidden": true
								}),
								" ",
								linked,
								" linked ",
								linked === 1 ? "ticket" : "tickets"
							]
						})
					]
				}),
				artifact.tags.length > 0 && /* @__PURE__ */ jsxs("div", {
					className: "zana-doc-tags",
					children: [artifact.tags.slice(0, 5).map((t) => /* @__PURE__ */ jsxs("span", {
						className: "zana-label-chip",
						children: [
							/* @__PURE__ */ jsx(Tag, {
								size: 9,
								"aria-hidden": true
							}),
							" ",
							t
						]
					}, t)), artifact.tags.length > 5 && /* @__PURE__ */ jsxs("span", {
						className: "gus-chip",
						children: ["+", artifact.tags.length - 5]
					})]
				})
			]
		})]
	});
}
//#endregion
//#region src/renderer/DocsList.tsx
function DocsList({ artifacts, onOpen }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "zana-doc-list",
		children: [artifacts.length === 0 && /* @__PURE__ */ jsx("div", {
			className: "gus-column-empty",
			children: "No docs."
		}), artifacts.map((a) => /* @__PURE__ */ jsx(ArtifactCard, {
			artifact: a,
			onOpen
		}, a.id))]
	});
}
//#endregion
//#region src/renderer/ProjectTicketsView.tsx
/**
* ProjectTicketsView — the zana-tickets extension's per-project Tickets panel.
*
* The extension's projectTab panel: core mounts it with an injected
* {@link ModuleHost} whose {@link ModuleHost.getActiveProject} returns the
* project this tab is scoped to. All ticket/sprint/artifact DATA comes from the
* `useTickets` store (keyed by `project.id`), which fetches through `ticketsApi`
* → the `zana` built-in main module. The panel owns nothing stateful except
* local UI ephemera (text filter, open assign-menu id, per-column collapse
* overrides, a detail-modal selection stub).
*
* Scope: PER-PROJECT — it scopes to the ONE active project (`{ kind: 'project' }`);
*   there is no source rail / Global concept. `host.getActiveProject()` is the
*   single source of scope. `project.path` is an ADVISORY hint forwarded to the
*   store → main, which re-resolves it (and may throw) — path trust stays in main.
*
* The 30s auto-refresh tick lives in the store (one app-lifetime tick), not here;
* `ensure` is store-de-duped, so a tab-switch remount is a cache hit (no per-mount
* IPC storm). `columns`/`filtered` memos keep the substance-sort off the render
* hot path.
*/
function ProjectTicketsView({ host }) {
	const project = host.getActiveProject();
	if (!project) return /* @__PURE__ */ jsx("section", {
		className: "gus-panel zana-panel",
		children: /* @__PURE__ */ jsx("div", {
			className: "empty-workspace overlay",
			children: /* @__PURE__ */ jsxs("div", {
				className: "empty-inner",
				children: [/* @__PURE__ */ jsx("h3", { children: "No project selected" }), /* @__PURE__ */ jsx("p", { children: "Open a project to see its Zana tickets." })]
			})
		})
	});
	return /* @__PURE__ */ jsx(TicketsBoard, {
		host,
		project
	});
}
/**
* The board proper — split out so the top-level panel can early-return on a null
* active project WITHOUT calling hooks conditionally (the board's many hooks all
* run unconditionally once a project is resolved).
*/
function TicketsBoard({ host, project }) {
	const key = useMemo(() => ({
		projectId: project.id,
		projectPath: project.path
	}), [project.id, project.path]);
	const ensure = useTickets((s) => s.ensure);
	const applyAssign = useTickets((s) => s.applyAssign);
	const initProjectAction = useTickets((s) => s.initProject);
	useEffect(() => {
		ensure(key);
	}, [ensure, key]);
	const [initState, setInitState] = useState({
		pending: false,
		error: null
	});
	const onInitProject = async () => {
		setInitState({
			pending: true,
			error: null
		});
		try {
			await initProjectAction(key);
			setInitState({
				pending: false,
				error: null
			});
		} catch (err) {
			setInitState({
				pending: false,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	};
	const activeSubTab = useTickets((s) => s.subTab);
	const setActiveSubTab = useTickets((s) => s.setSubTab);
	const sprintFilter = useTickets((s) => s.sprintFilter);
	const setSprintFilter = useTickets((s) => s.setSprintFilter);
	const openSprint = useTickets((s) => s.openSprint);
	const toggleColumnCollapsedAction = useTickets((s) => s.toggleColumnCollapsed);
	const boardDensity = useTickets((s) => s.boardDensity);
	const setBoardDensity = useTickets((s) => s.setBoardDensity);
	const entry = useTicketsEntry(key);
	const kpis = useTicketsKpis(key);
	const snapshot = entry?.snapshot ?? null;
	const loading = entry?.loading ?? false;
	const error = entry?.error ?? null;
	const [query, setQuery] = useState("");
	const [assigneeFilter, setAssigneeFilter] = useState(null);
	const collapsedOverrides = entry?.collapsedColumns ?? {};
	const [selected, setSelected] = useState(null);
	const tickets = snapshot?.tickets ?? [];
	const sprints = snapshot?.sprints ?? [];
	const artifacts = snapshot?.artifacts ?? [];
	const profiles = entry?.profiles ?? [];
	const profileMap = useMemo(() => buildProfileMap(profiles), [profiles]);
	const profileByName = useMemo(() => {
		const map = /* @__PURE__ */ new Map();
		for (const p of profiles) if (p && typeof p.displayName === "string") map.set(p.displayName, p);
		return map;
	}, [profiles]);
	const assignees = useMemo(() => extractAssignees(tickets), [tickets]);
	const filtered = useMemo(() => filterTickets(tickets, query, sprintFilter, assigneeFilter), [
		tickets,
		query,
		sprintFilter,
		assigneeFilter
	]);
	const columns = useMemo(() => buildColumns(filtered), [filtered]);
	const isColumnCollapsed = (status) => {
		const k = status.trim().toLowerCase();
		return collapsedOverrides[k] ?? isTerminalStatus(status);
	};
	const toggleColumnCollapsed = (status) => toggleColumnCollapsedAction(key, status, isTerminalStatus(status));
	const onAssign = (ticket, choice) => applyAssign(key, ticket, choice);
	const openTicket = (t) => setSelected({
		kind: "ticket",
		ticket: t
	});
	const openProfile = (p) => setSelected({
		kind: "profile",
		profile: p
	});
	const openArtifact = (a) => setSelected({
		kind: "artifact",
		artifact: a
	});
	const isEmpty = !loading && !error && isSnapshotEmpty(snapshot);
	const isUninitialized = isEmpty && snapshot != null && !snapshot.isInitialized;
	const subTabBar = /* @__PURE__ */ jsxs("div", {
		className: "zana-tabs",
		role: "tablist",
		children: [
			[
				"tickets",
				"sprints",
				"docs",
				"profiles"
			].map((tab) => /* @__PURE__ */ jsxs("button", {
				type: "button",
				role: "tab",
				"aria-selected": activeSubTab === tab,
				className: `zana-tab ${activeSubTab === tab ? "active" : ""}`,
				onClick: () => setActiveSubTab(tab),
				children: [tab === "profiles" && /* @__PURE__ */ jsx(Users, {
					size: 13,
					"aria-hidden": true
				}), tab === "tickets" ? "Tickets" : tab === "sprints" ? "Sprints" : tab === "docs" ? "Docs" : "Profiles"]
			}, tab)),
			sprintFilter && activeSubTab === "tickets" && /* @__PURE__ */ jsxs("button", {
				type: "button",
				className: "zana-sprint-filter-clear",
				onClick: () => setSprintFilter(null),
				children: [
					"Sprint: ",
					sprints.find((s) => s.id === sprintFilter)?.name ?? shortId$1(sprintFilter),
					/* @__PURE__ */ jsx(X, { size: 11 })
				]
			}),
			activeSubTab === "tickets" && /* @__PURE__ */ jsxs("div", {
				className: "zana-density-switch zana-tabs-density",
				role: "group",
				"aria-label": "Board layout",
				children: [/* @__PURE__ */ jsx("button", {
					type: "button",
					className: `zana-density-btn ${boardDensity === "card" ? "active" : ""}`,
					onClick: () => setBoardDensity("card"),
					"aria-pressed": boardDensity === "card",
					title: "Show all columns as cards",
					children: /* @__PURE__ */ jsx(LayoutGrid, {
						size: 13,
						"aria-hidden": true
					})
				}), /* @__PURE__ */ jsx("button", {
					type: "button",
					className: `zana-density-btn ${boardDensity === "list" ? "active" : ""}`,
					onClick: () => setBoardDensity("list"),
					"aria-pressed": boardDensity === "list",
					title: "Show all columns as a dense list",
					children: /* @__PURE__ */ jsx(List, {
						size: 13,
						"aria-hidden": true
					})
				})]
			}),
			activeSubTab === "tickets" && /* @__PURE__ */ jsxs("div", {
				className: "zana-tabs-search gus-search",
				title: "Filter by title, labels & assignee",
				children: [
					/* @__PURE__ */ jsx(Search, {
						size: 13,
						className: "gus-search-icon",
						"aria-hidden": true
					}),
					/* @__PURE__ */ jsx("input", {
						type: "text",
						placeholder: "Filter tickets…",
						value: query,
						onChange: (e) => setQuery(e.target.value),
						"aria-label": "Filter tickets by title, labels and assignee"
					}),
					query && /* @__PURE__ */ jsx("button", {
						type: "button",
						className: "gus-search-clear",
						"aria-label": "Clear filter",
						onClick: () => setQuery(""),
						children: /* @__PURE__ */ jsx(X, { size: 12 })
					})
				]
			})
		]
	});
	if (error) return /* @__PURE__ */ jsx("section", {
		className: "gus-panel zana-panel",
		children: /* @__PURE__ */ jsxs("div", {
			className: "gus-error",
			role: "alert",
			children: [/* @__PURE__ */ jsx(CircleAlert, { size: 16 }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: "Couldn't load Zana data." }), /* @__PURE__ */ jsx("p", { children: error })] })]
		})
	});
	if (loading && !snapshot) return /* @__PURE__ */ jsx("section", {
		className: "gus-panel zana-panel",
		children: /* @__PURE__ */ jsx("div", {
			className: "gus-loading",
			children: "Loading Zana data…"
		})
	});
	if (isEmpty) return /* @__PURE__ */ jsxs("section", {
		className: "gus-panel zana-panel",
		children: [
			subTabBar,
			activeSubTab === "profiles" ? /* @__PURE__ */ jsx(ProfilesView, {
				profiles,
				tickets,
				onOpen: openProfile
			}) : /* @__PURE__ */ jsx("div", {
				className: "empty-workspace overlay",
				children: /* @__PURE__ */ jsx("div", {
					className: "empty-inner",
					children: isUninitialized ? /* @__PURE__ */ jsxs(Fragment, { children: [
						/* @__PURE__ */ jsx("h3", { children: "No Zana data for this project" }),
						/* @__PURE__ */ jsxs("p", { children: [
							"Zana stores tickets, sprints and docs under ",
							/* @__PURE__ */ jsx("code", { children: ".zana/" }),
							" — initialize it for",
							" ",
							project.name,
							", or run Zana there to populate this board."
						] }),
						/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "zana-start-btn",
							onClick: onInitProject,
							disabled: initState.pending,
							children: initState.pending ? "Initializing…" : "Init Zana"
						}),
						initState.error && /* @__PURE__ */ jsx("p", {
							className: "gus-error",
							role: "alert",
							children: initState.error
						})
					] }) : /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("h3", { children: "No tickets yet" }), /* @__PURE__ */ jsxs("p", { children: [
						project.name,
						"'s ",
						/* @__PURE__ */ jsx("code", { children: ".zana/" }),
						" workspace is initialized but empty — create a ticket or run Zana there to populate this board."
					] })] })
				})
			}),
			selected && /* @__PURE__ */ jsx(TicketDetailModal, {
				host,
				selection: selected,
				sprints,
				tickets,
				profiles,
				profileMap,
				projectPath: project.path,
				useGlobal: false,
				onAssign: (choice) => {
					if (selected.kind === "ticket") onAssign(selected.ticket, choice);
				},
				onClose: () => setSelected(null)
			})
		]
	});
	return /* @__PURE__ */ jsxs("section", {
		className: "gus-panel zana-panel",
		children: [
			kpis && /* @__PURE__ */ jsxs("div", {
				className: "zana-kpi-strip",
				children: [
					/* @__PURE__ */ jsx(KpiCard, {
						icon: /* @__PURE__ */ jsx(CircleDot, { size: 15 }),
						label: "Open",
						value: kpis.openTickets,
						tone: "open"
					}),
					/* @__PURE__ */ jsx(KpiCard, {
						icon: /* @__PURE__ */ jsx(CircleCheck, { size: 15 }),
						label: "Closed",
						value: kpis.closedTickets,
						tone: "done"
					}),
					/* @__PURE__ */ jsx(KpiCard, {
						icon: /* @__PURE__ */ jsx(Ban, { size: 15 }),
						label: "Blocked",
						value: kpis.blockedTickets,
						tone: "blocked"
					}),
					/* @__PURE__ */ jsx(KpiCard, {
						icon: /* @__PURE__ */ jsx(Activity, { size: 15 }),
						label: "Throughput 7d",
						value: kpis.throughput7d ?? 0
					}),
					/* @__PURE__ */ jsx(KpiCard, {
						icon: /* @__PURE__ */ jsx(CalendarRange, { size: 15 }),
						label: "Sprints",
						value: kpis.sprintCount
					}),
					/* @__PURE__ */ jsx(KpiCard, {
						icon: /* @__PURE__ */ jsx(FileText, { size: 15 }),
						label: "Docs",
						value: kpis.artifactCount
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "zana-kpi-breakdowns",
						children: [/* @__PURE__ */ jsx(Breakdown, {
							title: "By status",
							counts: kpis.byStatus
						}), /* @__PURE__ */ jsx(Breakdown, {
							title: "By priority",
							counts: kpis.byPriority
						})]
					})
				]
			}),
			subTabBar,
			activeSubTab === "profiles" && /* @__PURE__ */ jsx(ProfilesView, {
				profiles,
				tickets,
				onOpen: openProfile
			}),
			activeSubTab === "sprints" && /* @__PURE__ */ jsx(SprintsList, {
				sprints,
				onOpenSprint: openSprint
			}),
			activeSubTab === "docs" && /* @__PURE__ */ jsx(DocsList, {
				artifacts,
				onOpen: openArtifact
			}),
			activeSubTab === "tickets" && assignees.length > 0 && /* @__PURE__ */ jsxs("div", {
				className: "zana-assignee-bar",
				role: "group",
				"aria-label": "Filter by assignee",
				children: [
					/* @__PURE__ */ jsxs("button", {
						type: "button",
						className: `zana-assignee-chip ${assigneeFilter === null ? "active" : ""}`,
						onClick: () => setAssigneeFilter(null),
						children: [/* @__PURE__ */ jsx(Users, {
							size: 12,
							"aria-hidden": true
						}), " All"]
					}),
					assignees.map((name) => {
						const prof = profileByName.get(name);
						return /* @__PURE__ */ jsxs("button", {
							type: "button",
							className: `zana-assignee-chip ${assigneeFilter === name ? "active" : ""}`,
							onClick: () => setAssigneeFilter(assigneeFilter === name ? null : name),
							children: [/* @__PURE__ */ jsx("span", {
								className: "zana-assignee-chip-avatar",
								style: { background: avatarColor(name) },
								"aria-hidden": true,
								children: prof ? prof.icon : initials$1(name)
							}), name]
						}, name);
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						className: `zana-assignee-chip ${assigneeFilter === "__unassigned__" ? "active" : ""}`,
						onClick: () => setAssigneeFilter(assigneeFilter === "__unassigned__" ? null : "__unassigned__"),
						children: "Unassigned"
					})
				]
			}),
			activeSubTab === "tickets" && /* @__PURE__ */ jsx("div", {
				className: "zana-content",
				children: /* @__PURE__ */ jsx("div", {
					className: "gus-content",
					children: /* @__PURE__ */ jsxs("div", {
						className: "gus-board zana-board",
						children: [columns.length === 0 && /* @__PURE__ */ jsx("div", {
							className: "gus-column-empty",
							children: "No tickets match."
						}), columns.map(([status, items]) => {
							const collapsed = isColumnCollapsed(status);
							const terminal = isTerminalStatus(status);
							return /* @__PURE__ */ jsxs("div", {
								className: `gus-column zana-column ${collapsed ? "is-collapsed" : ""} ${terminal ? "zana-column--terminal" : ""}`,
								children: [/* @__PURE__ */ jsxs("button", {
									type: "button",
									className: "gus-column-head zana-column-head-btn",
									onClick: () => toggleColumnCollapsed(status),
									"aria-expanded": !collapsed,
									title: collapsed ? `Expand ${status}` : `Collapse ${status}`,
									children: [/* @__PURE__ */ jsxs("span", {
										className: "zana-column-head-left",
										children: [collapsed ? /* @__PURE__ */ jsx(ChevronRight, {
											size: 13,
											"aria-hidden": true
										}) : /* @__PURE__ */ jsx(ChevronDown, {
											size: 13,
											"aria-hidden": true
										}), /* @__PURE__ */ jsx("span", {
											className: "gus-column-title",
											children: status
										})]
									}), /* @__PURE__ */ jsx("span", {
										className: "gus-column-count",
										children: items.length
									})]
								}), !collapsed && (boardDensity === "list" ? /* @__PURE__ */ jsx("div", {
									className: "gus-column-body zana-column-body--dense",
									children: items.map((t) => /* @__PURE__ */ jsx(CompactTicketRow, {
										ticket: t,
										onOpen: () => openTicket(t)
									}, t.id))
								}) : /* @__PURE__ */ jsx("div", {
									className: "gus-column-body",
									children: items.map((t) => /* @__PURE__ */ jsx(TicketCard, {
										ticket: t,
										sprintName: resolveSprintName(t.sprintId, sprints),
										onAssign: (choice) => onAssign(t, choice),
										onOpen: () => openTicket(t)
									}, t.id))
								}))]
							}, status);
						})]
					})
				})
			}),
			selected && /* @__PURE__ */ jsx(TicketDetailModal, {
				host,
				selection: selected,
				sprints,
				tickets,
				profiles,
				profileMap,
				projectPath: project.path,
				useGlobal: false,
				onAssign: (choice) => {
					if (selected.kind === "ticket") onAssign(selected.ticket, choice);
				},
				onClose: () => setSelected(null)
			})
		]
	});
}
function KpiCard({ icon, label, value, tone }) {
	return /* @__PURE__ */ jsxs("div", {
		className: `zana-kpi-card ${tone ? `zana-kpi-card--${tone}` : ""}`,
		children: [
			/* @__PURE__ */ jsx("span", {
				className: "zana-kpi-icon",
				"aria-hidden": true,
				children: icon
			}),
			/* @__PURE__ */ jsx("span", {
				className: "zana-kpi-value",
				children: value
			}),
			/* @__PURE__ */ jsx("span", {
				className: "zana-kpi-label",
				children: label
			})
		]
	});
}
/** A compact breakdown: a labelled row of proportional bars per key. */
function Breakdown({ title, counts }) {
	const entries = Object.entries(counts).filter(([, n]) => n > 0);
	if (entries.length === 0) return null;
	const max = Math.max(...entries.map(([, n]) => n));
	return /* @__PURE__ */ jsxs("div", {
		className: "zana-breakdown",
		children: [/* @__PURE__ */ jsx("div", {
			className: "zana-breakdown-title",
			children: title
		}), /* @__PURE__ */ jsx("div", {
			className: "zana-breakdown-rows",
			children: entries.map(([key, n]) => /* @__PURE__ */ jsxs("div", {
				className: "zana-breakdown-row",
				title: `${key}: ${n}`,
				children: [
					/* @__PURE__ */ jsx("span", {
						className: "zana-breakdown-key",
						children: key
					}),
					/* @__PURE__ */ jsx("span", {
						className: "zana-breakdown-bar",
						children: /* @__PURE__ */ jsx("span", {
							className: "zana-breakdown-fill",
							style: { width: `${Math.round(n / max * 100)}%` }
						})
					}),
					/* @__PURE__ */ jsx("span", {
						className: "zana-breakdown-num",
						children: n
					})
				]
			}, key))
		})]
	});
}
/**
* A full kanban card for an active (non-terminal) column. The assignee is shown
* read-only here; the interactive assign PICKER is C4 (it ports the lifted
* picker into core). `onAssign` is wired through so C4 only swaps in the picker
* UI — no signature churn — and the store's optimistic-assign contract is
* already in place.
*/
function TicketCard({ ticket, sprintName, onAssign, onOpen }) {
	const closed = isClosedZanaStatus(ticket.status, ticket.closedAt);
	const prio = ticket.priority?.toLowerCase();
	const blurb = ticket.description?.trim() || ticket.resultSummary?.trim();
	const extraLabels = ticket.labels.length - 3;
	return /* @__PURE__ */ jsxs("div", {
		className: `gus-card zana-card ${closed ? "is-closed" : ""}`,
		onClick: onOpen,
		role: "button",
		tabIndex: 0,
		onKeyDown: (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onOpen();
			}
		},
		title: `${ticket.title} — click for details`,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "gus-card-top zana-card-top",
				children: [
					/* @__PURE__ */ jsx("span", {
						className: `zana-card-dot ${prio ? `zana-prio--${prio}` : ""}`,
						"aria-hidden": true
					}),
					/* @__PURE__ */ jsx("div", {
						className: "gus-card-subject zana-card-title",
						children: ticket.title
					}),
					ticket.priority && /* @__PURE__ */ jsx("span", {
						className: `zana-prio zana-prio--${prio}`,
						children: ticket.priority
					})
				]
			}),
			blurb && /* @__PURE__ */ jsx("div", {
				className: "zana-card-desc",
				children: blurb
			}),
			(ticket.type || ticket.blockedBy.length > 0 || sprintName || ticket.labels.length > 0) && /* @__PURE__ */ jsxs("div", {
				className: "zana-card-chips",
				children: [
					ticket.type && /* @__PURE__ */ jsx("span", {
						className: "zana-type-badge",
						children: ticket.type
					}),
					ticket.blockedBy.length > 0 && /* @__PURE__ */ jsxs("span", {
						className: "zana-blocked-tag",
						title: `Blocked by ${ticket.blockedBy.length}`,
						children: [/* @__PURE__ */ jsx(Ban, {
							size: 11,
							"aria-hidden": true
						}), " Blocked"]
					}),
					sprintName && /* @__PURE__ */ jsx("span", {
						className: "gus-chip",
						children: sprintName
					}),
					ticket.labels.slice(0, 3).map((l) => /* @__PURE__ */ jsxs("span", {
						className: "zana-label-chip",
						children: [
							/* @__PURE__ */ jsx(Tag, {
								size: 9,
								"aria-hidden": true
							}),
							" ",
							l
						]
					}, l)),
					extraLabels > 0 && /* @__PURE__ */ jsxs("span", {
						className: "gus-chip",
						children: ["+", extraLabels]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "zana-card-foot",
				children: [ticket.assigneeName ? /* @__PURE__ */ jsxs("span", {
					className: "zana-card-assignee",
					title: `Assigned to ${ticket.assigneeName}`,
					children: [
						/* @__PURE__ */ jsx(User, {
							size: 11,
							"aria-hidden": true
						}),
						" ",
						ticket.assigneeName
					]
				}) : /* @__PURE__ */ jsx("span", {
					className: "zana-card-unassigned",
					children: "Unassigned"
				}), /* @__PURE__ */ jsx("span", {
					className: "zana-card-id",
					title: ticket.id,
					children: shortId$1(ticket.id)
				})]
			})
		]
	});
}
/**
* A dense, single-line ticket row used inside expanded terminal columns
* (done/cancelled/…): a small priority dot, the title (clipped to one line),
* and the short id. Clicking opens the full detail (C4).
*/
function CompactTicketRow({ ticket, onOpen }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "zana-compact-row",
		onClick: onOpen,
		role: "button",
		tabIndex: 0,
		onKeyDown: (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onOpen();
			}
		},
		title: `${ticket.title} — click for details`,
		children: [
			ticket.priority && /* @__PURE__ */ jsx("span", {
				className: `zana-compact-prio zana-prio--${ticket.priority.toLowerCase()}`,
				title: ticket.priority,
				"aria-hidden": true
			}),
			/* @__PURE__ */ jsx("span", {
				className: "zana-compact-title",
				children: ticket.title
			}),
			/* @__PURE__ */ jsx("span", {
				className: "zana-compact-id",
				title: ticket.id,
				children: shortId$1(ticket.id)
			})
		]
	});
}
//#endregion
//#region src/renderer/VersionSettings.tsx
/**
* The zana-tickets extension's SETTINGS panel — the `@zana-ai/mcp` version
* check, relocated here from core Settings during the tickets → extension
* extraction. Core no longer names Zana anywhere; this settings page is the
* extension's own, surfaced by core in Settings → Extensions (the SDK
* `settingsPanel` contribution).
*
* The `@zana-ai/mcp` server is installed globally via npm and shared by every
* Claude Code session; this compares the installed version against npm's latest
* so the user can copy the upgrade command. Version data comes through the
* `ticketsApi.getVersionInfo()` seam (the `zana` built-in main module).
*
* Reuses the `zana-ver-*` / `settings-*` / `claude-scope-card` classes already
* defined in core's global stylesheet — they were left in place by the merge, so
* the relocated card renders identically.
*/
/** Derive the headline badge / status line from the Zana version info. */
function versionState(info) {
	if (!info) return {
		tone: "warn",
		badge: "Unknown",
		message: ""
	};
	if (info.updateAvailable) return {
		tone: "update",
		badge: `Update → ${info.latest}`,
		message: `An update is available: ${info.installed} → ${info.latest}. Run the command below, then reopen your Claude Code sessions.`
	};
	if (info.installed && info.latest && info.installed === info.latest) return {
		tone: "ok",
		badge: "Up to date",
		message: `You’re on the latest version (${info.installed}).`
	};
	return {
		tone: "warn",
		badge: info.installed ? "Unknown" : "Not installed",
		message: info.error ?? "Could not determine whether an update is available."
	};
}
function VersionSettings() {
	const [info, setInfo] = useState(null);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const [copied, setCopied] = useState(false);
	const load = useCallback(() => {
		setLoading(true);
		setFailed(false);
		ticketsApi.getVersionInfo().then((res) => setInfo(res)).catch(() => setFailed(true)).finally(() => setLoading(false));
	}, []);
	useEffect(() => {
		load();
	}, [load]);
	const copyUpgrade = useCallback(() => {
		if (!info?.upgradeCommand) return;
		navigator.clipboard.writeText(info.upgradeCommand).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		}).catch(() => {});
	}, [info]);
	const state = versionState(info);
	return /* @__PURE__ */ jsxs("div", {
		className: "settings-section zana-version-settings",
		children: [/* @__PURE__ */ jsxs("p", {
			className: "settings-help",
			children: [
				"The Zana MCP server (",
				/* @__PURE__ */ jsx("code", { children: "@zana-ai/mcp" }),
				") is installed globally via npm and shared by every Claude Code session. This checks your installed version against the latest published on npm."
			]
		}), /* @__PURE__ */ jsxs("div", {
			className: "claude-scope-card",
			children: [
				/* @__PURE__ */ jsxs("header", { children: [/* @__PURE__ */ jsxs("h4", { children: ["@zana-ai/mcp", info && /* @__PURE__ */ jsx("span", {
					className: `zana-ver-badge zana-ver-badge--${state.tone}`,
					children: state.badge
				})] }), /* @__PURE__ */ jsx("p", {
					className: "settings-help",
					children: "Multi-agent orchestrator MCP server"
				})] }),
				loading ? /* @__PURE__ */ jsx("p", {
					className: "settings-help",
					children: "Checking…"
				}) : failed ? /* @__PURE__ */ jsx("p", {
					className: "modal-error",
					children: "Couldn’t run the version check."
				}) : info ? /* @__PURE__ */ jsxs(Fragment, { children: [
					/* @__PURE__ */ jsxs("div", {
						className: "zana-ver-grid",
						children: [
							/* @__PURE__ */ jsx("span", {
								className: "zana-ver-key",
								children: "Installed"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "zana-ver-val zana-ver-val--mono",
								children: info.installed ?? "—"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "zana-ver-key",
								children: "Latest"
							}),
							/* @__PURE__ */ jsx("span", {
								className: "zana-ver-val zana-ver-val--mono",
								children: info.latest ?? "—"
							})
						]
					}),
					/* @__PURE__ */ jsxs("p", {
						className: `zana-ver-status zana-ver-status--${state.tone}`,
						children: [
							state.tone === "ok" && /* @__PURE__ */ jsx(CircleCheck, { size: 14 }),
							state.tone === "update" && /* @__PURE__ */ jsx(CircleArrowUp, { size: 14 }),
							state.tone === "warn" && /* @__PURE__ */ jsx(TriangleAlert, { size: 14 }),
							/* @__PURE__ */ jsx("span", { children: state.message })
						]
					}),
					(info.updateAvailable || !info.installed) && /* @__PURE__ */ jsxs("div", {
						className: "zana-ver-upgrade",
						children: [/* @__PURE__ */ jsx("code", {
							className: "settings-code-block zana-ver-cmd",
							children: info.upgradeCommand
						}), /* @__PURE__ */ jsxs("button", {
							type: "button",
							className: "settings-btn",
							onClick: copyUpgrade,
							children: [/* @__PURE__ */ jsx(Copy, { size: 14 }), copied ? "Copied" : "Copy"]
						})]
					})
				] }) : null,
				/* @__PURE__ */ jsx("div", {
					className: "settings-btn-row",
					children: /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: "settings-btn",
						onClick: load,
						disabled: loading,
						children: [/* @__PURE__ */ jsx(RefreshCw, { size: 14 }), loading ? "Checking…" : "Check again"]
					})
				})
			]
		})]
	});
}
//#endregion
//#region src/renderer-entry.tsx
var entry = { activate({ React, host }) {
	setHostReact(React);
	primeModuleHost(host);
	return {
		panel: ProjectTicketsView,
		settingsPanel: VersionSettings
	};
} };
//#endregion
export { entry as default };
